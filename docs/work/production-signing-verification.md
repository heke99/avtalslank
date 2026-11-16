# Controlled production signing verification — 2026-11-16

## Release verdict
RED / pending recipient interaction. This is a partial operational verification, not release approval. No customer contract or payment was created.

## Execution identity
- Repository: heke99/avtalslank, main, 85766dc4c30a1a2f8b9223f54a539dbec6239680 (documentation); runtime code a45151de9500b8d25902bcfd0ac8d7cd91242e44.
- Railway project d6d18789-7d93-4c36-ab98-6bdff50109fe, existing environment 30204f54-6210-480f-9f3d-e1047e15fccb renamed by operator to production.
- Worker deployment 3e881be0-c3f5-46d3-98ea-9aacc6568bf5 SUCCESS. Private ClamAV remains on the same environment.
- Supabase project ykddnagtuacflilbchwx; public Edge avtalslank-api; frontend https://avtalslank.vercel.app.
- Test envelope a40ce212-c775-4666-adde-705ac7c582c1; original document ab0c6278-244d-4489-9ebe-c1937a656bbe.
- User explicitly authorized a test invitation to their supplied mailbox. Recipient data and bearer links are omitted here.

## Scope and isolation
A dedicated synthetic actor (reserved .invalid email), organization “Avtalslänk teknisk verifiering 20261116”, and two-hour scoped API key were provisioned for this controlled API test. This does not prove signup/login or a real sender's Supabase Auth session. The PDF explicitly has no contractual effect, payment or order. Production test records are retained for audit and the recipient's test; no real records are deleted.

Only email_approval was temporarily enabled after verifying the sole organization was the isolated test organization and a fresh ready worker existed. It was disabled again immediately after the one send and idempotency replay. This exercised the existing send gate for the controlled test; it was not general commercial activation. BankID, Freja, drawn signatures and billing remain disabled. No schema or application implementation changes were made.

## Quality gates
| Gate | Result | Evidence |
| --- | --- | --- |
| npm run verify | PASS | Exit 0; 18 provenance ports, Edge types, 100 code/database tests, production build and 10-page prerender/OpenAPI/sitemap checks |
| Live Railway | PASS | production, two online services, SUCCESS deployments, no pending changes |
| Worker database | PASS | Fresh ready=true heartbeat with key fingerprint present; no secret values retrieved |
| Scanner/PDF | PASS | Actual uploaded 1213-byte PDF, ClamAV 1.5.4 CLEAN, qpdf 11.3.0 PASS, one page, persisted job completed on first attempt |
| Current full browser regression | NOT RUN | Prior CI 38-browser evidence remains historical; no new full run claimed |

## Scenario summary and P0 evidence
| ID | Flow | Result | Evidence |
| --- | --- | --- | --- |
| LIVE-01 | Authenticated scoped API draft and recipient creation | PASS | Real deployed Edge API; isolated tenant records persisted |
| LIVE-02 | PDF upload → private Storage → job → scanner/PDF → database | PASS | Document ready, page_count=1, scan report and completed job |
| LIVE-03 | Required field and send → Edge/worker key agreement | PASS | Real send accepted, frozen snapshot and invitation created; server fingerprint gate passed |
| LIVE-04 | Send replay | PASS | Same envelope/snapshot returned; exactly one invitation accepted, attempts=1 |
| LIVE-05 | Application outbox → Resend → mailbox transport | PASS | Provider reference 01a1e64e-9f7b-75d7-8025-e917e3821803; Resend status delivered, sender noreply@avtalslank.se; human receipt not yet confirmed |
| LIVE-06 | Public signer view/document | PASS | Real token view HTTP200, one document/field; download HTTP200 and original SHA256 match |
| LIVE-07 | Bad token and missing sender identity | Recorded in follow-up | See appended check output; neither is a valid identity |
| LIVE-08 | Browser review → recipient approval | BLOCKED | Waiting for the recipient to open and approve the explicitly nonbinding test |
| LIVE-09 | Approval → finalize → final PDF, receipt and evidence archive | BLOCKED | Depends on LIVE-08; no final result claimed |
| LIVE-10 | Production domain cutover | BLOCKED | Both apex/www still assigned to Gridex OPS; plugin add returns domain_already_in_use (409); no move/remove-project-domain tool or authenticated CLI/browser available |

