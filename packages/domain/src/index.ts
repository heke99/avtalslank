import { z } from "zod";
export const methods = [
  "bankid",
  "freja",
  "email_approval",
  "drawn_signature",
] as const;
export type SigningMethod = (typeof methods)[number];
export const methodLabels: Record<SigningMethod, string> = {
  bankid: "BankID",
  freja: "Freja eID",
  email_approval: "Godkännande via e-post",
  drawn_signature: "Ritad underskrift",
};
export const recipientSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    method: z.enum(methods),
    position: z.number().int().min(1).max(50),
  })
  .strict();
export const draftSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    message: z.string().max(2000).default(""),
    sequential: z.boolean().default(false),
    expiresDays: z.number().int().min(1).max(90).default(14),
  })
  .strict();
export const billingModels = [
  "unconfigured",
  "subscription",
  "per_document",
  "hybrid",
] as const;
export type BillingModel = (typeof billingModels)[number];
export type EnvelopeStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled";
export const statusLabels: Record<EnvelopeStatus, string> = {
  draft: "Utkast",
  sent: "Väntar på signering",
  in_progress: "Delvis signerat",
  finalizing: "Slutdokument framställs",
  completed: "Färdigt",
  declined: "Nekat",
  expired: "Utgånget",
  cancelled: "Avbrutet",
};
export interface ProviderCapability {
  method: SigningMethod;
  enabled: boolean;
  reason: string | null;
}
// This is a capability report, never a substitute for server-side policy.
export function signingReadiness(
  documents: Array<{ status: string }>,
  recipients: Array<{ method: SigningMethod }>,
  capabilities: ProviderCapability[],
): string[] {
  const issues: string[] = [];
  if (!documents.length) issues.push("Lägg till minst en PDF.");
  if (documents.some((d) => d.status !== "ready"))
    issues.push("Dokumentkontrollen måste bli klar före utskick.");
  if (!recipients.length) issues.push("Lägg till minst en mottagare.");
  for (const method of new Set(recipients.map((r) => r.method)))
    if (!capabilities.find((c) => c.method === method)?.enabled)
      issues.push(
        `${methodLabels[method]} är inte tillgängligt för ditt företag.`,
      );
  return issues;
}
export function safePdfFilename(name: string): string {
  const normalized = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .slice(0, 120);
  if (!normalized.toLowerCase().endsWith(".pdf"))
    throw new Error("Endast PDF-filer stöds.");
  return normalized;
}
export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}
export interface TemplateField {
  id: string;
  label: string;
  type: "text" | "date" | "signature";
  recipientRole: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export function validateFields(fields: TemplateField[]): void {
  const ids = new Set<string>();
  for (const f of fields) {
    if (ids.has(f.id) || !f.id || !f.label.trim() || !f.recipientRole.trim())
      throw new Error("Fälten behöver unika ID, etikett och mottagarroll.");
    ids.add(f.id);
    if (
      !["text", "date", "signature"].includes(f.type) ||
      !Number.isInteger(f.page) ||
      f.page < 0 ||
      f.page > 99
    )
      throw new Error("Ogiltigt fält.");
    if (
      ![f.x, f.y, f.width, f.height].every(Number.isFinite) ||
      f.x < 0 ||
      f.y < 0 ||
      f.width <= 0 ||
      f.height <= 0 ||
      f.x + f.width > 1 ||
      f.y + f.height > 1
    )
      throw new Error("Fältet ligger utanför sidan.");
  }
}
