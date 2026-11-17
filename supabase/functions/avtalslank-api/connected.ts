import { normalizePersonalNumber, forwardedNetwork } from "../../../packages/signing/src/identity.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.7";
import { sha256Hex } from "../../../packages/crypto/src/hash.ts";
import { randomToken } from "../../../packages/crypto/src/tokens.ts";
import { deliveryToken } from "../../../packages/signing/src/links.ts";
import { assertSafeWebhookUrl } from "../../../packages/webhooks/src/index.ts";

type Identity = {
  actor: string | null;
  keyHash: string | null;
  organizationId: string | null;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const requireId = (v: unknown) => {
  if (typeof v !== "string" || !uuid.test(v)) throw Error("INVALID_ID");
  return v;
};
export async function boundedBytes(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) throw Error("INVALID_BODY");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function call(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function publicSigning(
  req: Request,
  path: string,
  db: SupabaseClient,
) {
  const match = path.match(/^\/v1\/signer\/(view|document|decide|final|evidence)$/);
  if (!match) return null;
  if (req.method !== "POST") throw Error("INVALID_BODY");
  const body = JSON.parse(
    new TextDecoder().decode(await boundedBytes(req, 16384)),
  );
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.token)
  )
    throw Error("INVALID_SIGNING_LINK");
  const action = match[1],
    payload =
      action === "decide"
        ? body.decision
        : action === "evidence" ? { documentId: "evidence" } : action === "document" || action === "final"
          ? { documentId: requireId(body.documentId) }
          : {};
  if (
    action === "decide" &&
    (!payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      JSON.stringify(payload).length > 12000)
  )
    throw Error("INVALID_DECISION");
  if(action === "decide") {
    if(payload.intent === "approve") {
      if(!payload.identity || typeof payload.identity.name !== "string" || payload.identity.name.trim().length<2 || payload.identity.name.length>120)throw Error("INVALID_SIGNER_IDENTITY");
      payload.identity={name:payload.identity.name.trim(),personalNumber:normalizePersonalNumber(String(payload.identity.personalNumber??""))};
    }
    return {data:await call(db,"al_signer_decide",{p_hash:await sha256Hex(body.token),p_payload:payload,p_network:forwardedNetwork(req.headers)})};
  }
  const data = await call(db, "al_signer_command", {
    p_hash: await sha256Hex(body.token),
    p_action: action === "evidence" ? "final" : action,
    p_payload: payload,
  });
  if (action === "document" || action === "final" || action === "evidence") {
    const { data: file, error } = await db.storage
      .from(action !== "document" ? "al-final-documents" : "al-documents")
      .download(action !== "document" ? data.path : data.storage_path);
    if (error) throw error;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ((await sha256Hex(bytes)) !== data.sha256)
      throw Error("ORIGINAL_CHANGED");
    return new Response(bytes, {
      headers: {
        "Content-Type": action === "evidence" ? "application/zip" : "application/pdf",
        "Content-Disposition": action === 'evidence' ? 'attachment; filename="bevisarkiv.zip"' : 'inline; filename="document.pdf"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return { data };
}
export async function connectedRoute(
  req: Request,
  path: string,
  db: SupabaseClient,
  identity: Identity,
  body: Record<string, unknown>,
) {
  const match = path.match(
    /^\/v1\/envelopes\/([a-f0-9-]+)\/(fields|prepare|send|cancel|documents|deliveries|final|quote|party)$/i,
  );
  if (path === "/v1/webhooks" && req.method === "POST") {
    if (!identity.actor || identity.keyHash) throw Error("ADMIN_REQUIRED");
    const secret = randomToken();
    const url = assertSafeWebhookUrl(String(body.url ?? ""));
    const data = await call(db, "al_configure_webhook", {
      p_actor: identity.actor,
      p_org: requireId(identity.organizationId),
      p_url: url.href,
      p_secret: secret,
      p_id: body.id ? requireId(body.id) : null,
      p_active: body.active !== false,
    });
    return { data: { ...data, ...(!body.id ? { secret } : {}) } };
  }
  if (!match) return null;
  const envelopeId = requireId(match[1]),
    operation = match[2];
  const context = {
    p_actor: identity.actor,
    p_key_hash: identity.keyHash,
    p_org: identity.organizationId,
    p_envelope: envelopeId,
  };
  const flow = (action: string, payload: unknown = {}) =>
    call(db, "al_flow_command", {
      ...context,
      p_action: action,
      p_payload: payload,
    });
  if(operation==='quote' && req.method==='GET')return {data:await call(db,'al_document_quote',context)};
  if(operation==='party' && req.method==='POST')return {data:await flow('party',body)};
  if (operation === "documents" && req.method === "POST") {
    if (req.headers.get("content-type")?.split(";")[0] !== "application/pdf")
      throw Error("INVALID_PDF");
    const snapshot = await flow("read");
    const docId = requireId(new URL(req.url).searchParams.get("documentId"));
    const name = new URL(req.url).searchParams.get("name") ?? "document.pdf";
    if (
      !name.toLowerCase().endsWith(".pdf") ||
      name.length > 120 ||
      !name.trim()
    )
      throw Error("INVALID_PDF");
    const bytes = await boundedBytes(req, 10485760);
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
      throw Error("INVALID_PDF");
    const hash = await sha256Hex(bytes);
    // Scope/write authorization before any privileged Storage operation. Lock rechecked at registration.
    await call(db, "al_flow_command", {
      ...context,
      p_action: "authorize_upload",
      p_payload: {},
    });
    const org =
      snapshot.documents[0]?.organization_id ?? (await resolveOrg(db, context));
    const path = `${org}/${envelopeId}/${docId}.pdf`;
    const upload = await db.storage
      .from("al-documents")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error) {
      // Existing originals are never overwritten. Same ID+bytes can complete a lost-response retry.
      const existing = await db.storage.from("al-documents").download(path);
      if (
        existing.error ||
        (await sha256Hex(new Uint8Array(await existing.data.arrayBuffer()))) !==
          hash
      )
        throw Error("UPLOAD_CONFLICT");
    }
    const data = await flow("register_document", {
      id: docId,
      name,
      sha256: hash,
      byteSize: bytes.length,
    });
    return { data };
  }
  if (operation === "prepare" && req.method === "GET")
    return { data: await flow("read") };
  if (operation === "fields" && req.method === "POST")
    return {
      data: await flow("fields", {
        generation: body.generation,
        fields: body.fields,
      }),
    };
  if (operation === "deliveries" && req.method === "GET")
    return { data: await flow("deliveries") };
  if (operation === "cancel" && req.method === "POST")
    return { data: await flow("cancel") };
  if (operation === "send" && req.method === "POST") {
    const secret = Deno.env.get("SIGNING_LINK_SECRET") ?? "";
    if (secret.length < 64) throw Error("SIGNING_DELIVERY_NOT_CONFIGURED");
    const snapshot = await flow("read");
    const links = [];
    for (const recipient of snapshot.recipients) {
      const id = crypto.randomUUID();
      const token = await deliveryToken(secret, id);
      links.push({
        id,
        recipientId: recipient.id,
        tokenHash: await sha256Hex(token),
      });
    }
    return {
      data: await flow("send", {
        generation: body.generation,
        priceHash: body.priceHash,
        snapshot,
        links,
        keyFingerprint: await sha256Hex(secret),
      }),
    };
  }
  if (operation === "final" && req.method === "GET") {
    const result = await flow("download");
    const documentId =
      new URL(req.url).searchParams.get("documentId") ?? "evidence";
    const file = result.files.find(
      (f: { documentId: string }) => f.documentId === documentId,
    );
    if (!file) throw Error("DOCUMENT_NOT_FOUND");
    const download = await db.storage
      .from("al-final-documents")
      .download(file.path);
    if (download.error) throw download.error;
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if ((await sha256Hex(bytes)) !== file.sha256)
      throw Error("ORIGINAL_CHANGED");
    return new Response(bytes, {
      headers: {
        "Content-Type":
          documentId === "evidence" ? "application/zip" : "application/pdf",
        "Content-Disposition":
          documentId === "evidence"
            ? 'attachment; filename="evidence.zip"'
            : 'attachment; filename="signed-document.pdf"',
        "Cache-Control": "no-store",
      },
    });
  }
  return null;
}
async function resolveOrg(
  db: SupabaseClient,
  context: Record<string, unknown>,
) {
  const data = await call(db, "al_flow_command", {
    ...context,
    p_action: "authorize_upload",
    p_payload: {},
  });
  return data.organizationId;
}
