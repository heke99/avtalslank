# Prisgranskning och leveransåterhämtning 2026-11-17

Fynd:
- Ett pågående quote-anrop kunde fylla PriceReview med en äldre offert efter att generation ändrats. State återställdes i effect men gammalt svar accepterades därefter. Nu ny komponent per organisation, avtal och generation; gammalt svar stannar i avmonterad komponent. Serverns hash-/generationskontroll är oförändrad.
- Leveranshistorik behöll fel efter lyckad uppdatering och likställde utebliven läsning med tom lista. Nu separata tillstånd för laddning/ej hämtat/tomt, rensat fel vid ny läsning och versionskontroll av svar. Uppdateringsknappen spärras under läsning.
- Bevispakethämtning saknade HTTP-/kroppstidsgräns och spärr mot upprepad knapptryckning. Nu 20s abort genom hela hämtningen och knappspärr under försöket. Sessionshämtning har fortsatt egen 6s gräns.
- Fälteditorns PDF-förhandsvisning saknade tidsgräns. Nu begränsad storage-väntan. Befintliga kontrollerade dokument och serverregler kvarstår.
- Admins signeradsökning och dokumenttariff använde direkta RPC utan tidsgräns. Nu gemensam 12s deadline. Tariff kan inte redigeras innan dess nuvarande tillstånd hämtats; separat läsåterhämtning gör att man kan kontrollera ett osäkert sparresultat utan att spara igen.

Verifiering: npm run verify samt browserfall för tariff-timeout/återhämtning, sent pris efter generationsbyte och leveransfel som följs av lyckad uppdatering. CI använder syntetiska nätverkssvar, inga verkliga betalningar eller kundutskick. Inga databas- eller behörighetsändringar.
