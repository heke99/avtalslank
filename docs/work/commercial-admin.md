# Kommersiell administration och utbytbar betalningsleverantör

2026-11-17. Krav: superadmin behöver pris-/pakethantering, bolagspriser och full koppling till framtida betalning; Stripe först, separat konto för Avtalslänk, andra leverantörer ska kunna anslutas senare.

## Levererat i denna iteration

- MFA-skyddad plattformsöversikt för arbetsytor, användare, avtal, betalperioder och misslyckade dokumentjobb.
- Versionerad priskatalog: abonnemang, per dokument och hybrid; heltalsöre/SEK exkl moms; period månad/år; dokumentvolym, användarantal och individuella bindnings-/uppsägningstider. Ingen affärsnivå eller pris förifylld.
- Sparande av ny prisversion, separat publicering och arkivering/återaktivering med revisionskontroll. Publicerat pris visas på /abonnemang. Ett nytt utkast påverkar inte den tidigare publicerade prisversionen.
- Bolagstilldelning med specifik prisversion, offert-/avtalsreferens och valfria prisavvikelser. Oföränderlig snapshot/historik. Befintliga snapshots skrivs inte om när katalogpriset ändras. Kunden kan läsa sitt eget registrerade prisupplägg under Inställningar; annan arbetsyta nekas.
- Betalhistorik, användningshändelser, interna supportanteckningar och ändring av arbetsytans visningsnamn. Varken personnummer, bevis eller signerade avtal ändras.
- Allt styrs serverledes av plattformsroll + AAL2 och loggas. Privat data har inga klientgrants och explicita deny-policies.

## Koppling till betalning – exakt gräns

Catalog/offer-publicering köar varaktiga leverantörsoberoende synkuppgifter. billing_connections, billing_external_objects och billing_sync_tasks håller anslutning/externa ID:n/synkstatus åtskilda från Avtalslänks verksamhets-ID:n. Stripe-anslutningen är ännu inte konfigurerad: synkuppgifter blir blocked. Det finns ingen körande betaladapter eller webhookhanterare ännu; köad synk är inte extern synk.

packages/billing/src/provider.ts definierar adaptergränssnitt för prissynk, checkout, abonnemangsbyte och avslut. Kontroll före checkout nekar gammal prisrevision, fel leverantör och saknad synkad mappning. Kontrollen är modultestad; den är ännu inte inkopplad i ett aktivt checkout-API. Abonnemang behåller sin ursprungliga leverantör medan nya köp kan använda en annan anslutning.

En framtida adapter ska skapa/mappa ny leverantörsprisversion och bekräfta utfallet innan den markeras synced. Ändring av befintligt abonnemang kräver eget synkuppdrag, vald ikraftträdandetid och bekräftelse; gamla debiteringar eller godkända fakturor ändras inte. Kundavtal, prisreferenser, moms och faktisk skattehantering måste kopplas i det aktiva betalflödet. Dokumentkrediter/kvotspärrar/automatisk användningsdebitering är inte aktiverade. Att ange användarantal eller dokumentvolym i katalogen är offertvillkor, inte en ny backendkvot.

Prisändring eller pakettilldelning ger aldrig betald API-rätt. API kräver fortfarande separat giltig betalrätt; om tilldelat paket inte inkluderar API spärras nyckeln även om en betald period finns.

## Nästa steg för aktiv Stripe-drift

Användaren valde ett separat Avtalslänk-konto. Endast Trafexa Nordic AB, Flexexa staging och annat sandbox-konto är synliga; inga ändringar gjorda där. Anslut det separata kontot, provisionera avgränsad servernyckel och webhooksecret via hemlighetslagring. Implementera/koppla körande Stripe-adapter och synkworker, verifiera momsinställningar, hantera invoice.paid/payment_failed, subscription lifecycle samt återbetalning/tvist/risk och avstämning innan checkout öppnas. Full payment-E2E saknas; detta är inte en aktiv betalningsintegration.

## Verifiering

npm run verify passerar: 111 tester, proveniens, Edge/web/worker-typkontroll och produktionsbygge. PostgreSQL testar opublicerat pris, oföränderlig historik, separat publicering, prisavvikelse för bolag, stale revisions, andra bolags åtkomst, privat data i offentlig katalog, API-behörighet och blockerad synkkö. Adapterkontrakt testar fel leverantör/inaktuellt pris och att nya köp inte flyttar befintliga abonnemang. Browserfall tillagt för att spara prisversion i öre och publicera separat. Hosted rollback/CI-resultat kontrolleras efter tillämpning/publicering.

Hosted migration 20261117095335 tillämpad. Hosted rollback-test godkänt: prisversion, publicering, bolagsspecifik snapshot och två blockerade synkuppdrag; testdata återställda. Anslutningslänk till separat Stripe-konto lämnad till användaren; kontot är fortfarande inte anslutet.
