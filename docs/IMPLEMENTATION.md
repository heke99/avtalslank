# Implementation checkpoint

Current connected-signing release: see [signing-v1](work/signing-v1.md) and [operations](SIGNING_OPERATIONS.md). API v6 and the database/web integration are deployed. The original ten signing blocks are connected and ten recovery/delivery behaviors are implemented. Dedicated worker credentials/scanner/email sender are not configured; live signing and payment activation remain disabled. The sections below preserve earlier foundation evidence and limitations at those earlier checkpoints.

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

## Second implementation: workspace operations (2026-11-16)

1. Recipient editing/removal: draft lock, normalized address, method selection and audit.
2. Atomic recipient ordering: exact complete ID set, duplicate/foreign IDs rejected, deferred uniqueness; removal compacts order.
3. Document detachment: draft-only; cancels scan job, retains original immutable object for later retention cleanup.
4. PDF preview/download: private Storage read, ready-only, SHA-256 checked before object URL; URLs revoked on close/unmount.
5. Draft copying: copies settings and pending recipients only; new ID, no evidence, files or usage carried forward.
6. Contact register: create/edit, archive/restore, optimistic versions, normalized unique email per organization.
7. Reusable contact picker with explicit signing-method selector before adding the recipient.
8. Existing team roles: guarded changes/deactivation, organization lock for last-owner protection, no admin self-escalation. Team invitations are not implemented.
9. Organization profile: admin-only update, name/registration bounds and audit.
10. Field-template lifecycle: copy to independent template, version-checked deletion. These remain field schemas, not complete PDF templates.
11. Activity: bounded keyset pagination and JSON export of the shown page set, explicitly not a signing evidence certificate.
12. Usage: bounded reporting periods, server-recorded counters only, no selected price/provider/model or checkout.

New features use new Avtalslänk code with existing tenant, audit and RPC primitives. No extra donor code or donor credentials were imported. Source repositories remain untouched. The original 18 ports remain pinned and digest-verified in reuse-manifest.json.

## Verification record

Local: 32 domain/security/PostgreSQL tests passed; TypeScript checks for web/worker/Edge and production build passed. Twelve added SQL scenarios include ordering, foreign IDs, contact conflicts, owner protection, document detachment, API scopes/idempotency, activity paging and undecided billing. Provenance: 18 pinned ports verified.

