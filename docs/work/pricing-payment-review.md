# Pris-, betalnings- och samtidighetsgranskning 2026-11-17

## Konkreta fynd och rättningar

1. Paketets documentOre och signeringstariffen var olika källor. Ny tilldelning av per_document/hybrid skapar nu i samma transaktion en immutable dokumenttariff med documentOre, includedSigners och extraSignerOre samt commercial_offer_id. Katalog och offentlig prissida har signerarfälten. Ett sparat paketutkast eller en ny offentlig prisversion skriver inte om bolagets redan tilldelade snapshot. Bolagets senare explicit sparade specialtariff har fortsatt företräde; annars gäller generellt pris.
2. Offentlig automatisk uppdatering omfattade bara den generella dokumenttariffen. Nu hämtas även publicerade paket vid öppning, fokus och 15-sekundersuppdatering.
3. Äldre betalreferens kunde återanvändas för att ersätta senare period. Replays av samma verifierade referens ändrar inte entitlements; ny kortare historisk betalperiod skriver inte tillbaka aktiv längre period. Återförda referenser kan inte återaktiveras.
4. Betalrätt kontrollerade främst en entitlement-rad. Nu krävs även motsvarande immutable betalreferens för rätt organisation, giltig period och ingen återföring.
5. Kontrollerat återföringsflöde för manuell betalreferens saknades. Superadmin kan nu markera referens återförd med MFA/anledning/audit. Detta gör ingen extern återbetalning. Gäller den aktuell referens förfaller dess period; äldre återföring spärrar inte en senare giltig betalning.
6. Prisberäkning hade inte samma låsordning som tariffuppdatering. Quote/send låser nu global pris-kontext och organisation innan kuvert. Prisacceptans kontrolleras i samma transaktion; föråldrat godkännande eller ändrat antal signerare rullar tillbaka case/länkar/outbox. API-kontroll håller organisationslås så adminåterföring och plattformsändringar inte kan passera samma skydd mitt i transaktionen.

## Verifiering och gränser

117 kod/databastester samt typkontroller/build/proveniens passerar. SQL testar paket→dokumenttariff, signerartillägg, recipientändring efter prisacceptans och full rollback, längre period efter äldre replay och sent kortare betalbesked, exakt betalreferens/återföring, annan tenants/rolls nekade tillgång samt tidigare PDF/ZIP/slutkostnadsreplay. Ny browserkontroll gäller paketprisets automatiska uppdatering.

Hosted migration 20261117104850 tillämpad. Hosted rollback-test verifierade senare betalperiod efter äldre replay, godkänd aktiv nyckel och nekad nyckel efter återförd referens. Testdata återställda.

Två samtidiga SQL-anrop via anslutningen försöktes för globalt exklusivt prislås kontra delat quote-lås. Uppmäta väntan blev endast 2 ms: överlapp bevisades inte genom denna anslutning, och det räknas inte som ett godkänt belastnings-/parallellitetstest. Låsregler och stale-revisioner är implementerade och funktionstestade; riktigt fleranslutningstest återstår.

Separat Avtalslänk Stripe-konto har ännu inte anslutits. Stripe-adapter, körande synkworker, verifierade provider-webhooks, skatteinställningar, återbetalning/tvist/avstämning och faktiskt betalnings-E2E är fortfarande inte driftsatta. Inga pengar har dragits eller återbetalats under granskningen. Automatisk debitorkö fortsätter blockerad. Inkluderade volymer/användarkvoter är fortsatt offertvillkor utan aktiv automatisk kvotdebitering.
