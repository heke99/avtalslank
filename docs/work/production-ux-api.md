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
