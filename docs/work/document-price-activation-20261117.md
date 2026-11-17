# Aktiverat generellt dokumentpris 2026-11-17

På uttrycklig ägarinstruktion sparades global tariff version 1 i produktion: 250 öre per färdigsignerad PDF, 2 signerare inkluderade och 140 öre per ytterligare signerare. Valuta SEK, exklusive moms enligt befintlig pris-/offertmodell. Inget abonnemangspris har lagts till. En signerare använder också grundpriset 250 öre.

Konfigurationen skapades via privilegierad operator-SQL med samma exklusiva globala prislås som domänoperationen. Aktiv plattformsägare verifierades; inga JWT-claims, MFA-bevis, roller eller behörigheter fabricerades eller ändrades. En auditpost anger explicit ägarinstruktion i chat och executionChannel=supabase_operator_sql. Befintliga immutable triggers, historik, bolagsspecialpriser och låsta skickade offerter påverkas inte.

Verifierat i hosted Postgres genom tests/production/document-price-20261117.sql: en PDF/två signerare=250 öre, tre=390, fyra=530; två PDF/fyra signerare=1060. Syntetiska databasposter, ingen faktisk Storage-uppladdning eller signering. Full rollback; efterkontroll visar noll testanvändare. Publik RPC visar samma pris och riktig Chrome på https://www.avtalslank.se/abonnemang visar 2,50 kr inklusive två signerare och 1,40 kr extra, exklusive moms.

Detta löser tariffspärren i tidigare produktionsrapport. Automatisk extern betalning är fortfarande inte konfigurerad och inga pengar har dragits. Aktivering av pris är inte aktivering av BankID/Freja eller en verifiering av ett nytt komplett kundflöde.
