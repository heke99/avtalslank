# Kontobekräftelse och Auth-mejl

Signup ersätter formuläret med en fokuserad bekräftelsevy, inkorg/skräppost och mottagaradress. Ingen verifieringstoken sparas av denna vy.

/auth/confirm stöder token_hash via fragment (även query för kompatibilitet), tar bort token från adressfältet och verifierar först efter uttryckligt knapptryck. verifyOtp skapar session på enheten som öppnar länken; ingen lokal PKCE-verifierare från signup krävs. Recovery går till /reset-password; övriga till startsidan. Inga externa redirects accepteras. Konsumerade/utgångna länkar visar fel, inte framgång.

Fem svenska mallar finns i supabase/templates: confirmation, recovery, magic_link, invite, email_change. Innehåller inga personnummer eller registreringsmetadata.

## Hosted Supabase – återstående konfiguration

Anslutna verktyg kan inte läsa/skriva Auth-mejlmallar eller SMTP-inställningar. Mallfiler i repot uppdaterar inte hosted-mallarna automatiskt. I projekt ykddnagtuacflilbchwx: Authentication / URL Configuration: Site URL https://www.avtalslank.se, tillåt https://www.avtalslank.se/** i Redirect URLs. Authentication / Email Templates: kopiera motsvarande HTML-fil till Confirm signup, Reset password, Magic link, Invite user, Change email address. Sätt svenska ämnen enligt mallarnas rubriker. SMTP-avsändare Avtalslänk <noreply@avtalslank.se>; befintlig dedikerad Resend-anslutning ska användas, inga andra produkters nycklar. Stäng av klickspårning för Auth-mejl.

Original-Supabase-URL i äldre skickade mejl ändras inte. Efter konfiguration behövs nytt mejl och faktisk verifiering/återställning på annan enhet. Vi påstår inte att hosted Auth-mallarna är uppdaterade innan detta är gjort.
