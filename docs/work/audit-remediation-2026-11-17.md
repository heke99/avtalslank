# Åtgärder efter granskning av Avtalslänk

Åtgärderna utgår från de 46 fynden AL-01–AL-46 i granskningsrapporten. Migrationen läggs ovanpå aktuell historik och lämnar skickade avtalsunderlag, registrerade underskrifter och tidigare dokumentkostnader orörda.

| Fynd | Ändring |
|---|---|
| AL-01–AL-05 | Uttömda slutjobb visas som misslyckade och behöriga administratörer kan starta om dem. Signerade dokument kan hämtas minst 14 dagar efter färdigställande och slutmejlet använder samma nedladdningsperiod. Lagringsjobbet reserverar övergivna objekt äldre än sju dagar och tar bort dem via Storage API. Publicerade filer och pågående arbeten skyddas. Oklara mejlutfall kräver verifierad leverans eller en referens till kontroll före omköning. |
| AL-06–AL-09 | OpenAPI kräver prishash. Betalstatus hämtas för vald arbetsyta. Den publika prisvyn visar tillgängliga priser och tydligt läsfel. En ny sökning rensar gamla träffar. |
| AL-10–AL-16 | Uttömda dokumentjobb avslutas med synligt fel. Avbrytning kan upprepas utan dubbla händelser och stoppar signeringsinbjudningar. Integrationshändelser bevaras och avbrytning får en webhook. API kan filtrera på slutförande. Arbetsytan och superadmin kan visa äldre data. Avtalsdetaljer kontrolleras mot den aktuella arbetsytan. |
| AL-17–AL-22 | Svar med text som inte kan renderas av PDF-fältet avvisas före godkännande. Signeringsbilagan använder inbäddade Noto-typsnitt där de täcker tecknen. Mejladressbekräftelse kan återgå till en sparad teaminbjudan. Vid omladdning kan användaren öppna ursprungslänken igen. Aktiva inbjudningar prioriteras. Webb och API delar storleksgräns för signeringsbeslut. |
| AL-23–AL-29 | Prisacceptans binds till de granskade dokumenten och mottagarna. Adress- och ordningsändringar höjer versionen. Ogiltiga kvarvarande fält tas bort ur utkast. Kopior bevarar mottagarens företagsuppgifter. Organisationsnummer valideras. Filgränsen kontrolleras tidigare. Osparade uppgifter blockerar utskick. Leveransvyn kan uppdatera själva avtalsstatusen. |
| AL-30–AL-35 | En tariff från ett äldre paket fortsätter inte vid byte till ett abonnemang utan dokumentpris. En uttrycklig manuell tariffoverride kan fortfarande gälla. API-måttet använder giltig betalreferens och paketvillkor. Återföringar är säkra att upprepa och visas i superadmin. Svensk kalendermånad används och resultatet märks med månad. Arkivering och återaktivering köar en versionsmärkt synkuppgift. |
| AL-36–AL-41 | Mallar behöver minst ett användbart fält och samma centrala typer och gränser på servern. Stängning med osparade ändringar kräver bekräftelse. Stora kontaktexporter delas upp i importbara CSV-filer. Det märkta exportformatet bevarar värden vid återimport och kalkylbladsskydd. Lyckad import och efterföljande läsfel visas separat. |
| AL-42–AL-46 | Historisk sökning respekterar sparade avsändaruppgifter. Ogiltigt datum får ett begripligt klientfel och för stora API-anrop får HTTP 413. Aktiviteter får svenska namn och knappen för äldre aktiviteter döljs vid slutet. |

## Verifiering och driftsättning

- Ordinarie verifiering kör migrationskedjan i en isolerad databas och kontrollerar typning, OpenAPI och produktionsbygge. Riktade tester täcker återstart av slutjobb, gruppgränser för CSV, format som bevarar exporterade uppgifter samt skydd av lagrade referenser.
- Lokal Chromium hindras från att starta av miljöns begränsning av sockets. Kör browser- och containerkontroller i GitHub Actions före produktionsrullning.
- Installera databasändringen före ny Edge-funktion och Railway-worker. Webbgränssnittet använder nya RPC-funktioner och publiceras efter serverändringarna.
- Provkör ett syntetiskt avtal med bekräftad mejlleverans, slutförande, nedladdning och återförsök efter ett entydigt fel. Stäm av de första planerade lagringsrensningarna med Storage API. Ingen riktig automatisk debitering ingår i den här ändringen. Arkiveringshändelsen finns i kön för den framtida betalningsadaptern.

## Byggkedja efter beroendegranskningen

Vite-kedjan ersattes med esbuild 0.28.1 för att ta bort det berörda utvecklingsberoendet picomatch. Full npm-granskning körs fortsatt som separat CI-jobb. Produktionsbygget behåller dist, förrenderade publika sidor, versionsmärkta JS-/CSS-filer och befintliga Vercel-rutter. Endast tre uttryckligen listade publika webbvariabler bäddas in.
