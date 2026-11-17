# Knappar och administrationslayout 2026-11-17

Utgångspunkt: administrationssidan hade länkar och knappar utan appens handlingsstilar, trång layout och ingen samlad formulärstruktur.

Ändrat: sammanhållen adminheader med tydlig återgång till arbetsytan, sökpanel, tabell med egen horisontell scroll, avgränsade medlems-/betalformulär, primär sök-/betalåtgärd, sekundära åtgärder och särskild riskmarkering för nyckelåterkallelse. Mobilformulär staplas. API-statusens orgnr-fallback skiljer nu privatperson från saknat företagsnummer.

Delade knappstilar har läsbar 13px text, minst 44px höjd, radbrytning och synlig tangentbordsfokus. Textknappar och auth-länkar får samma minsta tryckyta. Befintliga särskilda knappar i produktguiden, menyn och auth-länkarna använder sina egna komponentstilar. Inga backendbehörigheter ändrade.

MFA: verifierad faktor bekräftad i hosted Auth utan att läsa hemlighet. Förhöjd aktuell session krävs fortfarande. Global MFA-vy har nu avgränsad layout och rubrik. Adminvyn uppdaterar sin status efter MFA_CHALLENGE_VERIFIED utanför Auth-callback för att undvika låsning.

Verifiering: typkontroll och produktionsbygge godkända. Browserkontrollen för admin utökad med desktop/mobilskärmbilder och kontroll av att 390px-vyn inte läcker horisontellt. Full CI-resultat kontrolleras efter publicering. Ingen faktisk inloggning i kundens egen browser utförd av agenten.
