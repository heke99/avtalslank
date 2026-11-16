# Avtalslänk

Standalone signing product operated by Trafexa Nordic AB (556855-4884). Own repository, Supabase project and deployment configuration. No runtime connections to donor products.

## Run

Node 22+ and npm. `npm ci`, copy `.env.example` to `.env.local` and configure the public Supabase URL/key, then `npm run dev`. Never put service credentials in VITE variables. `npm run verify` runs meaningful domain/Postgres tests and a production build. `npm run test:browser` runs UI tests.

## Foundation delivered

1. React customer workspace and responsive design system.
2. Supabase Auth login, registration and password recovery entry.
3. Organizations and membership-based tenant isolation.
4. Version-controlled agreement drafts and audit events.
5. Per-recipient BankID/Freja/e-mail/drawn method selection in drafts.
6. Private PDF uploads, hashes, immutable storage paths and durable scan jobs.
7. Field-template schema, validation and versioned editing.
8. Scoped API-key issuance/revocation and hidden token hashes.
9. Edge API with server authentication and idempotent API draft creation.
10. Ported cryptography, evidence manifests and webhook security helpers.
11. Ported BankID/Freja adapters with fail-closed verification defaults.
12. Railway document worker and container configuration.
13. Provider-neutral billing/usage extension points with no charges enabled.
14. SQL/RLS, security and browser verification suite.

## Actual release boundary

This is a working draft/preparation foundation, not a production-complete signature platform. Sending is blocked server-side until document scanning, delivery, signer sessions and real provider evidence/finalization are qualified. BankID and Freja adapters exist but no external credential or certificate is supplied here. The recipient URL refuses to claim a signature. Templates currently store fields/roles; PDF-backed drag/drop editing remains to implement. Team invitations, e-mail delivery, full webhook configuration/delivery, native signature finalization and Java signing/validation service deployment are subsequent work. No payments occur.

## Backend and infrastructure

Supabase project: `ykddnagtuacflilbchwx`. Migration source is under `supabase/migrations`. Edge entrypoint: `supabase/functions/avtalslank-api/index.ts`. Source authentication/RLS is not bypassed by the web app. API clients receive Avtalslänk keys, never Supabase server credentials.

Vercel builds `dist`. Railway worker uses `railway.worker.json` and `apps/worker/Dockerfile`, and requires server-only Supabase credentials plus `CLAMAV_HOST` on a protected private network. Its health endpoint returns 503 while configuration is missing. No replacement Postgres or object store is needed on Railway.

Read `docs/reuse-manifest.json`, `docs/PAYMENTS.md` and `docs/IMPLEMENTATION.md` for provenance, boundaries and verification.
