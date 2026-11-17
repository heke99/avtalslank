# Full E2E Verification Report — Avtalslänk 2026-11-17

## Release verdict
**RED för generell betalande lansering.** App och worker är redan i produktionsmiljö, men det finns noll dokumenttariffer, noll publicerade paket och ingen aktiv betalningsanslutning. Nytt utskick efter prisreglernas införande saknar därför nödvändig tariff. Detta ska lösas genom ett beslutat pris i superadmin, inte genom att kringgå pris-/betalspärrar. BankID/Freja ligger utanför nu godkänt scope och förblir avstängda.

## Execution identity
- Repository: heke99/avtalslank, branch main.
- Baseline: 57f56f4c39dfd3fb4aca707824f3f829bef69590.
- Mål: https://www.avtalslank.se, Supabase ykddnagtuacflilbchwx, Railway production.
- Baseline Edge: v16 ACTIVE, bundle cd6a7d411dbd8cc6049b27e32ef2822971519bd01ef686aeb98e03b841eb0e80.
- Worker: deployment 44152dbb-90a2-4e08-a2b1-45881288bbac; ClamAV 15d2acb8-e289-4c28-9735-7ddf9103c28b.
- Genomfört 2026-11-17; tider i systemevidens är UTC. Ingen verklig betalning eller ny kundsignatur utförd.

## Quality gates
CI kräver nu även npm audit --audit-level=high efter installation. Full audit efter Vite-patch: 0 high/critical/moderate, en low i esbuilds Windows utvecklingsserver; production-only audit 0.

| Gate | Resultat | Evidens |
|---|---|---|
| Kanoniskt npm run verify | PASS | 117 kod-/DB-tester, alla migrationer i isolerad PGlite, provenance, Edge/web typer, produktionsbygge och 10 publika prerenders |
| Produktionsberoenden | PASS | npm audit --omit=dev: 0 kända sårbarheter i resultatet; ingen garanti om frånvaro av okända sårbarheter |
| Tidigare full Chromiumsvit | PASS | 66 browserfall på baseline; nya URL-/detaljfall inväntar ny CI (68 browserfall totalt) |
| Railway | PASS | 2/2 tjänster online, inga rapporterade problem/fel senaste 24h, inga väntande ändringar |
| Verklig worker readiness | PASS | ready=true och färsk DB-heartbeat; separata verkliga scan/PDF-kontroller styr denna heartbeat |
| Driftkö | PASS vid observation | 0 failed/reconcile, 0 löpta running-leases, 0 finalizing, 2 färdigställda fall |
| Databasmigrationer | PASS metadata/replay | 18 hosted migrationer, senaste 20261117104850; isolerad clean replay i tester passerar |
| RLS/private storage | PASS | Alla publika al_-tabeller har RLS, inga direkta anon/authenticated-tabellgrants i al_private, båda dokumentbucketar är privata |
| Auth säkerhetsadvisor | ÅTGÄRD KVAR | Leaked Password Protection Disabled. Inställningen kan inte ändras med tillgänglig Supabase-anslutning |
| DB health advisor | PASS | Inga health-lints |
| DB performance advisor | P2 KVAR | 33 FK-indexnoteringar, en auth-initplan-varning, 2 oanvända index. Inget belastningstest eller indexändring gjord utan arbetslastbevis |

