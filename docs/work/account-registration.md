# Företags- och privatregistrering, 2026-11-17

Företag: bolagsnamn, validerat svenskt organisationsnummer, kontaktperson, konto-e-post, valfri företagsadress för e-post och telefon. Privat: fullständigt namn, validerat tolvsiffrigt personnummer, konto-e-post och valfri telefon. Uppgifter är självdeklarerade, inte BankID/Freja-verifierade.

Registreringsutkast fångas i privat tabell innan Auth sparar metadata. Personnummer följer inte med registreringsmetadata till JWT. Bekräftad e-post krävs innan profil, ägarmedlemskap, arbetsyta och inaktivt betalningskonto skapas i samma transaktion. Upprepningar låser användaren och skapar inte dubbla arbetsytor. Ett organisationsnummer ger aldrig rätt till befintligt företag; endast redan aktiv medlem kan koppla sin profil dit utan rolländring. Privat arbetsyta tillåter inte teaminbjudningar. Äldre konton får kompletteringsflöde. Profilrespons visar endast maskerat personnummer.

Kontovillkor version 2026-11-17 och integritetstext uppdaterade för båda kontotyperna. Tidigare dokumentversioner bevarade. Inget betalt abonnemang eller utskicksbehörighet startas genom registrering.

## Verifiering

- npm run verify: 107 tester godkända, 18 provenienskontroller samt Edge/web/worker-typkontroll, produktionsbygge och prerendering godkända.
- Databastest: obekräftad e-post blockeras, korrekt privat metadatahantering, idempotens, privat profilskydd, två användares åtkomstisolering, organisationsnummer utan medlemskap nekas, accepterat medlemskap behåller reader-roll, privat teaminbjudan nekas.
- Browserfall tillagda för företagsregistrering, privat registrering i mobilvy och verifierat registreringsutkast. CI/driftutfall dokumenteras efter publicering.
- Riktigt konto med e-postbekräftelse över olika enheter ännu inte genomgånget i detta registreringsarbete.

## Signerat avtal

Nytt prov 4b721e80-1a17-4d1b-a3db-0bf1d15b6b7c är completed. Faktiska PDF- och ZIP-nedladdningar HTTP 200. PDF verifierad för signerarens namn, personnummer, signeringshash och signeringstid utan att personuppgifter skrivs i rapport. IP finns som forwarded_unverified och är inte identitetsbevis. ZIP CRC, manifeststorlekar/hashar och checksums.sha256 godkända.

PDF SHA256: 5e69c0255ea7e1227dd9ecab13be747853d30dfcbb3edd87d2e78234f6c3a067
ZIP SHA256: 6fdaf6cc01fe7f187a2c13b2ec83c000c58be8423eda0a2edf001efa26773f50