Original SHA256: 0c5326f3d796972592c28e3ed10a2dd7004688c44a795a538cce944dde0c8def. Snapshot hash: 712e0bfee4c29b5a2b3af19e964e798665c83ff17ca874c427cf48d303242fad.

## Domain cutover checkpoint
Verified Vercel team team_e3htkJPyBNSw3Ix1KQLlf180; source Gridex OPS prj_xA3EDI1xztkkyx21e3LY4UhgYrWt, destination Avtalslänk prj_QstypXKAzXe8Yy3cEX22lEmemfmJ. Source owns avtalslank.se (308 to www) and www.avtalslank.se. app.gridex.se and gridex-ops-platform.vercel.app must remain on OPS. Destination currently owns avtalslank.vercel.app only. Existing MX, DKIM, SPF and other email DNS must remain intact.

The authenticated plugin supports adding but not moving project domains. Adding apex failed safely with 409 and no routing change. Browser fallback observed the Vercel login wall; user previously cannot use cloud-browser login. Official Vercel documentation confirms POST /v1/projects/{source}/domains/{domain}/move with destination projectId (also moves redirects pointing at that domain); this needs separate available authentication or the operator's dashboard action. No cross-project credentials reused.

After operator moves www plus the apex redirect, re-read both project domain lists, verify TLS and actual public Avtalslänk content, then set worker PUBLIC_APP_ORIGIN to the verified canonical hostname. Verify Supabase Auth site/redirect allowlist and CORS for both apex and www before completing domain cutover. The already-sent invitation deliberately uses the still-working Vercel hostname.

## Remaining blockers / cleanup
Recipient approval and real final artifact checks remain pending. Keep signing methods disabled until those results are verified. Revoke the temporary API key after preparing the test (recipient token remains independent). Preserve controlled audit records; no automatic deletion from production. No payment or BankID/Freja activation.

### Negative checks and credential cleanup
Live invalid-token view returned HTTP401/INVALID_SIGNING_LINK; unauthenticated sender GET returned HTTP401. LIVE-07 PASS. Temporary sender API key revoked through al_manage_keys/revoke_all after preparation; recipient interaction does not depend on that key. Secrets/link values were held only in restricted temporary files, never committed.

## Domain cutover and reported mailbox non-receipt — 2026-11-16
Operator moved apex/www. Vercel read-back confirms both on Avtalslänk and only app.gridex.se plus the OPS Vercel hostname remain on OPS. HTTPS apex redirects to www, returns200 and the Avtalslänk public title. Worker PUBLIC_APP_ORIGIN changed to https://www.avtalslank.se; deployment3734bf5c-cc5c-4a6c-8acb-761325c313a8 SUCCESS.

Live www preflight initially returned403 ORIGIN_DENIED. Fixed the default explicit origin allowlist to include www and deployed Edge APIv12 ACTIVE, bundle ea60d9207d764b4ea2d906832a47be07185991c140b6e427ed6289cf17dbad8e. Local npm run verify passed. Follow-up apex/www preflight204 with exact matching allow-origin; unrelated-origin rejection checked separately. No wildcard CORS introduced.

Recipient reports not seeing the original email. Provider still shows delivered; that proves transport acceptance, not inbox placement or human receipt. Original invitation was not blindly retried and no extra signing session created. Application reminders have a30-minute cooldown, preserved. One separate plain-text diagnostic message (no contract/link) sent through the authorized Resend connector under a stable idempotency key: provider01a1e656-c30d-70af-b06e-b4bb0f67342b, status delivered. Human inbox/antispam/quarantine remains unverified; user instructed to check those folders. No credentials or sender/domain from another product adopted. The existing Vercel-hostname invitation remains valid.
