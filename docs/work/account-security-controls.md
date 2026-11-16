# Account and integration controls — 2026-11-16

Engineering_Startkit_v3.0.0 remains the baseline. Existing 18 donor ports and runtime separation remain unchanged. This iteration extends Avtalslänk's own account/API layer; no new donor credentials or external project dependency.

| Part | Rule owner / implementation | Verification |
| --- | --- | --- |
| 1. Frozen terms | private legal registry; published HTML snapshot with matching SHA-256 | database/file digest equality; immutable triggers |
| 2. Explicit acceptance | service-only al_legal_account; verified JWT actor, confirmed email, exact version/hash and true checkbox | wrong hash/checkbox/email rejected; idempotent server timestamp |
| 3. Own history | user-only account route and Settings panel | another user's empty history; authenticated direct RPC denied |
| 4. Plan interest | private commercial_preferences, admin RPC with optimistic revision | reader/foreign tenant denied write; stale revision denied; billing remains disabled |
| 5. Expiry | central key guard at dispatcher, executors and flow_context | expired keys denied at reachable API entry points |
| 6. Atomic rotation | al_manage_keys organization/key locks, existing issuer reused | old invalid/new valid; scope/expiry inheritance; duplicate hash rollback |
| 7. Last-use metadata | successful key calls, throttled one minute | real query updates timestamp; UI shows Stockholm time |
| 8. Revoke all | admin org-scoped transaction across all rows | another tenant's key remains unrevoked |
| 9. Search/status | bounded metadata list and pure filters | expiry boundary, status precedence, intersecting search; browser scenario |
| 10. Webhook rotation | disabled endpoint row lock + unresolved outbox gate | active/foreign/reconcile denial; secret replacement; endpoint stays disabled |

No automatic acceptance or paid plan activation. Signup user_metadata remains untrusted. Acceptance is individual account evidence, not an executed paid order or DPA. Acceptance immutability is not a complete retention/deletion policy; controlled account erasure/legal retention procedures remain to be finalized. Existing public archive is unchanged. New snapshots must use a new version; generator rejects changed content at an existing path.

Keys are random 256-bit opaque tokens; only hashes persist. Secrets are shown once in component memory, never in audit or localStorage. Rotation inherits permissions and expiry. POSTs are not automatically retried. After a lost create/rotation response the administrator must inspect metadata and revoke/recreate a lost credential. Revocation affects subsequent authentication checks; requests already authorized may finish. Existing legacy key issuance remains compatible and has no expiry by default. No organization-wide expiry policy is invented.

Webhook rotation cannot proceed while pending/running/reconcile deliveries exist. Do not force rotation past unknown delivery outcomes. Recipient configuration is manual; never reactivate automatically. Actual provider delivery remains unverified until the dedicated worker/sender is configured.

## Evidence

Local npm run verify: 80 code/database tests passed, 18 provenance checks, Edge/web/worker TypeScript checks, production build and ten public prerenders. Five new PostgreSQL subscenarios include a real HTTP-adapter→RPC→database boundary; browser scenarios are separately run in CI with network doubles. Browser tests are not real Auth/provider evidence.

Hosted account_security_controls migration applied. Expanded two-tenant server-role smoke passed and rolled back; zero synthetic users remain. Terms hash a866f2eb3f0ae8a3ae7765efac8a56e705763f56c38c042874de9613e6f390cf matches the served immutable HTML (HTTP200). Security advisor: zero findings. Direct authenticated execution of new security RPCs denied. API v9 ACTIVE; live health200, unauthenticated legal/key routes401. OpenAPI0.6.0 served200. Vercel dpl_9mjTdFA155MMhJa3dcgAMH6oJrYR READY at initial code6df28ed.

Final review added expiry denial before a real cached mutation response and confirmed rejected-scope calls do not persist last-used timestamps. Fixed bulk-revoke UI availability: all-company revocation remains accessible even when the bounded list has no active entries. Browser status assertion targets the actual record instead of the similarly named select option. CI and final follow-up deployment results pending.

First CI43922396991: 80 code/database tests and container checks passed; 29/31 browser scenarios passed. Two new scenarios had selector failures: status matched both select option and record, and plan label included nested option text. Narrowed the first to the record and gave the plan select an explicit accessible name; assertions remain intact. Full rerun required.

## Final release verdict

Verified code: **0c3e0725f8410fa6aa425b09dbe38eee338dbbac**.
[CI43923517826](https://github.com/heke99/avtalslank/actions/runs/43923517826): **SUCCESS** — 80 code/database tests, 31 Chromium scenarios, 18 pinned donor provenance checks, web/worker/Edge type checks, production build, ten public prerenders/OpenAPI/sitemap and packaged worker-container checks. No skipped tests. Prior CI43923033992 also passed; the final run strengthens settled-mobile-menu assertions and visual capture.

Browser artifact14254837648 contains desktop/mobile key controls and account-settings evidence. Images were downloaded and visually inspected: labels, permission controls, secret display, record actions and plan/terms history fit the layouts; the 390px page has no horizontal overflow and the closed mobile sidebar is fully offscreen before capture. Screenshots use synthetic credentials only. These are UI/network-double checks, not real customer authentication or delivery evidence.

Vercel **dpl_BHjoxVnKN7tfSNFmV5X1YUcsTrzs** READY at that code commit; https://avtalslank.vercel.app/. Supabase migration account_security_controls applied, API v9 ACTIVE. Hosted smoke passed with complete rollback and zero synthetic users. All four key entry/delegation functions contain the expiry guard. Security advisor: zero findings. Live health200; unauthenticated legal/list and API-credential access to user-only key administration401. Served terms200 with matching immutable hash; OpenAPI0.6.0 served200. Snapshot generator rerun produced identical bytes and left the repository unchanged.

All ten scoped parts are implemented, deployed and verified at these levels. Payment remains unconfigured; no price, charge, subscription or entitlement was invented. Real Railway worker/scanner/verified sender, actual Auth email/secure password/MFA flows, real BankID/Freja identity and evidence verification, processor/retention annexes and controlled live signing remain outside this verified release. Account-acceptance records are synthetic in tests and no real person's terms were accepted by automation. Original avtalslank.se/OPS DNS and donor projects remain unchanged.

Next exact work: complete dedicated runtime/Auth/email provisioning, execute controlled real registration and signing flows, and finalize processor/retention terms. Use the implemented lifecycle controls for credentials; preserve unresolved-delivery rotation blocks. Implement paid-order acceptance/entitlements only after the commercial model is decided.
