# Fortsatt granskning av laddningsfel 2026-11-17

Fynd och ändringar:
- Gemensam rpc i client.ts hade ingen tidsgräns. Den täcker många utkast-, mottagar-, mall-, aktivitet- och teamåtgärder. Nu 12s väntan; okänt serverutfall förklaras med befintligt budskap att kontrollera resultatet före återförsök. Ingen automatisk mutationsretry.
- Kontaktväljaren samt samlad kontakt-/team-/företagsladdning väntade obegränsat. Nu 12s väntan genom samma hjälpare.
- Dokumentförhandsvisning väntade obegränsat på storage-hämtning. Hämtning och läsning av filkropp har varsin 12s gräns. Kontrollsummekontrollen kvarstår; ingen PDF visas före verifierad hash. Underliggande läsning kan fortsätta efter timeout men resultatet visas inte.
- Huvudappens avtal-/mall-/kapabilitetsladdning har en gemensam tidsgräns. Versionsräknare gör att äldre parallella laddningar inte kan skriva över nyare resultat i samma arbetsyta. Tidigare scope-kontroll för arbetsytebyte kvarstår.

bounded har flyttats till deadline.ts och återexporteras från session.ts så client.ts slipper importera sessionsmodulen och skapa ett cirkulärt beroende. Sessionstider och tidigare beteende bevaras.

Verifiering: npm run verify (kod/DB-tester, typer, provenance och produktionsbygge). Browserregressioner tillagda för obesvarad utkastmutation (knapp återställs, formulär bevaras, exakt ett anrop) och fastnad kontaktladdning (synligt fel, övriga kontroller frigörs). Full browsersvit körs i CI, med syntetiska nätverkssvar. Inga databasregler eller externa leverantörsinställningar ändras.
