import {bounded} from './deadline';
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
    SESSION_TIMEOUT: "Inloggningssessionen svarar inte. Försök igen eller öppna inloggningen på nytt.",
    WORKSPACE_TIMEOUT: "Arbetsytan kunde inte läsas in. Försök igen.",
    AUTH_REQUIRED: "Logga in igen för att fortsätta.",
    COMPANY_ALREADY_REGISTERED: "Företaget har redan en arbetsyta. Be en befintlig ägare bjuda in dig.",
    INVALID_REGISTRATION: "Kontrollera kontotyp, namn och organisationsnummer eller personnummer. Alla obligatoriska uppgifter måste vara korrekt ifyllda.",
    COMPANY_ACCOUNT_REQUIRED: "Den här funktionen kräver en företagsarbetsyta.",    IDEMPOTENCY_CONFLICT: "Referensen har redan använts för ett annat innehåll. Läs in filen igen för en ny import. Kontrollera historiken först om utfallet var osäkert.",
    CONTACT_IMPORT_LIMIT: "Importera 1–200 kontakter per anrop och använd en giltig importreferens.",
    INVALID_CONTACT_IMPORT: "Kontrollera importens namn, e-postadresser och företag. Inga kontakter har sparats.",
    DUPLICATE_IMPORT_EMAIL: "Samma e-postadress finns flera gånger i importen. Inga kontakter har sparats.",
    CSV_TOO_LARGE: "CSV-filen får vara högst 256 KB.",
    CSV_COLUMNS: "CSV-raderna måste ha samma antal kolumner, högst 30.",
    CSV_MAPPING: "Välj olika kolumner för namn, e-post och företag.",
    CSV_NO_DATA: "Filen behöver en rubrikrad och minst en kontakt.",
    INVALID_CSV: "CSV-filen har felaktiga citattecken eller kontrolltecken.",
    INVALID_TEMPLATE_LAYOUT: "Kontrollera mallfältens etiketter, roller, sidnummer och placering. Fälten måste ligga inom sidan.",
    FIELD_LIMIT: "Ett avtal kan ha högst 200 dokumentfält.",
    EMPTY_TEMPLATE: "Fältmallen innehåller inga fält.",
    TEMPLATE_SIGNATURE_FIELD: "Den här mallen innehåller underskriftsfält. Använd en mall med text- och datumfält för dokumentinmatning. Signeringsmetod väljs separat för mottagaren.",
    ROLE_MAPPING_REQUIRED: "Välj en mottagare för varje roll i fältmallen.",
    INVALID_FIELDS: "Kontrollera fältens etiketter, typer och obligatoriska värden.",
    FIELD_OUTSIDE_PAGE: "Ett fält ligger utanför sidan. Kontrollera placering, bredd och höjd.",
    KEY_NOT_ACTIVE: "Nyckeln är utgången eller återkallad. Skapa en ny nyckel.",
    INVALID_KEY_EXPIRY: "Välj en giltighetstid mellan 1 och 365 dagar eller utan slutdatum.",
    INVALID_KEY: "Ange ett nyckelnamn och minst en giltig behörighet.",
    PAYMENT_REVERSED: "Betalreferensen är återförd och kan inte aktiveras igen.",
    PAYMENT_REQUIRED: "API kräver ett aktivt betalt upplägg. Kontakta oss för aktivering.",
    PLATFORM_ADMIN_REQUIRED: "Du saknar plattformsbehörighet.",
    REASON_REQUIRED: "Ange en anledning med minst tio tecken.",
    DOCUMENT_TARIFF_REQUIRED: "Dokumentpris saknas för arbetsytan. Kontakta administratören.",
    PRICE_CHANGED: "Priset eller antalet dokument/signerare har ändrats. Hämta och godkänn det aktuella priset igen.",
    INVALID_PRICE: "Kontrollera pris, paketnamn, modell och villkor. Priser får inte vara negativa.",
    INVALID_PAYMENT: "Kontrollera betalreferens och slutdatum.",
    EMAIL_VERIFICATION_REQUIRED: "Verifiera din e-postadress för att fortsätta.",
    LEGAL_VERSION_CHANGED: "Villkoren har uppdaterats. Läs in sidan igen och granska den aktuella versionen.",
    TERMS_REQUIRED: "Markera att du accepterar kontovillkoren.",
    WEBHOOK_MUST_BE_DISABLED: "Stäng av anslutningen innan du byter hemlighet.",
    WEBHOOK_DELIVERIES_PENDING: "Det finns pågående eller osäkra leveranser. Stäm av dem innan du byter hemlighet.",
    INVALID_PLAN: "Välj ett av de tillgängliga uppläggen.",
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
    NETWORK_ERROR: "Anslutningen avbröts. Kontrollera nätverket och försök igen.",
    REQUEST_TIMEOUT: "Begäran tog för lång tid. Kontrollera resultatet innan du försöker igen.",
    REQUEST_CANCELLED: "Begäran avbröts.",
    INVALID_RESPONSE: "Tjänsten gav ett oväntat svar. Försök läsa in uppgifterna igen.",
    DOCUMENT_TOO_LARGE: "PDF-filen får vara högst 10 MB.",
    INVALID_PDF: "Filen kunde inte läsas som PDF. Välj en giltig PDF-fil.",
    PDF_PAGE_LIMIT: "Dokumentet har fler sidor än vad som tillåts.",
    ACCESS_DENIED: "Du saknar behörighet till företaget.",
    ADMIN_REQUIRED: "Endast ägare och administratör får göra detta.",
    VERSION_CONFLICT: "Uppgifterna har ändrats. Hämta den senaste versionen innan du sparar.",
    DOCUMENT_SCAN_REQUIRED: "Dokumentkontrollen är inte klar ännu.",
    SIGNING_METHOD_NOT_READY:
      "Metoden är inte tillgänglig för ditt företag. Välj en annan metod eller kontakta support.",
    SIGNING_DELIVERY_NOT_CONFIGURED:
      "Utskicket kunde inte startas. Ditt utkast är sparat. Kontakta support.",
    SIGNING_WORKER_NOT_READY:
      "Tjänsten kan inte ta emot utskicket just nu. Ditt utkast är sparat.",
    INVALID_DATE: "Ange ett giltigt datum i fältet.",
    FIELD_TEXT_OVERFLOW: "Texten ryms inte i fältet. Förkorta den eller be avsändaren förstora fältet.",
    FIELD_TEXT_ENCODING: "Fältet innehåller tecken som PDF-filen inte kan återge. Kontakta avsändaren.",
    DECISION_TOO_LARGE: "De ifyllda svaren är för stora tillsammans. Förkorta textfälten.",
    INVALID_REGISTRATION_NUMBER: "Ange ett giltigt organisationsnummer.",
    DELIVERY_NOT_RECOVERABLE: "Leveransen går inte att återställa i sitt nuvarande läge.",
    FINALIZATION_NOT_RETRYABLE: "Slutjobbet går inte att starta om i sitt nuvarande läge.",
    INVALID_FIELD_ASSIGNMENT:
      "Kontrollera fältets dokument, sida och mottagare.",


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
  const { data, error } = await bounded(supabase.rpc(name, args));
  if (error) throw error;
  return data as T;
}
export function displayError(error:unknown){const e=error as {message?:string;requestId?:string|null};const message=friendlyError(e.message??'');return message+(e.requestId&&/^[a-z0-9-]{8,80}$/i.test(e.requestId)?` Referens: ${e.requestId}`:'');}
