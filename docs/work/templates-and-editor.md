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

Verification in progress: 87 code/database tests and production build/type checks. Browser network doubles are separate from real PostgreSQL authorization checks. Hosted editor smoke uses synthetic document metadata in a transaction and must roll back; it is not scanner/PDF-processing/provider verification. No schema or Edge change is required. Existing payment/provider gates remain unchanged.
