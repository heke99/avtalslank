import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sha256Hex } from "../../crypto/src/hash.ts";
import { randomToken } from "../../crypto/src/tokens.ts";
import { canonicalJson } from "../../crypto/src/canonical-json.ts";
import {
  createEvidenceManifest,
  type EvidenceFile,
} from "../../evidence/src/index.ts";

const id = z.uuid(),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
export const uploadSchema = z
  .object({
    documentId: id,
    envelopeId: id,
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/\.pdf$/i),
    sha256: digest,
    byteSize: z.number().int().min(5).max(10485760),
  })
  .strict();
export async function inspectUpload(metadata: unknown, bytes: Uint8Array) {
  const m = uploadSchema.parse(metadata);
  if (
    bytes.length !== m.byteSize ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-" ||
    (await sha256Hex(bytes)) !== m.sha256
  )
    throw Error("UPLOAD_INTEGRITY");
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100)
    throw Error("PAGE_LIMIT");
  return {
    ...m,
    pages: pdf
      .getPages()
      .map((p) => ({ width: p.getWidth(), height: p.getHeight() })),
  };
}

export const fieldSchema = z
  .object({
    id,
    documentId: id,
    recipientId: id,
    type: z.enum(["text", "date", "signature"]),
    label: z.string().trim().min(1).max(120),
    required: z.boolean(),
    page: z.number().int().min(0).max(99),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (f) => f.x + f.width <= 1 && f.y + f.height <= 1,
    "FIELD_OUTSIDE_PAGE",
  );
export type SigningField = z.infer<typeof fieldSchema>;
export function assignFields(
  input: unknown,
  documents: ReadonlyArray<{ id: string; pages: number }>,
  recipientIds: readonly string[],
) {
  const fields = z.array(fieldSchema).max(200).parse(input);
  const used = new Set<string>();
  for (const f of fields) {
    const doc = documents.find((d) => d.id === f.documentId);
    if (
      !doc ||
      f.page >= doc.pages ||
      !recipientIds.includes(f.recipientId) ||
      used.has(f.id)
    )
      throw Error("INVALID_FIELD_ASSIGNMENT");
    used.add(f.id);
  }
  return fields;
}
export function pdfRectangle(
  f: SigningField,
  page: { width: number; height: number },
) {
  fieldSchema.parse(f);
  if (
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0
  )
    throw Error("INVALID_PAGE");
  return {
    x: f.x * page.width,
    y: (1 - f.y - f.height) * page.height,
    width: f.width * page.width,
    height: f.height * page.height,
  };
}

export type LinkRecord = {
  tokenHash: string;
  recipientId: string;
  envelopeId: string;
  generation: number;
  expiresAt: string;
  revokedAt: string | null;
  consumedAt: string | null;
};
export async function issueLink(
  input: Omit<LinkRecord, "tokenHash" | "revokedAt" | "consumedAt">,
  now: number,
) {
  id.parse(input.recipientId);
  id.parse(input.envelopeId);
  if (
    !Number.isInteger(input.generation) ||
    input.generation < 1 ||
    !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= now ||
    Date.parse(input.expiresAt) - now > 90 * 86400000
  )
    throw Error("INVALID_LINK_LIFETIME");
  const token = randomToken();
  return {
    token,
    record: {
      ...input,
      tokenHash: await sha256Hex(token),
      revokedAt: null,
      consumedAt: null,
    } satisfies LinkRecord,
  };
}
export async function verifyLink(
  token: string,
  record: LinkRecord,
  generation: number,
  now: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    !Number.isFinite(now) ||
    record.revokedAt ||
    record.consumedAt ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    Date.parse(record.expiresAt) <= now ||
    record.generation !== generation ||
    (await sha256Hex(token)) !== record.tokenHash
  )
    throw Error("INVALID_SIGNING_LINK");
  return { recipientId: record.recipientId, envelopeId: record.envelopeId };
}

