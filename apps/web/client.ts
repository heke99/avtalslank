import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const supabase = createClient(
  url || "http://127.0.0.1:54321",
  key || "not-configured",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
export const apiUrl =
  import.meta.env.VITE_API_URL || `${url}/functions/v1/avtalslank-api`;
export const friendlyError = (message: string) =>
  ({
    INVALID_INVITATION: "Inbjudan är ogiltig, utgången eller gäller en annan verifierad e-postadress.",
    ALREADY_MEMBER: "Personen är redan medlem i företaget.",
    LAST_OWNER: "Utse en annan ägare innan du lämnar företaget.",
    OWNER_REQUIRED: "Endast en ägare kan bjuda in administratörer.",
    DELIVERY_PENDING: "Vänta tills föregående utskick har behandlats.",
    DELIVERY_RECONCILIATION_REQUIRED: "Leveransens utfall behöver stämmas av innan ett nytt utskick kan göras.",
    REMINDER_COOLDOWN: "Vänta minst 30 minuter mellan utskick.",
    REMINDER_LIMIT: "Högst tre påminnelser kan skickas per mottagare.",
    MFA_REQUIRED: "Verifiera en kod från autentiseringsappen först.",
    PASSWORD_MISMATCH: "Lösenorden stämmer inte överens.",
    ACCESS_DENIED: "Du saknar behörighet till företaget.",
    ADMIN_REQUIRED: "Endast ägare och administratör får göra detta.",
    VERSION_CONFLICT: "Utkastet har ändrats. Öppna det igen innan du sparar.",
    DOCUMENT_SCAN_REQUIRED: "Dokumentkontrollen är inte klar ännu.",
    SIGNING_METHOD_NOT_READY:
      "Den valda signeringsmetoden är ännu inte aktiverad.",
    SIGNING_DELIVERY_NOT_CONFIGURED:
      "Utskick för signering är ännu inte aktiverat.",
    SIGNING_WORKER_NOT_READY:
      "Signeringstjänsten är inte redo. Ditt utkast är sparat.",
    INVALID_FIELD_ASSIGNMENT:
      "Kontrollera fältets dokument, sida och mottagare.",
    INVALID_FIELDS: "Kontrollera dokumentfälten.",
    FIELD_OUTSIDE_PAGE: "Fältet måste ligga inom dokumentets sida.",
    FINAL_DOCUMENT_NOT_READY: "Slutdokumentet är inte klart ännu.",
    DOCUMENT_TOTAL_LIMIT: "Dokumenten får tillsammans vara högst 50 MB.",
    DOCUMENT_REQUIRED: "Ladda upp en PDF först.",
    RECIPIENT_REQUIRED: "Lägg till minst en mottagare.",
    UPLOAD_NOT_FOUND: "Filen kunde inte hittas. Försök ladda upp den igen.",
    DOCUMENT_LOCKED: "Det här avtalet är låst.",
    ALREADY_EXISTS: "Uppgiften finns redan.",
    "Invalid login credentials":
      "E-postadressen eller lösenordet stämmer inte.",
  })[message] ??
  "Åtgärden kunde inte slutföras. Kontrollera uppgifterna och försök igen.";
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}
