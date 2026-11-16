# Templates and agreement editing — 2026-11-16

Build baseline: Engineering_Startkit_v3.0.0, unchanged. Runtime remains standalone. This iteration extends Avtalslänk's own previously ported domain/RPC/UI layers; no donor project or secret is connected or changed.

| Part | Implementation | Verification target |
| --- | --- | --- |
| 1. Template search | name, field label, role; explicit no-match result | pure filters + browser |
| 2. Template sorting | Swedish name, field count, version, stable ID tie-break | pure + browser |
| 3. Role editing | per-field role input, explicit non-empty bounded roles | pure + saved browser payload |
| 4. Required fields | editable boolean preserved in field copy | pure + real database persistence |
| 5. Page geometry | page and percentage controls, boundary validation | pure + browser payload + DB |
| 6. Apply template | copies text/date field values to a controlled PDF; fresh IDs, existing fields kept | pure + browser + DB |
| 7. Recipient mapping | every normalized role must map to a current recipient | missing/foreign/inherited mappings rejected |
| 8. Selected placement | choose a field; mouse or arrow keys, Shift=5%, ordinary=1%; page bounds clamp | pure + browser showing first field unchanged |
| 9. Copy field | own ID, offset/clamp, preserved document/recipient | pure + browser submitted values |
| 10. Validity | edit 1–90 days, draft generation retained, starts on send | browser + DB constraints |

Template application is local preparation followed by the existing al_flow_command(fields) authoritative operation. It never sets signed status or readiness. Server validates real envelope/document/recipient binding and generation and locks non-draft envelopes. Editing the source template later does not change the copied values. No dynamic source-template reference or implied signature evidence is introduced. Templates with signature inputs cannot be applied as text/date fields; select an appropriate field template and configure the recipient's signing method separately.

Additional safety: document-field dirty state joins metadata dirty state for sidebar/back/beforeunload protection. Internal step change confirms discard; review save is disabled until fields are saved. Template application does not silently replace existing fields. Failed saves retain edits. Repeated deliberate application makes a new independent copy, bounded by the 200-field limit. Preview URLs are revoked and late downloads after unmount are ignored.

Local verification passed: 87 code/database tests and production build/type checks. Browser network doubles are separate from real PostgreSQL authorization checks. Hosted editor smoke uses synthetic document metadata in a transaction and must roll back; it is not scanner/PDF-processing/provider verification. No schema or Edge change is required. Existing payment/provider gates remain unchanged.


## Verified release

Code **a6baf28e4592a85188c4cf8263376901cebab8f7**. [CI43932138806](https://github.com/heke99/avtalslank/actions/runs/43932138806) **SUCCESS**: 87 code/database tests, 35 Chromium scenarios, 18 pinned provenance checks, Edge/web/worker type checks, production build, ten public prerenders/OpenAPI/sitemap and packaged worker-container checks. No skipped scenarios. Initial functional CI43931322241 and responsive CI43931857813 also passed. Follow-up removes the duplicated field-save message found in visual review.

Hosted tests/editor-hosted-smoke.sql passed on the existing Supabase schema and rolled back. Two synthetic organizations demonstrated template read isolation, cross-company field-write denial, stale-generation denial, saved required/page/expiry values and cancelled-envelope locking. Zero synthetic editor users remained afterwards; security advisor returned zero findings. The ready-document row was a controlled metadata fixture, not an actual scanned upload. No new migration or Edge deploy was necessary; APIv9 remains unchanged.

Vercel **dpl_GY432JRRjCeZqT4F2Tyhwk6DNgHH** READY at that code; stable URL https://avtalslank.vercel.app/. Browser artifact **14260220633** contains template editor and application desktop/mobile views. Images were visually reviewed; 390px dialog/page overflow assertions passed, closed mobile navigation is offscreen before capture, and the final mobile image confirms a single field-save notification. Template dialog scrolls internally to expose remaining fields and save controls. Browser requests/storage/PDFs are synthetic fixtures and are not external provider or real Auth evidence.

All ten scoped parts complete, with additional unsaved-field navigation protection. Donor projects, engineering baseline, runtime credentials, original avtalslank.se/OPS DNS, provider capabilities and billing gates are unchanged. No BankID/Freja signature, email delivery, charge or real customer acceptance was performed. Dedicated runtime/scanner/sender provisioning, controlled real registration/signing verification and processor/retention annexes remain required before the externally integrated signing release.

Next exact work: complete dedicated runtime and sender provisioning and real Auth/signing acceptance tests when their credentials are available. Keep actual copied field values authoritative; consider reusable document assets separately from this field-template feature. Do not infer paid access or verified signing from template metadata.
