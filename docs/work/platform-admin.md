# Plattform och API-betalspärr 2026-11-17

Separat privat platform_admins-register. Ingen automatisk roll från e-post, företagsägarskap eller signup-metadata. /admin och al_platform kräver autentiserad användare, aktiv plattformsroll och AAL2 för all administration. Status ger endast egen admin/MFA-indikator. Ingen generell RLS-genväg eller impersonering.

Funktioner: sök upp till 200 bolag/privatarbetsytor, se medlemskap med e-post och roller, senaste 100 avtal (översikt utan råa dokument/personnummer), senaste 50 adminhändelser, spärra/återöppna API, återkalla bolagets nycklar, ändra befintliga medlemsroller/aktivitet med sista-ägare-skydd. Mutationsanledning 10–500 tecken krävs. Administrativa läsningar och mutationer loggas i privat, ändringsskyddad audit. Betalreferenser har bestående unik historik; samma referens kan inte flyttas mellan bolag eller perioder.

Kund-API: alla nyckelvägar får central assert_key_live-kontroll inklusive gamla dispatch/cachade svar och flow_context. Edge ger HTTP402 PAYMENT_REQUIRED innan routing. Företagsmedlemskap, scopes, återkallelse och utgångsdatum gäller fortfarande. Webappens interna användarsessioner och publika signeringslänkar är separata flöden och spärras inte som kundintegrationer. Ingen kostnadsfri API-exemption för superadmin eller äldre nycklar.

Alla kund-API-rättigheter är spärrade som standard. Just nu kan endast tidsbegränsad subscription-rätt registreras, med faktiskt bekräftad betalreferens och max ett års period. Detta är manuell registrering, inte en genomförd kortdebitering eller en verifierad provider-webhook. Betalningsleverantör/priser är inte valda. Per_document/hybrid finns i modellen men aktiverar inte API förrän dokumentkrediter, reservationer och återbetalningsregler är implementerade.

Bootstrap: operatör tilldelar första admin till ett redan verifierat auth.users-id via betrodd serveradministration. Ingen befintlig användare hittades för hekmat.h@div3rsa.com vid kontrollen. Därför har inget annat konto fått rollen. Efter registrering/verifiering tilldelas exakt detta konto; MFA måste slutföras före adminanvändning.

Verifiering: npm run verify 108 tester och build godkända. SQL testar plattformsroll/AAL2, sista ägare, ogiltigt betalupplägg, spärrad API-nyckel/dispatch, återaktivering och utgången rätt. Ny browserkontroll för adminpanel och nekad vanlig användare tillagd. Drift/CI kontrolleras efter publicering.