CI: [run 43823147474](https://github.com/heke99/avtalslank/actions/runs/43823147474) passed at commit e3c8019e5675999151995a4781cc98069e534c18, including 32 code/database tests and five Chromium UI tests. Browser tests use mocked transport; they do not prove live Supabase login, provider signatures or email delivery. Screenshots are available in the browser-verification Actions artifact. Local Chromium remains blocked by this workspace's socket restrictions; CI supplies the browser verification.

Hosted: third migration workspace_operations applied. Transactional two-tenant smoke expanded with editing, ordering, contacts, profile, last-owner protection, usage, copying and removal; passed with all synthetic records rolled back. Supabase security advisors: zero findings. API v5 ACTIVE; health 200, unauthenticated resources 401 and fake API key on /v1/methods 401.

Web: Vercel project prj_QstypXKAzXe8Yy3cEX22lEmemfmJ, deployed from e3c8019e5675999151995a4781cc98069e534c18; deployment dpl_2g43jh1mLkT6sBWaZWN2oAEB9VnV READY. URL https://avtalslank.vercel.app. Vercel reports production target on its generated hostname; no custom domain or existing OPS DNS was changed. Live login page inspected visually in browser; workspace UI covered in mocked CI scenarios. No production sign-in credentials were created for review.

Railway: private project d6d18789-7d93-4c36-ab98-6bdff50109fe, staging 30204f54-6210-480f-9f3d-e1047e15fccb, empty document-worker e73cd74a-3a1d-437e-86e4-ed1709a59ded. Worker is NOT deployed/running: its own Supabase server credentials and scanner configuration remain to be provisioned. Documents therefore cannot currently pass the pending scan stage in production.

## Publication and next work

User explicitly approved public publication on 2026-11-16. Foundation and second implementation are published to heke99/avtalslank through the GitHub connection. The prior publication block is resolved.

Not production-ready for signing: public signer sessions, delivery/email, verified BankID/Freja configuration and evidence verification, final PDF/evidence production, full PDF field placement, Supabase Auth redirect URLs/SMTP and real email verification, team invitations, webhook delivery, API file upload, retention cleanup and payment checkout remain. All signing methods remain disabled until those paths are verified. Contact/team/organization administration does not activate signing or payments.

## Final verification addendum

[CI run 43824350412](https://github.com/heke99/avtalslank/actions/runs/43824350412) passed on 6cf9c087a6a9e197946fea698592a0e268a225a7: 32 code/database tests and all six Chromium UI scenarios. The sixth exercises editing, moving, removing and copying recipients and verifies the new draft editor does not keep the old title. Explicit accessible names distinguish manual, saved-contact and edited-recipient method selectors.

The deployed generated hostname was added to the exact Edge CORS allowlist; no wildcard origin access. API v5 includes this deployment-origin fix. Production browser-auth registration, recovery email redirects and SMTP delivery are still unverified; configure the Avtalslänk project's Site URL to https://avtalslank.vercel.app and allow that URL plus /reset-password while testing, then app.avtalslank.se at domain cutover. Do not reuse donor Auth or SMTP credentials.

## UI revision (2026-11-16)

Replaced promotional login and dashboard composition with a compact operational interface: system fonts, navy actions, neutral surfaces, grouped status counters, direct Swedish headings and clearer form contrast. Removed paper illustrations, decorative hero and aspirational copy. Updated browser expectations for the new headings; no database or signing logic changed.

## Account and operations iteration (2026-11-16)

Current account work and evidence are tracked in [work/account-operations.md](work/account-operations.md). Ten additions: invitation creation/revocation; invitation acceptance/account continuation; membership exit with last-owner protection and API-key revocation; TOTP enrollment/step-up with database and Edge AAL2 enforcement; nonce/password confirmation UI; global signout; rate-limited signing reminders; tenant-scoped operational status; Swedish activity labels; agreement status filtering. New Avtalslänk code reuses existing actor, tenant, audit and outbox primitives; no new donor imports.

The historical pending list above predates connected signing-v1 and this iteration. Read work/signing-v1.md and work/account-operations.md for current status. Live provider signing, dedicated Railway/scanner/email credentials and real Auth delivery remain separate release requirements. No payment model or prices were selected; billing remains disabled.

## Public entry and website (2026-11-16)

Public home/hero, product journey, planned Start/Team/API comparison, plan-aware registration, API guide/OpenAPI download, privacy, necessary-only cookie information/settings, account terms, security/data-protection information, help/contact and FAQ are implemented. Ten public pages are prerendered with metadata, sitemap and robots. The signed-in workspace remains at root; signed-out root is public, with explicit /login and /signup. All evidence and commercial/legal launch boundaries are in [work/public-launch.md](work/public-launch.md).

Verified c3f82f1a1afcaeebca7dc2f73106360766ee2f35 in CI 43901686204: 65 code/database tests, 19 browser scenarios, container and build checks passed. No new DB migration or signing capability activation. Planned plan selection is declared interest only; billing remains disabled.

## Register design and workspace usability (2026-11-16)

Replaced the prior split hero/mock document/italic slogan and subscription cards with a full-width register heading, factual service details and ruled subscription rows. Added an interactive walkthrough, method overview, selectable/copyable server API examples, actual-data onboarding checklist, agreement sorting and Swedish-date filtering, current-organization visible-row CSV export with formula neutralization, and restart of unfinished TOTP setup. Full contract/evidence: [work/register-and-workspace.md](work/register-and-workspace.md).

Verified 36bcbee3ec6605c14da7c258ee64c4cdd6f22bc4 in CI 43908629372: 70 code/database tests, 23 browser scenarios, build/type/provenance/static artifact and container checks pass. Live public UI visually inspected; Vercel deployment READY. No billing/provider activation or database migration.
