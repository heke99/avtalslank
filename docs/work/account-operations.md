# Account and operations iteration

Engineering Startkit 3.0.0 applies. Scope: team invitations, invitation landing/account continuation, own membership exit, TOTP MFA, nonce-based password change, global signout, reminders, operational readiness, localized activity and agreement status filtering.

Identity: verified Supabase user before service RPC; invitations bind current confirmed email, organization and offered role. No owner invitations. Active invitations expire after 7 days; revoked/used links never grant fresh membership. The last owner cannot leave. Tokens appear only in a fragment link; server stores the hash. Invitation delivery is explicit copy-link, not a claim that email is configured.

Reminders: sender permission, pending recipient, valid unexpired case/link, current sequential turn, prior provider acceptance. Minimum 30 minutes, maximum 3 reminders per recipient. An uncertain provider outcome requires reconciliation. No new token, status or usage charge is fabricated.

MFA and reauthentication use the installed Supabase SDK. MFA enrollment is optional; once enrolled, AAL2 is required by both direct PostgREST/Storage access policies and Edge user routes. Scoped API keys remain machine credentials. No account enumeration or custom password storage.

Verification: actual PostgreSQL app roles/negative cases and hosted rollback smoke for new RPCs; browser tests for invitations, account controls, reminders and filters. Production provider/Auth paths are separately identified; no real mail/payment test.

Status: all ten implementation parts complete; local/CI/hosted verification passed. Production signing and real Auth delivery remain conditional on the prerequisites below.

No new donor code was imported. All ten features extend Avtalslänk's existing UI, actor/organization controls, audit and durable outbox. The original 18 pinned ports remain unchanged.

Auth release prerequisites: /join/ must be included in the project's allowed Auth redirect URLs. The invitation token is retained with bounded expiry in same-origin local storage to survive confirmation in a new tab; removed on acceptance. Enable Supabase Secure password change for server-enforced nonce validation (Supabase may waive reauthentication for recently signed-in sessions). SDK nonce/confirmation UI alone does not prove server enforcement. Real MFA enrollment, confirmation email and nonce delivery remain unverified without a controlled real account and dedicated SMTP. No user account was enrolled or changed during testing.

Local verification: npm run verify passes with 62 code/database tests, including actual PostgreSQL app-role checks and HTTP-adapter-to-database invitation hashing. TypeScript web/worker/Edge and production build pass; all 18 source-port digests pass. Browser checks execute in CI because local Chromium is restricted in this environment.


Hosted evidence 2026-11-16: team_and_operations applied; API v7 ACTIVE. Expanded two-tenant SQL smoke passed and rolled back: wrong email denied, confirmed invite accepted, leave invalidates access, exact accept retry cannot restore membership, last owner denied, readiness projection scoped. Security advisor returned zero findings. Live HTTP: /health 200, unauthenticated /v1/status and /v1/team/invitations both 401. Vercel deployment dpl_B19dnorB44DFdgsWYByDqs3DfbyJ READY at 01d7c337f5abb2e091e386237eec03b355576b92.

CI 43841774864: 62 code/database tests and worker-container checks passed; 13/15 browser cases passed. Two test selectors omitted the visible version in the agreement button's accessible name. Corrected to the explicitly named Open buttons; rerun pending. No production capability was activated.

| Part | Rule owner | Verification |
| --- | --- | --- |
| 1. Team invitation management | al_team_command | PostgreSQL owner/admin, duplicate/revoke/tenant cases; browser form |
| 2. Accept invitation / continue account | al_team_command + JoinInvitation | Confirmed email binding, accept retry cannot rejoin; browser fragment and explicit acceptance |
| 3. Leave organization | al_team_command | Last owner denied, active membership checked after leave; hosted rollback smoke |
| 4. MFA | Supabase Auth + al_can_access + Edge | PostgreSQL AAL1 deny/AAL2 allow; SDK enrollment/challenge/verify transport in browser |
| 5. Password change | Supabase Auth | Browser nonce and confirmation/mismatch; real server Secure password change setting remains required |
| 6. Global signout | Supabase Auth | Browser asserts global logout endpoint and login screen; JWT lifetime explicitly disclosed |
| 7. Reminders | al_remind_signer | PostgreSQL pending/cooldown/max/reconcile/signed/foreign envelope; browser queue/error |
| 8. Operational status | al_operational_status | Tenant denial, own queue projection, authenticated Edge and browser status |
| 9. Swedish activity labels | domain/activity | Browser activity history; raw event kind retained in export |
| 10. Agreement status filter | App | Browser draft/completed/all control with actual rendered rows |

Provider/Auth browser tests use network doubles. PostgreSQL tests run the actual migration and roles; the hosted smoke runs against the real Supabase project and rolls back synthetic data. These are distinct forms of evidence.

CI 43842202287 passed 14/15 browser scenarios; the remaining status filter label included its option text. Added an explicit accessible name to the select and updated that scenario. All existing signing/reminder/MFA/account scenarios pass. Final rerun pending.

## Final release evidence

Verified code commit: 9a7ae8d117307efd83d200755f369ebc7e59c8fa.
[CI run 43842681609](https://github.com/heke99/avtalslank/actions/runs/43842681609): SUCCESS. 62 code/database tests, 15 Chromium scenarios and worker-container job all passed. Web, worker and Edge TypeScript checks, production Vite build and 18 pinned donor provenance checks passed. Two earlier browser-selector failures are resolved; no checks were removed or weakened.

Web deployment dpl_13e4V9yeh8LiYSbrJTqza7hLMFh6 READY at that commit. Stable address: https://avtalslank.vercel.app. API v7 ACTIVE; database migration applied. Post-smoke verification found zero synthetic users/invitations remaining; ordinary authenticated clients have neither team-command execution nor private invitation-table SELECT. Supabase security advisor returned zero findings. Existing avtalslank.se/OPS DNS was not cut over.

Release verdict: this account/operations code is implemented and verified at the levels above. NOT a verified live signing service: Railway worker has no dedicated credentials/deployment, real ClamAV/Resend delivery is unverified, avtalslank.se sender is not configured, and BankID/Freja/drawn signing remain disabled. Email signing also remains disabled live. Real Auth enrollment/email verification/nonce delivery and project redirect/secure-password settings require controlled verification. No real recipient email, charge, provider signature or user-account MFA change was performed.

Next exact work: provision Avtalslänk's own runtime/scanner/shared signing key and verified sender; configure Auth redirects and password protection; run controlled real account and signing flows. Activate each signing capability only after its actual delivery/evidence path passes. Billing remains unconfigured, with no selected subscription/document price or payment provider.
