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

Local verification:93 code/database tests and build/type gates passed. Hosted migration, Edge deployment and browser results pending. Browser requests use network doubles and do not prove real Auth/email/provider flows. Existing signing/payment/runtime gates remain unchanged.
