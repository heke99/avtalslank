# Account and operations iteration

Engineering Startkit 3.0.0 applies. Scope: team invitations, invitation landing/account continuation, own membership exit, TOTP MFA, nonce-based password change, global signout, reminders, operational readiness, localized activity and agreement status filtering.

Identity: verified Supabase user before service RPC; invitations bind current confirmed email, organization and offered role. No owner invitations. Active invitations expire after 7 days; revoked/used links never grant fresh membership. The last owner cannot leave. Tokens appear only in a fragment link; server stores the hash. Invitation delivery is explicit copy-link, not a claim that email is configured.

Reminders: sender permission, pending recipient, valid unexpired case/link, current sequential turn, prior provider acceptance. Minimum 30 minutes, maximum 3 reminders per recipient. An uncertain provider outcome requires reconciliation. No new token, status or usage charge is fabricated.

MFA and reauthentication use the installed Supabase SDK. MFA enrollment is optional; once enrolled, AAL2 is required by both direct PostgREST/Storage access policies and Edge user routes. Scoped API keys remain machine credentials. No account enumeration or custom password storage.

Verification: actual PostgreSQL app roles/negative cases and hosted rollback smoke for new RPCs; browser tests for invitations, account controls, reminders and filters. Production provider/Auth paths are separately identified; no real mail/payment test.

Status: implementation complete, verification/release in progress.

No new donor code was imported. All ten features extend Avtalslänk's existing UI, actor/organization controls, audit and durable outbox. The original 18 pinned ports remain unchanged.

Auth release prerequisites: /join/ must be included in the project's allowed Auth redirect URLs. The invitation token is retained with bounded expiry in same-origin local storage to survive confirmation in a new tab; removed on acceptance. Enable Supabase Secure password change for server-enforced nonce validation (Supabase may waive reauthentication for recently signed-in sessions). SDK nonce/confirmation UI alone does not prove server enforcement. Real MFA enrollment, confirmation email and nonce delivery remain unverified without a controlled real account and dedicated SMTP. No user account was enrolled or changed during testing.

Local verification: npm run verify passes with 62 code/database tests, including actual PostgreSQL app-role checks and HTTP-adapter-to-database invitation hashing. TypeScript web/worker/Edge and production build pass; all 18 source-port digests pass. Browser checks execute in CI because local Chromium is restricted in this environment.


Hosted evidence 2026-11-16: team_and_operations applied; API v7 ACTIVE. Expanded two-tenant SQL smoke passed and rolled back: wrong email denied, confirmed invite accepted, leave invalidates access, exact accept retry cannot restore membership, last owner denied, readiness projection scoped. Security advisor returned zero findings. Live HTTP: /health 200, unauthenticated /v1/status and /v1/team/invitations both 401. Vercel deployment dpl_B19dnorB44DFdgsWYByDqs3DfbyJ READY at 01d7c337f5abb2e091e386237eec03b355576b92.

CI 43841774864: 62 code/database tests and worker-container checks passed; 13/15 browser cases passed. Two test selectors omitted the visible version in the agreement button's accessible name. Corrected to the explicitly named Open buttons; rerun pending. No production capability was activated.
