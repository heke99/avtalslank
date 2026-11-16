# Avtalslänk signing operations

Engineering Startkit 3.0.0 applies through root AGENTS.md. This runbook describes the implemented runtime, not proof that external services are configured.

## Components and release order

1. Apply additive Supabase migrations from the repository; private signing tables must never be added to exposed schemas.
2. Deploy avtalslank-api with its relative dependencies. JWT gateway verification remains false because user JWTs, customer API keys and public signing tokens are checked by the handler and private RPCs.
3. Configure dedicated secrets in provider dashboards, never in git, browser variables or chat output.
4. Railway worker uses apps/worker/Dockerfile and railway.worker.json. It includes qpdf, runs as node, and requires a private ClamAV service. Its /health returns 503 without scanner/database configuration; signingConfigured is a separate field.
5. Deploy the Vercel app and verify account registration/recovery URLs independently. No DNS cutover from OPS is part of this release.

## Dedicated configuration

| Boundary | Required settings | Evidence before activation |
| --- | --- | --- |
| Supabase Edge | SIGNING_LINK_SECRET: dedicated random 32-byte hex string | Same value as worker, never printed; worker fingerprint must match |
| Railway scanner worker | SUPABASE_URL, own SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, optional CLAMAV_PORT | Private Storage read, real clean/infected/malformed PDF results, persisted page count |
| Railway signing | PUBLIC_APP_ORIGIN, same SIGNING_LINK_SECRET, own RESEND_API_KEY, SIGNING_EMAIL_FROM, SIGNING_EMAIL_DOMAIN_VERIFIED=true only after provider verification | Correct environment links; sender domain verified, controlled synthetic recipient test |
| Supabase method capability | al_private.capabilities email_approval enabled by an operator only after checks | Fresh ready heartbeat, successful controlled full journey and final archive validation |
| Vercel | Public Supabase URL/key; API URL | Auth redirects and 390px/touch/keyboard flow verified |

No service credential can be replaced by a publishable key. Do not use Gridex/Flexexa/Kundexa credentials or domains as an automatic fallback. Resend account inspection found other verified domains but no verified avtalslank.se sender; no unrelated sender was adopted.

## Delivery semantics and recovery

- pending: durable queued intent; running: current per-attempt lease; accepted: email provider accepted the request, not proof of delivery; completed: local finalization/webhook acknowledged; failed: retry budget or permanent rejection; reconcile: external outcome unknown.
- Invitations use stable provider Idempotency-Key equal to the persisted effect_key. Timeout/5xx/expired external-effect lease becomes reconcile. Do not manufacture a new key and resend.
- Inspect provider records using known provider reference/effect key. A reconciliation action must be based on verified provider evidence. No customer UI offers blind retry of reconcile jobs in this version.
- Finalization retry is local and writes under a fresh lease-token path. Only the current unexpired lease may publish completion. Orphan files from failed attempts need a separate retention job; originals are never overwritten.
- Original/final bytes and approvals are hashed in the evidence archive. Download is scoped to the organization's current membership or an approved recipient's unexpired link. Once a link expires, the sender can supply the completed document through an authorized process.
- Revoking an endpoint stops future webhook claims; an already in-flight HTTP request cannot be recalled. Consumers must deduplicate event IDs and verify timestamp/HMAC.
- Webhook targets are HTTPS and IPv4 routable only, with pinned DNS and no redirect following. A failure to resolve or an unsafe result never triggers a request to that target.
- Expiry is processed in bounded batches by the worker; token expiry itself is checked synchronously even if the scheduler is unavailable.

## Backups and limitations

Database backup does not include Storage file bytes. Protect private original/final buckets separately. Before restoring, reconcile already-sent effects and preserve later token revocations, consumed decisions and membership changes. Archive cleanup/retention, real provider-delivery event ingestion, independent timestamping/sealing and BankID/Freja remain separate work. No prices, charges or payment provider are activated.
