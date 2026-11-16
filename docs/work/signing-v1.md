# Signing v1

Baseline: Engineering Startkit 3.0.0, imported unchanged under docs/engineering. Source ZIP SHA-256: 6f18979f0f812c2c4de8beb4077c0b4b719d483b15fd5747f1fae812e27e3481

Actor: organization sender prepares immutable documents; link recipient approves or declines only their own assigned fields. External effects are queued, never performed in the preparation transaction. All signing methods stay disabled until the integrated path is verified. Billing stays undecided.

Ten work items: UPLOAD (bounded PDF API); FIELDS (PDF geometry); ASSIGN (recipient ownership); LINK (hash-bound expiring link); VIEW (recipient data projection); DECIDE (approve/decline with document-bound intent); EMAIL (versioned safe templates/retry); FINAL (original hash verification and final PDF); WEBHOOK (signed event contract/retry); WORKER (configuration/readiness and immutable processing).

Risk: high, covering identity, original document integrity and external effects. Modules alone do not prove database transactions, RLS or end-to-end delivery.

Profiles: React/Supabase, organization isolation, external data exchange. Payments are applicable but commercial activation deferred until model is decided. Offline mutation and AI features are not applicable.

Verification: npm run verify; database tests use actual PostgreSQL roles; browser tests use synthetic transport. Live email/provider and worker checks require their own configuration.

## Integrated checkpoint (2026-11-16)

The ten signing-core parts are now wired into actual request handlers, PostgreSQL commands, web views and worker orchestration:

| Requirement | Rule owner and implementation | Verification |
| --- | --- | --- |
| UPLOAD | connected.ts -> al_flow_command -> immutable private Storage + scan job | real-PG connected journey, bounded stream tests |
| FIELDS | SigningPreparation -> API -> validate_envelope_fields, generation check | same-envelope assignment/page/geometry/stale edit SQL tests |
| ASSIGN | frozen fields and recipient-only projection in al_signer_command | foreign-recipient, other-tenant and private-path denial tests |
| LINK | links.ts HMAC-derived random session ID; DB stores token hash only | key/session binding, expiry, revoke and consumption tests |
| VIEW | Signer.tsx -> public POST handlers -> private case | Chromium recipient journey and invalid-link case |
| DECIDE | al_signer_command locks envelope then link, consent/version/hash checks, exact replay | real-role PostgreSQL, duplicate/changed decisions and sequential release |
| EMAIL | transactional outbox -> signing worker -> versioned Resend request | synthetic transport and persistent accepted/reconcile states |
| FINAL | all signers -> finalize job -> checked originals -> separate PDF/receipt/ZIP -> guarded completion | real-PG request/worker journey, final artifact and unchanged original checks |
| WEBHOOK | event trigger -> durable outbox -> private per-endpoint secret -> DNS-pinned HTTPS | target-policy tests, worker transport and signing event tests |
| WORKER | index.ts -> signingTick, per-attempt lease, scanner page count and key fingerprint heartbeat | lost lease fencing, late attempt, synthetic worker journey |

Ten further behaviors implemented in this integration: (1) sequential invitation release, (2) send replay deduplication, (3) exact decision replay, (4) cancellation after sending and revocation, (5) automatic expiry, (6) sender delivery history, (7) sender evidence download, (8) recipient final-PDF download, (9) webhook registration/deactivation and one-time secret display, (10) fragment-based new links, request/aggregate bounds and explicit unknown-outcome reconciliation.

### Trust and runtime limits

- Orchestration RPCs are service-only. The Edge verifies the user token before passing actor ID, or derives the organization from a scoped API-key hash. Caller JSON never chooses the actor.
- Cases, links, outbox, heartbeat and webhook secrets are private with no client grants and explicit restrictive RLS. Composite constraints bind tenant/case and recipient/envelope.
- Snapshot digest is authoritative in PostgreSQL over the frozen JSONB representation. Client-side core hash utilities are not an alternative authority for a live case.
- New links use /s/#token=...; the fragment is not sent to the frontend hosting server. Legacy path links can still be read. Referrer is suppressed; no analytics are added.
- Email provider acceptance is not mailbox delivery. Uncertain email outcome or a lost external-effect lease requires reconciliation; no blind resend. Provider delivery/bounce webhook ingestion is not implemented.
- Webhook DNS resolution is IPv4-only and validated before the pinned HTTPS socket; redirects are not followed. IPv6-only endpoints are not supported in this version.
- Final PDFs include an email-approval receipt; no claim of a qualified signature or independent PDF cryptographic seal. Signed data and original/final hashes are preserved in the evidence archive.
- PDF field placement has numeric normalized coordinates and an approximate preview overlay, not a pixel-exact PDF.js canvas. No drawn-signature field is enabled.
- Limits: individual originals 10 MiB, 100 pages, at most 20 originals and 50 MiB aggregate at send, 200 fields, 50 recipients, 16 KiB public signing request and 64 KiB ordinary JSON requests.
- Sending remains disabled unless capability, dedicated shared link key, verified email sender and fresh configured worker all exist. BankID/Freja/drawn methods stay disabled. Billing stays unconfigured.

### Evidence and delivery status

Local npm run verify: 58 tests pass, Edge/web/worker typechecks and production build pass. Includes a real-PGlite request -> RPC -> worker -> approval -> final PDF/evidence journey with memory Storage and synthetic scanner verdict/email/webhook transports. This proves orchestration and PostgreSQL behavior, not live Auth, ClamAV, external email delivery or Railway networking. Hosted rollback smoke passes for two-tenant access, fields and fail-closed send; synthetic rows are rolled back. The two additive migrations are installed in Supabase. Security advisors return no findings.

Cloud CI/browser and exact deployment records are appended after observing outcomes. Existing browser suite is extended with recipient approval and invalid-link cases.

### Actual runtime blockers

Railway staging document-worker was inspected: no variables, no source or deployment. The connector exposes only Supabase publishable keys, so this session cannot provision the worker's own server credential. Dedicated worker SUPABASE_SERVICE_ROLE_KEY, scanner host, Resend sending key/from-domain and shared SIGNING_LINK_SECRET still require secure provisioning. No donor credentials are reused. The connected database/API/web code can be delivered while email capabilities remain disabled.

Next activation action: provision dedicated server variables using docs/SIGNING_OPERATIONS.md, deploy scanner/worker, verify live scanner and sender, then run a controlled signing journey before enabling email_approval. No permission to access another product's credentials is inferred from this requirement.