export type Recipient = {
  id: string;
  name: string;
  email: string;
  method: string;
  position: number;
  status: "pending" | "signed" | "declined";
};
export function recipientView(
  recipientId: string,
  recipients: readonly Recipient[],
  fields: readonly SigningField[],
  documents: ReadonlyArray<{
    id: string;
    name: string;
    sha256: string;
    storage_path: string;
  }>,
  sequential: boolean,
) {
  const r = recipients.find((x) => x.id === recipientId);
  if (!r) throw Error("RECIPIENT_NOT_FOUND");
  const waiting =
    sequential &&
    recipients.some((x) => x.position < r.position && x.status !== "signed");
  return {
    recipient: { id: r.id, name: r.name, method: r.method, status: r.status },
    waiting,
    fields: fields.filter((f) => f.recipientId === r.id),
    documents: documents.map(({ id, name, sha256 }) => ({ id, name, sha256 })),
  };
}
export const decisionSchema = z
  .object({
    intent: z.enum(["approve", "decline"]),
    documentSetHash: digest,
    consentVersion: z.string().min(1).max(80),
    consent: z.boolean(),
    values: z.record(z.string(), z.string().max(2000)),
    reason: z.string().max(500).optional(),
  })
  .strict();
export function validateDecision(
  input: unknown,
  expectedHash: string,
  fields: readonly SigningField[],
  recipientId: string,
  method: string,
  waiting: boolean,
) {
  const d = decisionSchema.parse(input);
  if (waiting) throw Error("WAITING_FOR_PREVIOUS_RECIPIENT");
  if (d.documentSetHash !== expectedHash) throw Error("DOCUMENT_SET_CHANGED");
  if (d.intent === "decline")
    return { intent: d.intent, reason: d.reason ?? "" };
  if (!d.consent) throw Error("EXPLICIT_INTENT_REQUIRED");
  if (method !== "email_approval")
    throw Error("METHOD_REQUIRES_PROVIDER_VERIFICATION");
  const own = fields.filter((f) => f.recipientId === recipientId);
  for (const k of Object.keys(d.values))
    if (!own.some((f) => f.id === k)) throw Error("UNASSIGNED_FIELD");
  for (const f of own) {
    const v = d.values[f.id]?.trim();
    if (f.required && !v) throw Error("REQUIRED_FIELD");
    if (
      v &&
      f.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v)
    )
      throw Error("INVALID_DATE");
    if (v && f.type === "signature") throw Error("DRAWN_SIGNATURE_NOT_ENABLED");
  }
  return {
    intent: d.intent,
    consentVersion: d.consentVersion,
    values: d.values,
  };
}
export async function documentSetHash(
  documents: ReadonlyArray<{ id: string; sha256: string }>,
  fields: readonly SigningField[],
  generation: number,
) {
  if (
    !Number.isInteger(generation) ||
    generation < 1 ||
    new Set(documents.map((d) => d.id)).size !== documents.length
  )
    throw Error("INVALID_SNAPSHOT");
  for (const d of documents) {
    id.parse(d.id);
    digest.parse(d.sha256);
  }
  return sha256Hex(
    canonicalJson({
      generation,
      documents: [...documents].sort((a, b) => a.id.localeCompare(b.id)),
      fields: [...fields].sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function signingInvitation(
  input: { name: string; title: string; url: string; expiresAt: string },
  publicOrigin: string,
) {
  const origin = new URL(publicOrigin),
    url = new URL(input.url);
  if (
    origin.protocol !== "https:" ||
    url.origin !== origin.origin ||
    !url.pathname.startsWith("/s/") ||
    url.username ||
    url.password ||
    (url.hash !== "" &&
      !(url.pathname === "/s/" && /^#token=[a-f0-9]{64}$/.test(url.hash))) ||
    !input.name.trim() ||
    !input.title.trim() ||
    !Number.isFinite(Date.parse(input.expiresAt))
  )
    throw Error("INVALID_EMAIL_TEMPLATE");
  const expiry = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(input.expiresAt));
  return {
    templateId: "signing.invitation",
    version: 1,
    subject:
      "Avtal för signering: " +
      input.title.replace(/[\r\n]/g, " ").slice(0, 160),
    text: `Hej ${input.name},\n\nDu har fått avtalet ${input.title} för signering.\n${url.href}\n\nLänken gäller till ${expiry}.\nAvtalslänk · Trafexa Nordic AB`,
    html: `<!doctype html><html lang="sv"><body><p>Hej ${escapeHtml(input.name)},</p><p>Du har fått avtalet <strong>${escapeHtml(input.title)}</strong> för signering.</p><p><a href="${escapeHtml(url.href)}">Öppna avtalet</a></p><p>Länken gäller till ${escapeHtml(expiry)}.</p><p>Avtalslänk · Trafexa Nordic AB</p></body></html>`,
  };
}
export function retryDelivery(
  attempt: number,
  outcome: "temporary" | "permanent" | "unknown" | "accepted",
  now: number,
  retryAfterSeconds?: number,
) {
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isFinite(now))
    throw Error("INVALID_RETRY");
  if (outcome === "unknown") return { status: "reconcile", retryAt: null };
  if (outcome === "accepted") return { status: "accepted", retryAt: null };
  if (outcome === "permanent" || attempt >= 5)
    return { status: "failed", retryAt: null };
  const delay = Math.max(
    Math.min(3600, 30 * 2 ** (attempt - 1)),
    Math.min(86400, Math.max(0, retryAfterSeconds ?? 0)),
  );
  if (!Number.isFinite(delay)) throw Error("INVALID_RETRY");
  return {
    status: "pending",
    retryAt: new Date(now + delay * 1000).toISOString(),
  };
}

export async function finalPdf(
  original: Uint8Array,
  expectedHash: string,
  fields: readonly SigningField[],
  values: Readonly<Record<string, string>>,
  documentId: string,
) {
  if ((await sha256Hex(original)) !== digest.parse(expectedHash))
    throw Error("ORIGINAL_CHANGED");
  const pdf = await PDFDocument.load(original);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const f of fields.filter((f) => f.documentId === documentId)) {
    fieldSchema.parse(f);
    const page = pdf.getPage(f.page);
    const v = values[f.id];
    if (f.required && !v?.trim()) throw Error("REQUIRED_FIELD");
    if (!v) continue;
    if (f.type === "signature") throw Error("DRAWN_SIGNATURE_NOT_ENABLED");
    const rect = pdfRectangle(f, {
      width: page.getWidth(),
      height: page.getHeight(),
    });
    const text = v.replace(/[\r\n]+/g, " ");
    const size = Math.min(12, rect.height * 0.7);
    let width: number;
    try { width=font.widthOfTextAtSize(text,size); }
    catch { throw Error("FIELD_TEXT_ENCODING"); }
    if (width > rect.width) throw Error("FIELD_TEXT_OVERFLOW");
    page.drawText(text, {
      x: rect.x,
      y: rect.y + (rect.height - size) / 2,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await pdf.save();
  return { bytes, sha256: await sha256Hex(bytes) };
}
export async function evidencePackage(
  envelopeId: string,
  files: readonly EvidenceFile[],
  metadata: Record<string, string>,
  createdAt: string,
) {
  id.parse(envelopeId);
  if (
    !files.length ||
    files.length > 50 ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Set(files.map((f) => f.path)).size !== files.length ||
    files.some(
      (f) =>
        f.path.startsWith("/") ||
        f.path.split("/").includes("..") ||
        f.path.includes("\\"),
    )
  )
    throw Error("INVALID_EVIDENCE_PACKAGE");
  return createEvidenceManifest(envelopeId, files, metadata, createdAt);
}
export function workerReadiness(config: {
  supabaseUrl?: string;
  serviceKey?: string;
  clamHost?: string;
  publicOrigin?: string;
  emailConfigured?: boolean;
}) {
  const missing: string[] = [];
  for (const [key, v] of Object.entries({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    clamHost: config.clamHost,
    publicOrigin: config.publicOrigin,
  }))
    if (!v?.trim()) missing.push(key);
  if (config.publicOrigin) {
    try {
      if (new URL(config.publicOrigin).protocol !== "https:")
        missing.push("publicOriginHttps");
    } catch {
      missing.push("publicOriginHttps");
    }
  }
  if (!config.emailConfigured) missing.push("emailTransport");
  return { ready: missing.length === 0, missing };
}

export const webhookEventSchema = z
  .object({
    id,
    organizationId: id,
    envelopeId: id,
    type: z.enum([
      "envelope.sent",
      "recipient.signed",
      "envelope.declined",
      "envelope.completed",
      "envelope.expired",
    ]),
    occurredAt: z.iso.datetime(),
    generation: z.number().int().positive(),
  })
  .strict();
export async function signingWebhook(
  input: unknown,
  secret: string,
  nowEpochSeconds: number,
) {
  if (secret.length < 32 || !Number.isSafeInteger(nowEpochSeconds))
    throw Error("INVALID_WEBHOOK_CONFIGURATION");
  const event = webhookEventSchema.parse(input);
  const { signWebhook } = await import("../../webhooks/src/index.ts");
  return {
    ...(await signWebhook(
      { schema: "avtalslank.webhook.v1", ...event },
      secret,
      String(nowEpochSeconds),
    )),
    deliveryKey: `${event.organizationId}:${event.id}`,
  };
}
