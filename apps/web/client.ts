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
    ACCESS_DENIED: "Du saknar behörighet till företaget.",
    ADMIN_REQUIRED: "Endast ägare och administratör får göra detta.",
    VERSION_CONFLICT: "Utkastet har ändrats. Öppna det igen innan du sparar.",
    DOCUMENT_SCAN_REQUIRED: "Dokumentkontrollen är inte klar ännu.",
    SIGNING_METHOD_NOT_READY:
      "Den valda signeringsmetoden är ännu inte aktiverad.",
    SIGNING_DELIVERY_NOT_CONFIGURED:
      "Utskick för signering är ännu inte aktiverat.",
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