## Scenario summary
| ID | Prioritet | Flöde | Miljö och resultat |
|---|---|---|---|
| PROD-001 | P0 | Publik sida, priser, kontoformer | PASS i riktig Chrome mot produktion; företag och privat visar rätt fält; ingen kontoregistrering skickad |
| PROD-002 | P0 | Oinloggad/ogiltig JWT/otillåtet Origin | PASS live Edge: 401/401/403, no-store och request-ID |
| PROD-003 | P0 | Signering med ogiltig länk/JSON/för stor body/saknat beslut | PASS live Edge; samtliga nekade, inga giltiga signeråtgärder |
| PROD-004 | P0 | Företagsisolering/reader/server-RPC/statusmutation | PASS hosted tests/production-release-smoke.sql med faktiska Postgresroller och rollback |
| PROD-005 | P0 | Superadmin och MFA-kontext | PASS DB-rolltest: vanlig användare nekas; admin aal1 nekas. Injicerade testclaims är inte bevis på mänsklig MFA-inloggning |
| PROD-006 | P0 | API betalspärr och återföring | PASS hosted: obetalt nekas, syntetisk referens tillåter, återförd referens nekar. Allt rullat tillbaka, ingen betalprovider kallad |
| PROD-007 | P1 | Dokumentfält/stale generation/annan tenant/låst avtal | PASS hosted editor-smoke med nya isolerade test-ID:n och rollback |
| PROD-008 | P1 | CSV atomik/replay/konflikt/annan tenant | PASS hosted import-smoke och rollback |
| PROD-009 | P0 | Ny signup→bekräftelse→login→MFA i riktig webbläsare | BLOCKED i denna körning: ingen inloggad testidentitet i granskningens browser. Formvisning och simulerad CI räknas inte som live Auth |
| PROD-010 | P0 | Nytt utskick→mänskligt godkännande→slut-PDF/ZIP→mail | BLOCKED: tariff saknas, ny mänsklig testunderskrift och aktuell filnedladdning inte gjorda. Två tidigare färdiga fall finns: 4/4 registrerade PDF/ZIP-objekt återfinns i privat Storage och 4/4 har lagrad SHA256 i rätt format. Ett av två godkännanden har den nya evidensstrukturen med namn, personnummer, hash och servertid (äldre dokument skrivs inte om). Inga personvärden lästes ut. Lagrade metadata är inte en oberoende hashkontroll av nedladdade bytes och ersätter inte ett nytt genomgående test |
| PROD-011 | P0 | Automatisk betalning/provider-webhooks/avstämning | BLOCKED: separat Avtalslänk betalningsanslutning saknas; inga avgifter dras |
| PROD-012 | P0 | Backup/restore för DB och dokumentobjekt | NOT RUN: inget dokumenterat återläsningsprov eller åtkomst till backupinställningar i tillgänglig connector |
| PROD-013 | P1 | Mobil/desktop/resiliens/knappar | Chromiumsvit med syntetiska API-svar; nytt slutresultat i CI krävs efter rättningarna |
| PROD-014 | P1 | Riktig parallell prisändring/utskick | NOT RUN fleranslutningstest; tidigare connectorförsök bevisade inte överlappning. Transaktions-/stale-kontroller är funktionstestade |

## Failures and fixes
- DEFECT-003: full npm-audit hittade Vite dev-server-advisories i 7.3.1. Uppgraderat till 7.3.8 med låst lockfil. Detta gäller bygg-/utvecklingsmiljön; Vercel serverar statiskt bygge, inte Vite dev-server. Full verifiering och browsersvit körs med patchen. Kvarstående esbuild-notering gäller Windows utvecklingsserver (low); den körs inte i Linuxworker eller statiska webbdriften. Ingen tvingad inkompatibel transitive-override infördes. Referenser: https://github.com/vitejs/vite/security/advisories/GHSA-v2wj-q39q-566r och https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr
- DEFECT-001: faktiskt Chrome visade Logga in men URL stod kvar på /signup. Reload kunde därför öppna fel formulär. Mode och kanonisk URL synkas nu, inklusive återställning /login?mode=reset; inbjudningslänkar påverkas inte. Browserregression verifierar byten och refresh.
- DEFECT-002: EnvelopeDetail väntade fortfarande obegränsat på dokument/mottagare/händelser. Nu begränsad samlad läsning; även öppning från signeradsökning har deadline. Browserregression verifierar timeout och återgång till avtalslistan.
- Första editor-smoke krockade med ett äldre test-ID i databasen. Ingen gammal data ändrades. Samma scenario kördes med nya isolerade ID:n och passerade; read-back visade noll nya användare efter rollback.
- Första nya release-smoke använde ett ogiltigt syntetiskt nyckelprefix och stoppades med INVALID_KEY. Prefix rättades enligt faktisk domänregel, hela testet passerade och noll testidentiteter/betalreferenser återstod.

