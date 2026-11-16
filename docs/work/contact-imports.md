# Contact transfer — 2026-11-16

Engineering_Startkit_v3.0.0 remains the baseline. Extend Avtalslänk's existing contact model, membership/scope checks, API boundary, shared CSV escaping and HTTP client. No donor connection, imported secrets or extra package dependency.

| Part | Rule / implementation | Verification |
| --- | --- | --- |
| 1. CSV reader | UTF-8, BOM, quotes/escaped quotes/newlines, comma or semicolon; 256KB/30 columns/200 contacts | pure parser cases and browser |
| 2. Column mapping | explicit indexes, different name/email/company columns; optional company | pure + browser reordered columns |
| 3. Preview | local display before confirmation; no raw file upload/storage | browser asserts zero POST before confirmation |
| 4. Validation | names/emails/company lengths, normalized email, indexed error messages | pure + all-or-nothing database test |
| 5. Duplicate policy | duplicate emails within batch reject; existing/archived emails skipped | DB preserves names/version/archive state |
| 6. Atomic import | service-only RPC; active member write permission and tenant object ownership | real PostgreSQL checks + hosted smoke |
| 7. Replay safety | per-org UUID and normalized ordered-payload hash; org advisory transaction lock | identical replay, changed payload conflict, revoked-key denial |
| 8. History | latest20 receipts: counts/reference/time; no raw rows in receipt | member/tenant checks, client direct access denied |
| 9. Export | only visible current-company subset from loaded500; formula-safe CSV | shared escaping test, browser filtered export |
| 10. API | GET/POST /v1/contacts/imports; same transaction as UI | adapter→database, scoped key test and OpenAPI0.7 |

Input is prepared locally, then POSTed as structured rows. Raw CSV is never retained on the server or localStorage. Imported contacts are intentional customer records; receipt hashes/actor metadata are still subject to the product's retention procedures. Receipt history is not an anonymous audit guarantee or a completed retention policy.

No overwritten/restored existing contact, invitations, emails, billing events or charges. No partial import after invalid rows. Server validates all rows before mutation; ordinary concurrent contact creation is protected by the unique organization/email constraint and ON CONFLICT DO NOTHING. Imports serialize through a tenant advisory lock; ordinary contact edits need not acquire that lock, avoiding a parent-row/audit FK lock cycle. The replay cache is checked only after current scope/membership/expiry checks. No automatic POST retries.

A lost response may be retried manually with the same current preview/reference. Reference is component-memory only; choosing another file/mapping starts a new import. After leaving/reopening the page, a repeated file has a new reference but existing emails still skip. Receipt count is the historical original result, not current contact state. Export adds a leading apostrophe for formula-like cells; reimport does not strip that protection automatically.

Local verification:93 code/database tests and build/type gates passed. Hosted migration, Edge deployment and browser checks completed as recorded below. Browser requests use network doubles and do not prove real Auth/email/provider flows. Existing signing/payment/runtime gates remain unchanged.

Migration deployment record: Supabase assigned version20261116195314 to contact_imports. The CLI-created local file was renamed to that recorded version after applying; its SQL content is unchanged. This aligns this migration's filename with hosted history without reapplying schema or editing migration statements.


## Final verified release

Verified application code **4c29e43bbe68de26dbf96d536ee2256681d0b359**. [CI43945151803](https://github.com/heke99/avtalslank/actions/runs/43945151803): **SUCCESS** —93 code/database tests,38 Chromium scenarios,18 pinned provenance checks, Edge/web/worker type checks, production build, ten public prerenders/OpenAPI/sitemap and packaged worker-container checks. No skipped scenarios. Initial CI43944394182 also passed; visual inspection then found and corrected the inherited mobile table style hiding email. The regression asserts that email cells remain rendered at390px. All preview columns remain available through the labelled keyboard-focusable scroll region.

Hosted contact_imports migration version20261116195314 applied. tests/import-hosted-smoke.sql passed and rolled back: normalization, stored replay, changed-payload conflict, whole-batch rollback, skip-existing behavior and foreign-tenant history denial. Zero synthetic import users remain. Ordinary authenticated clients cannot execute the privileged RPC directly. Security advisor returned zero findings. Functional tests cover the transaction and lock path; no separate multi-session load/concurrency test is claimed.

API **v10 ACTIVE**; live health200, unauthenticated import history401. Vercel **dpl_HzESR78GvhLpuLjGf9q2mbqSJzGt** READY at the verified application commit4c29e43. OpenAPI0.7.0 describes both endpoints, body/reference rules, scopes, limits, results and replay conditions; includes structured request/response schemas and a synthetic example. Browser artifact **14263787946** contains final desktop/mobile evidence; images reviewed, with the corrected mobile email column visible and no page-level horizontal overflow.

All ten scoped parts complete and published. No real customer contact import, recipient email, provider signature or charge was performed. Browser mocks are separate from actual database role/tenant checks. Signing/payment readiness remains unchanged; dedicated runtime/scanner/sender, real Auth/provider acceptance tests and final processor/retention terms remain outside this verified contact release. Donor projects and original avtalslank.se/OPS DNS were not changed.

Next exact work: dedicated runtime and sender provisioning, then controlled real account/signing acceptance. Preserve this importer’s skip-existing and current-authorization-before-replay guarantees. Extend the loaded500-contact list with server pagination before claiming whole-company export or search at larger volumes.
