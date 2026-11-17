# Signerad sökning och dokumentpris – 2026-11-17

Implementerat: serverpaginering på signerade/färdigställda avtal, sökning på titel, mottagarnamn, faktiskt angivet signaturnamn, e-post, mottagarföretag/orgnr och avsändarföretag/orgnr. /v1/signed-search använder verifierad actor/API-nyckel och befintlig medlems-/scope-/betalspärr. Kunden ser bara sin arbetsyta; al_admin_search_signed kräver plattformsroll+AAL2 och audit. Ingen PNR/IP/proof eller lagringsadress i sökresultat. Sökning finns under Avtal och i superadmin. Mottagarföretag/orgnr sparas i utkast; orgnr valideras. Nya ärenden fryser avsändarföretagets uppgifter; äldre ärenden faller tillbaka till sparat arbetsyteföretag och kan sakna mottagarföretag.

Dokumenttariff per arbetsyta: grundpris/PDF, inkluderade signerare och tillägg per extra signerare. Superadmin sparar nya oföränderliga versioner med revision och anledning. Inget verkligt pris har hittats på eller lagts in. Saknas tariff nekas utskick tills administratören satt den.

quote-RPC beräknar från serverns dokument/antal signerare och senast sparad tariff. UI visar pris och kräver uttrycklig acceptans; send kräver priceHash och återkontrollerar i samma låsta affärstransaktion. Ändrat pris/antal/generation ger PRICE_CHANGED och rullar tillbaka ärende/länkar/outbox. Upprepat redan skickat ärende återanvänder befintlig snapshot och pris.

Efter verifierad PDF-finalisering registrerar DB-trigger en immutable kostnadspost per dokument och unik leverantörsjobbpost. En signerare måste ha godkänt enligt varje fryst mottagarpost. Återförsök skapar inte fler poster. Pris finns i signing_cases.price_quote. Gamla färdigställda ärenden utan quote efterdebiteras inte och får inte ny quote i efterhand. Belopp heltalsöre, SEK exkl. moms.

Automatisk extern debitering är fortsatt blocked_provider: det separata Stripe-kontot/adapter/webhooks är inte anslutna. Registrerad dokumentkostnad är inte en genomförd betalning. Ingen ny betald API-rätt ges av tariff eller kostnadspost.

Verifiering: npm run verify: 114 tester, typkontroller, proveniens och build godkända. Befintligt integrerat HTTP→PostgreSQL→worker→riktig PDF/ZIP-test kräver nu prisquote och testar stale hash innan giltigt utskick. SQL testar slutkostnader, replay, immutable quote, annan tenant, företagsnamn/orgnr/e-post/namn, cursor och admin. Hosted rollback: 2 PDF och 3 signerare beräknades till 1500 öre/PDF och 3000 öre totalt; data återställda. Browserfall uppdaterat för prisgodkännande och nytt sök-/pagineringstest tillagt. Drift/CI-resultat kontrolleras efter publicering.