## Security / tenancy
Anon-exekverbara SECURITY DEFINER-funktioner är endast offentlig prisprojektion. Authenticated-varningar gäller avsiktliga RPC:er med egna roll-/MFA-/tenantkontroller, vilka rolltestas. Varningarnas närvaro ska inte döljas eller lösas genom att ta bort kontroller. https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Lösenordsskydd mot kända läckor är avstängt enligt advisor. Åtgärd: aktivera i projektets Auth-inställningar och verifiera därefter. https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Ingen separat applikations-rate-limit för signer-endpoints hittades i koden; body-/token-/domängränser finns. Ett kontrollerat trafik-/missbruksskydd och verifierad kapacitet återstår inför bred exponering. Inget lasttest kördes mot kunder.

## External integrations and performance
Senaste tidigare slutnotifieringen kontrollerades med Resend get_email: status delivered. Providerreferens 01a1e6e1-164d-77a4-b1b0-07c8f05c4988 matchar databasens accepted-post. Ingen ny e-post skickades. Detta verifierar en tidigare faktisk leverans, inte ett nytt komplett signeringsprov.

Edge live-smoke: 9/9 förväntade svar, evidens i production-http-results-2026-11-17.json. HTTP200 /health är inte worker-/signeringsreadiness. Observerad klienttid 6–10s inkluderar testmiljöns nät/proxy och ska inte tolkas som en isolerad servermätning. Supabase-loggar senaste 24h: 87 function_edge-händelser, 0 5xx, runtime p95 1640ms/max1996ms vid observation. Vercel error/fatal senaste timmen gav inga loggar; statisk frontend innebär inte att alla browserfel finns där. Chrome-console innehöll endast fel från browserextension, inga observerade appfel i de publika kontrollerna.

BankID, Freja och ritad signatur är avstängda; email_approval är aktiv. IP-underlag är uttryckligen forwarded_unverified, inte oberoende verifierad identitet. E-postgodkännande verifierar inte självdeklarerat personnummer mot e-legitimation. Oberoende tidsstämpling/kryptografisk PDF-försegling ingår inte i den här verifieringen.

## Cleanup
Hosted import/editor/release-smokes kördes i transaktioner och rollback. Separat read-back: 0 nya editor-/import-/release-användare, 0 syntetisk betalreferens. Ingen verklig kunddata ändrad av SQL-testerna. Befintlig äldre smoke-identitet lämnades orörd. Inga betalningar, inga nya mail och ingen fabrikation av användarsamtycke.

## Remaining blockers — exakt nästa steg
1. Besluta och spara dokumentpris, inkluderade signerare och extraprissättning i superadmin. Inget pris hittas på av agenten.
2. Anslut separat betalningskonto om automatisk försäljning/betalande API ska lanseras; verifiera checkout, webhooks, kvitto, avstämning och spärr efter återföring hos riktig provider.
3. Genomför ett aktuellt isolerat browser-test med verklig signup/login/MFA samt en av användaren godkänd icke-bindande underskrift; verifiera nedladdade PDF/ZIP-byte, namn/personnummer, hash/tid, slutstatus, kö och e-posttransport.
4. Verifiera backup + återläsning av både DB och Storage-objekt i isolerad återställningsmiljö, utan att återställa över produktion.
5. Aktivera läckt-lösenordsskydd, verifiera trafikskydd och ett fleranslutningstest för samtidiga pris-/utskicksoperationer.

## Final conclusion
Ingen grön produktionsstämpel ges så länge P0-flöden är blockerade eller oprövade. Kodtester, rolltester, publikt UI och negativa Edge-anrop har separat bevis; de får inte sammanfattas som ett komplett nytt live-signering-/betalningsflöde.
