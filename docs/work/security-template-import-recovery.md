# Säkerhetsstatus, mallar och CSV 2026-11-17

- MFA-status hade inget skiljt tillstånd för okänt och inga registrerade faktorer. Efter listfel kunde ny installation erbjudas. Nu erbjuds installation först efter lyckad listning; separat uppdatering återhämtar läsningen. Inga MFA-kontroller eller mutationsregler ändras.
- Fältmallistan kunde vänta obegränsat och saknade återförsök. Nu 12s väntan, synligt fel och explicit läs igen. Ingen mall tillämpas automatiskt och befintliga osparade dokumentfält bevaras.
- Två CSV-filval kunde avslutas i omvänd ordning. Äldre fil kunde då ersätta senaste förhandsgranskning och importreferens. Versionsnummer avvisar äldre resultat och fel; aktuell avgränsare används efter filinläsning. Filkropp har 12s väntan. Inget importanrop startas vid filval och idempotensreferensen för okänt importutfall bevaras som tidigare.

Verifiering: npm run verify (117 kod-/DB-tester, typer, provenance, bygge). Browserfall för misslyckad faktorläsning och återhämtning, mall-timeout och återhämtning utan tillämpning, samt omvänd ordning på två CSV-filval. Browser körs i CI med syntetiska nätverkssvar och syntetiska filer; inget bevis på verklig MFA-installation eller kundimport. Inga databasändringar.
