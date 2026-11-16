# Implementation checkpoint

This repository was initially empty. Implementation is isolated from source repositories and uses the existing Avtalslänk Supabase project.

## Ported sources

Pinned original Kommunsign crypto, evidence, contracts, webhook, validation-client, document processing and BankID/Freja modules are recorded before import in `reuse-manifest.json`. Kundexa signature viewport preservation is ported. No DocuSeal-attributed algorithms were imported because the separate rights have not been verified for this new product.

Adaptations: `.ts` imports for cross-runtime modules; Avtalslänk evidence schema name; explicit ArrayBuffer-backed byte copies for current TypeScript WebCrypto/Blob types. Original application authentication is replaced with Supabase Auth, not run in parallel.

## Security and behavior

- All organization resource queries are scoped. Composite foreign keys prevent cross-organization relations.
- Authenticated clients only SELECT permitted rows; controlled SECURITY DEFINER RPCs check actual active memberships before mutation. No client writes completion, evidence or usage state.
- API dispatch authenticates key hashes and scopes, derives organization/actor from the key, and uses a transaction-scoped principal. Idempotency compares the entire request and rejects changed payloads.
- All capabilities default to disabled. Drafts may choose a future method, but sending requires verified capability, ready documents and a qualified delivery path.
- Private upload paths are organization/envelope/document UUIDs. No object UPDATE policy is provided. Scan work and audit commit with document registration.
- Worker leases are attempt-specific and checked on completion. Bytes are checked against stored size/hash and both malware and PDF tools must report before readiness.
- Billing stays unconfigured. A payment provider, price and commercial model are intentionally absent.

## Verification record

Local verification: 20 domain/security/PostgreSQL tests passed, including two tenants, reader denial, immutable uploads, scoped/revoked API keys, idempotency, worker lease binding and unconfigured billing. Type checking and production build passed. Production dependency audit: 0 vulnerabilities after updating Zod to 4.6.7.

Hosted verification: both migrations applied to Avtalslank Supabase. RLS is enabled on all 11 public tables, private document bucket verified, transactional hosted two-tenant smoke test passed and rolled back. Supabase security advisors returned zero findings after moving privileged implementations into the private schema and exposing invoker wrappers. Edge API v2 deployed: health 200; unauthenticated envelope API 401.

Railway: private project `d6d18789-7d93-4c36-ab98-6bdff50109fe`, staging `30204f54-6210-480f-9f3d-e1047e15fccb`, empty document-worker service `e73cd74a-3a1d-437e-86e4-ed1709a59ded`. No worker deployment is claimed before credentials and scanner configuration.

Local browser suite could not start Chromium because the execution environment denies its process-singleton socket. Cloud browser could not reach this workspace's loopback. GitHub Actions includes the same browser suite on an independent runner, but no CI run is claimed: publication was blocked before push. Local Deno could not reach the npm registry; the Edge source was typechecked against installed SDK types and successfully bundled/deployed by Supabase. Container/BankID/Freja production checks are NOT RUN until configured. Browser network doubles verify UI behavior only; they are not production auth/provider evidence.

## Publication status

The implementation is committed locally. Automatic approval review rejected the push to the public `heke99/avtalslank` repository because the request to build was not considered explicit approval to publicly publish organizational code/metadata. No alternative upload path is used. User approval for public publication is required before pushing or running GitHub Actions. Existing donor repositories were not changed.
