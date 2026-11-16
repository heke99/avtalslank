# Signing v1

Baseline: Engineering Startkit 3.0.0, imported unchanged under docs/engineering. Source ZIP SHA-256: 6f18979f0f812c2c4de8beb4077c0b4b719d483b15fd5747f1fae812e27e3481

Actor: organization sender prepares immutable documents; link recipient approves or declines only their own assigned fields. External effects are queued, never performed in the preparation transaction. All signing methods stay disabled until the integrated path is verified. Billing stays undecided.

Ten work items: UPLOAD (bounded PDF API); FIELDS (PDF geometry); ASSIGN (recipient ownership); LINK (hash-bound expiring link); VIEW (recipient data projection); DECIDE (approve/decline with document-bound intent); EMAIL (versioned safe templates/retry); FINAL (original hash verification and final PDF); WEBHOOK (signed event contract/retry); WORKER (configuration/readiness and immutable processing).

Risk: high, covering identity, original document integrity and external effects. Modules alone do not prove database transactions, RLS or end-to-end delivery.

Profiles: React/Supabase, organization isolation, external data exchange. Payments are applicable but commercial activation deferred until model is decided. Offline mutation and AI features are not applicable.

Verification: npm run verify; database tests use actual PostgreSQL roles; browser tests use synthetic transport. Live email/provider and worker checks require their own configuration.

## Checkpoint

Implemented ten core building blocks in packages/signing/src/index.ts, exercised through tests/signing.test.ts: upload integrity/PDF bounds; field geometry; recipient assignment/projection; expiring hash-bound links; snapshot digest; bound approve/decline validation; versioned invitation template and retry policy; separate final PDF; evidence manifest; versioned signed webhook contract and readiness checks. Existing crypto/evidence/webhook primitives are reused.

The web upload now invokes actual PDF parsing and bounds before Storage upload; the existing direct Open action is blocked for unscanned documents. Server scan is still authoritative. The new signing functions are not reachable public signing endpoints. No capability has been enabled.

Implementation status: core modules implemented; full ten end-to-end features are NOT completed. Database-backed token consumption, frozen fields/snapshots, outbox leases, public API/browser signer and delivery/finalization worker still need integration and two-tenant/concurrency verification. Next exact action: introduce an additive migration for frozen document fields, hashed link sessions and transactional outbox, preserving current private-command/invoker-wrapper pattern. Do not store token plaintext in audit.
