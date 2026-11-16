# Production customer language and resilient API — 2026-11-16

User directs that customer UI should read like the finished service and omit internal "skarpa utskick"/launch-stage copy. This changes presentation, not capability verification, billing authorization or external provider readiness. Actual send/provider/payment gates remain unchanged. Existing Vercel hostname is the release surface; original avtalslank.se/OPS DNS is not changed.

| Part | Implementation | Evidence |
| --- | --- | --- |
| 1. Customer language and versioned policies | PublicSite/LegalContent/domain/client/settings | No current customer build-stage phrases; factual account-specific availability and support actions. Prior policy HTML is archived without scripts under /legal/2026-11-16; current informational/account policy version is 2026-11-16.2. No invented prices, SLA, provider readiness or legal annexes. |
| 2. API cursor pages | al_query_envelopes/queryRoute | Stable (updated_at,id) descending keyset; 1..100 rows; existing data array preserved with page.nextCursor. Not a snapshot export under concurrent updates. |
| 3. API filters | same bounded service RPC + parser | Literal case-insensitive title substring, status, inclusive UTC ISO date bounds; filters never supply authorization; user/key membership/scopes authoritative. |
| 4. HTTP diagnostics/timeouts | packages/http/requestJson + client/displayError | 15 second deadline, structured errors and request ID, cancellation/invalid-response handling; no raw server error text leaked. |
| 5. Safe read retries | same shared client | At most one GET retry for network failure or 502/503/504. Never auto-retry POST, auth denial or decision mutations. |
| 6. Account startup recovery | App session initialization | Rejected/hanging getSession produces recovery controls instead of an endless loading view. |
| 7. Unsaved draft protection | EnvelopeDetail + App | Dirty metadata protects sidebar, organization switch, back, logout and page unload. Copy disabled until saved. Field editor retains its separate explicit-save flow. |
| 8. Document upload feedback | EnvelopeDetail | Actual read/inspect/upload/register steps; exact invalid-PDF/size messages; finally resets input state. No fake progress percentage or scanner completion. |
| 9. Activity search | WorkspaceOperations | Localized/technical event names filter the loaded history only; filtered export matches visible subset; older-page loading remains explicit. |
| 10. Keyboard draft save | EnvelopeDetail | Ctrl/Cmd+S submits the existing validated save form while mounted; busy state blocks duplicate keyboard submissions; DB generation remains authoritative. |

New code extends existing Avtalslänk actor, tenant, draft and request primitives. No new donor code or credentials; original 18 ports remain pinned. New migration created with pinned Supabase CLI. CLI created the file but then reported a telemetry shutdown timeout; no schema operation was executed by that CLI call.

Readiness remains an internal release concern: dedicated Railway worker/scanner/sender, actual provider/evidence, real Auth email/redirect behavior and processor/retention annexes remain required. Public pages avoid advertising inactive methods as available. The workspace and API continue to deny unavailable operations. Price/plan selection remains declared interest until separately approved ordering and server-owned entitlements are implemented. Updated customer wording must never be used as proof of production readiness.

Policy archive preserves the prior public text. New copy does not promise automated retention/deletion or an executed DPA. Account terms/privacy are distinct from marketing consent; signup metadata is user-editable and is not immutable acceptance evidence or entitlement. Existing account obligations are not silently converted into a paid contract.

Verification in progress: 74 code/database tests including role/tenant/scope/key/cursor/filter cases, HTTP retry boundaries and timeouts; browser scenarios for dirty-navigation/keyboard save, invalid upload reset, activity search, startup recovery and customer language; hosted transactional smoke and advisors after applying migration. No real customer email, payment or signature is executed by these checks.

Hosted evidence: production_api_queries applied; API v8 ACTIVE. Expanded hosted two-tenant transaction passed and rolled back. Post-check: zero synthetic users remain; ordinary authenticated clients cannot execute the service-only query RPC. Security advisor returned zero findings. Live health 200; new list without auth and with invalid key both 401; public home/security HTML omit old build-stage phrases; archived terms return 200 without scripts. Vercel dpl_6c6cim2NjFQTL4Xyk8fGvYEPy5Wn READY at 86b81ea62b965d97649cd3d2c8b1e09fb795b44c.

CI 43914649169: 74 code/database tests and container/build passed; 25/28 browser scenarios passed. Two selectors matched repeated wording after the copy revision, and the new dirty-draft scenario expected the sidebar label without its count badge. Narrowed the text assertions and gave sidebar buttons a stable explicit accessible name; no assertions removed or skipped. Final rerun pending.

Draft save normalization: after the validated save response, metadata inputs adopt the server-returned title/message/order and clear the dirty flag in the same successful action. This avoids a false unsaved warning when the server trims a title. The browser fixture now mirrors the existing SQL title trim and the shortcut scenario saves a padded title. No flag is cleared on failure or for unrelated field saves.

## Final verification and release

Verified code commit: 664f2f1fd39d39c01dc05dec1963733f0f364a0c.
[CI 43916171314](https://github.com/heke99/avtalslank/actions/runs/43916171314): SUCCESS — 74 code/database tests, 28 Chromium scenarios, 18 pinned provenance checks, web/worker/Edge TypeScript checks, production Vite build and public prerender/OpenAPI/sitemap verification, and packaged worker-container checks. Browser scenarios prove startup timeout recovery, normalized shortcut save, decline-to-leave dirty navigation, PDF error/reset and filtered activity lookup. No test was skipped or weakened.

Vercel dpl_9voqYJMtfNBWbwAPWMNqA4cz1rz8 READY at that code commit. Stable URL https://avtalslank.vercel.app/. API v8 ACTIVE. production_api_queries applied. Hosted role/tenant transaction passed and rolled back; synthetic-user count afterwards is zero, direct authenticated execution of the query RPC is denied, and security advisor returned zero findings. HTTP tests confirmed health 200, list auth/key rejection 401, current public HTML free of the targeted build phrases, and archived terms 200 without scripts.

Release scope: all ten parts implemented and verified at the levels above. Customer copy now reads as the ordinary service; this is not evidence that external infrastructure/providers are connected. Dedicated Railway worker/scanner/sender, real Auth email/redirect/secure-password verification, provider identity/evidence verification and completed processor/retention annexes remain before live signing service release. Billing remains disabled, with no fabricated price, checkout or entitlement. No real account MFA, recipient email, signature or charge was exercised. Mocked browser responses and direct hosted RPC tests are identified separately from end-to-end provider proof.

Next exact work: finish dedicated runtime/Auth/email configuration and controlled real signing/registration flows; complete the processor/retention annexes; implement server-owned paid-order acceptance and entitlements only after commercial terms are decided. Keep internal release blockers in this document rather than customer marketing copy, while preserving truthful account availability and fail-closed authorization.
