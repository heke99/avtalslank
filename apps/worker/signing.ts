import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { request as httpsRequest } from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { sha256Hex } from "../../packages/crypto/src/hash.ts";
import { deliveryToken } from "../../packages/signing/src/links.ts";
import {
  evidencePackage,
  finalPdf,
  retryDelivery,
  signingInvitation,
  signingWebhook,
  type SigningField,
} from "../../packages/signing/src/index.ts";
import { createEvidenceZip } from "../../packages/evidence/src/zip.ts";
import { assertSafeWebhookUrl } from "../../packages/webhooks/src/index.ts";
export type SigningConfig = {
  secret: string;
  publicOrigin: string;
  resendKey: string;
  from: string;
  domainVerified: boolean;
};
export function signingConfigured(c: SigningConfig) {
  try {
    return (
      /^[a-f0-9]{64,}$/.test(c.secret) &&
      new URL(c.publicOrigin).protocol === "https:" &&
      Boolean(c.resendKey) &&
      /^[^\r\n]+@[^\r\n]+$/.test(c.from) &&
      c.domainVerified
    );
  } catch {
    return false;
  }
}
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export function publicIpv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export async function postWebhook(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
) {
  const url = assertSafeWebhookUrl(rawUrl);
  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : await resolve4(url.hostname);
  if (!addresses.length || addresses.some((ip) => !publicIpv4(ip)))
    throw Error("WEBHOOK_ADDRESS_DENIED");
  // Pin the validated DNS answer to the socket; TLS still verifies the original hostname. Never follow redirects.
  return new Promise<number>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
        lookup: ((_hostname: unknown, _options: unknown, cb: any) => {
          if ((_options as { all?: boolean }).all)
            cb(null, [{ address: addresses[0], family: 4 }]);
          else cb(null, addresses[0], 4);
        }) as any,
      },
      (res) => {
        res.destroy();
        resolve(res.statusCode ?? 500);
      },
    );
    req.setTimeout(15000, () => req.destroy(Error("WEBHOOK_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}
export async function processSigningJob(
  db: SupabaseClient,
  c: SigningConfig,
  work: any,
  transports = { fetch: globalThis.fetch, postWebhook },
) {
  const { job, snapshot, snapshotHash, expiresAt, decisions } = work;
  const finish = (payload: unknown) =>
    rpc(db, "al_signing_worker", {
      p_action: "finish",
      p_id: job.id,
      p_lease: job.lease_token,
      p_payload: payload,
    });
  if (job.kind === "invitation") {
    if (Date.parse(expiresAt) <= Date.now())
      return finish({ status: "failed", error: "LINK_EXPIRED" });
    const recipient = snapshot.recipients.find(
      (r: any) => r.id === job.payload.recipientId,
    );
    if (!recipient) throw Error("RECIPIENT_NOT_FOUND");
    const token = await deliveryToken(c.secret, job.payload.linkId);
    const mail = signingInvitation(
      {
        name: recipient.name,
        title: snapshot.envelope.title,
        url: `${c.publicOrigin}/s/#token=${token}`,
        expiresAt,
      },
      c.publicOrigin,
    );
    try {
      const response = await transports.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${c.resendKey}`,
          "content-type": "application/json",
          "idempotency-key": job.effect_key,
        },
        body: JSON.stringify({
          from: c.from,
          to: [recipient.email],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const result = (await response.json()) as { id?: string };
        if (!result.id)
          return finish({
            status: "reconcile",
            error: "EMAIL_RESPONSE_UNKNOWN",
          });
        return finish({ status: "accepted", reference: result.id });
      }
      const outcome =
        response.status === 429
          ? "temporary"
          : response.status >= 500
            ? "unknown"
            : "permanent";
      return finish({
        ...retryDelivery(
          job.attempts,
          outcome,
          Date.now(),
          Number(response.headers.get("retry-after") ?? 0),
        ),
        error: `EMAIL_HTTP_${response.status}`,
      });
    } catch {
      return finish({ status: "reconcile", error: "EMAIL_OUTCOME_UNKNOWN" });
    }
  }
  if (job.kind === "webhook") {
    const endpoint = await rpc(db, "al_webhook_delivery_context", {
      p_id: job.id,
      p_lease: job.lease_token,
    });
    const signed = await signingWebhook(
      job.payload.event,
      endpoint.secret,
      Math.floor(Date.now() / 1000),
    );
    try {
      const status = await transports.postWebhook(endpoint.url, signed.body, {
        "x-avtalslank-event-id": job.payload.event.id,
        "x-avtalslank-timestamp": signed.timestamp,
        "x-avtalslank-signature": signed.signature,
      });
      return finish(
        status >= 200 && status < 300
          ? { status: "completed" }
          : {
              ...retryDelivery(
                job.attempts,
                status === 429 || status >= 500 ? "temporary" : "permanent",
                Date.now(),
              ),
              error: `WEBHOOK_HTTP_${status}`,
            },
      );
    } catch {
      return finish({ status: "reconcile", error: "WEBHOOK_OUTCOME_UNKNOWN" });
    }
  }
  if (job.kind === "finalize") {
    const values: Record<string, string> = {};
    for (const d of decisions) Object.assign(values, d.decision.values);
    const files: Array<{ path: string; bytes: Uint8Array; mediaType: string }> =
        [],
      result: Array<{ documentId: string; path: string; sha256: string }> = [];
    const store = async (
      documentId: string,
      bytes: Uint8Array,
      mediaType: string,
    ) => {
      const path = `${job.organization_id}/${job.envelope_id}/${job.lease_token}/${documentId}.${documentId === "evidence" ? "zip" : "pdf"}`;
      const upload = await db.storage
        .from("al-final-documents")
        .upload(path, bytes, { contentType: mediaType, upsert: false });
      if (upload.error) throw upload.error;
      result.push({ documentId, path, sha256: await sha256Hex(bytes) });
    };
    for (const document of snapshot.documents) {
      const original = await db.storage
        .from("al-documents")
        .download(document.storage_path);
      if (original.error) throw original.error;
      const bytes = new Uint8Array(await original.data.arrayBuffer());
      const rendered = await finalPdf(
        bytes,
        document.sha256,
        snapshot.envelope.fields as SigningField[],
        values,
        document.id,
      );
      const pdf = await PDFDocument.load(rendered.bytes),
        font = await pdf.embedFont(StandardFonts.Helvetica),
        page = pdf.addPage([595, 842]);
      const lines = [
        "Avtalslank - approval record",
        `Envelope: ${job.envelope_id}`,
        `Document: ${document.id}`,
        `Original SHA-256: ${document.sha256}`,
        `Snapshot: ${snapshotHash}`,
        "Method: email approval",
        "",
      ];
      for (const d of decisions)
        lines.push(
          `Recipient: ${d.recipientId}`,
          `Approved: ${d.consumedAt}`,
          `Intent version: ${d.decision.consentVersion}`,
          "",
        );
      let y = 800;
      for (const line of lines) {
        if (y < 40) throw Error("RECEIPT_PAGE_LIMIT");
        page.drawText(line, { x: 30, y, size: 9, font });
        y -= 15;
      }
      const finalBytes = await pdf.save();
      await store(document.id, finalBytes, "application/pdf");
      files.push(
        {
          path: `original/${document.id}.pdf`,
          bytes,
          mediaType: "application/pdf",
        },
        {
          path: `final/${document.id}.pdf`,
          bytes: finalBytes,
          mediaType: "application/pdf",
        },
      );
    }
    files.push({
      path: "decisions.json",
      bytes: new TextEncoder().encode(
        JSON.stringify({ snapshotHash, decisions }, null, 2),
      ),
      mediaType: "application/json",
    });
    const manifest = await evidencePackage(
      job.envelope_id,
      files,
      { snapshotHash, method: "email_approval" },
      job.created_at,
    );
    const archive = createEvidenceZip([
      ...files,
      {
        path: "manifest.json",
        bytes: new TextEncoder().encode(JSON.stringify(manifest)),
        mediaType: "application/json",
      },
    ]);
    await store("evidence", archive, "application/zip");
    return finish({ status: "completed", result: { files: result, manifest } });
  }
  throw Error("UNKNOWN_SIGNING_JOB");
}
export async function signingTick(
  db: SupabaseClient,
  c: SigningConfig,
  scannerReady: boolean,
) {
  await rpc(db, "al_expire_signing", {});
  const ready = signingConfigured(c) && scannerReady;
  await rpc(db, "al_signing_worker", {
    p_action: "heartbeat",
    p_payload: {
      ready,
      keyFingerprint: c.secret ? await sha256Hex(c.secret) : null,
    },
  });
  if (!ready) return;
  const work = await rpc(db, "al_signing_worker", { p_action: "claim" });
  if (!work) return;
  try {
    await processSigningJob(db, c, work);
  } catch {
    // A failed finalization is safely retried on a fresh lease; external effects remain uncertain.
    await rpc(db, "al_signing_worker", {
      p_action: "finish",
      p_id: work.job.id,
      p_lease: work.job.lease_token,
      p_payload: {
        ...retryDelivery(
          work.job.attempts,
          work.job.kind === "finalize" ? "temporary" : "unknown",
          Date.now(),
        ),
        error: "SIGNING_JOB_FAILED",
      },
    });
  }
}
