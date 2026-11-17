# Liknande laddningsfel 2026-11-17

Avgränsning: klientens väntan, återhämtning och gamla svar vid arbetsytebyte. Inga ändrade databasregler, priser, behörigheter eller betalningar.

Rättade fynd:
- Signeringsvyn väntade obegränsat på både HTTP-svar och PDF-kroppar. 20s abort täcker hela svarskroppen, släpper knappar och ger begripligt fel. Första inläsningen erbjuder återöppning. Okänd beslutsstatus behåller samma frysta beslut för exakt manuell retry; inga automatiska nya underskrifter.
- Slutförandestatus pollades var femte sekund även när föregående anrop pågick. Nu högst ett anrop åt gången per monterad vy; pollingfel visas och försvinner efter lyckad statuskontroll.
- Webhooklistan saknade tidsgräns. Nu 12s väntan och separat läs igen-knapp som inte skapar en webhook.
- Kommersiella admin-RPC och direkt återkallelse av API-nyckel kunde hålla UI låst. Nu tidsgräns med befintligt budskap att kontrollera utfallet innan nytt försök. Admin har separat hämtning av sparade uppgifter. Timeout av väntan bevisar inte att servermutationen uteblev; inga automatiska mutationsförsök tillagda.
- MyCommercial behöll föregående arbetsytas prisupplägg under ny läsning och ignorerade RPC-fel. Nu isolerad komponent per arbetsyta, begränsad väntan och synligt läsfel.

Kontrollerat befintligt skydd: huvudappen hade redan key={orgId} för API-nycklar, webhooks och planintresse. Detta var inte ett nytt konstaterat fel. Browserregressionen bevarar nyckelisolation och ignorerande av gamla svar.

Verifiering: npm run verify godkänd (117 tester, Edge/web typecheck, provenance och produktionsbygge). Nya browserfall: fastnad signeringsläsning, långsam statuspoll utan överlappning, webhook-timeout med läsåterhämtning, arbetsytebyte med sent nyckelsvar samt borttagning av gammalt prisupplägg medan det nya hämtas. Browserfallen körs i CI; syntetiska nätverkssvar, inte verklig kundsignering eller MFA. Databas/RLS har inte ändrats.

Lokal Chromium kunde inte starta (SIGABRT i container); detta är inte ett utfört browsertest. Produktionsbygget 981e135 är READY i Vercel. Browserutfall verifieras i GitHub Actions innan slutrapport.
