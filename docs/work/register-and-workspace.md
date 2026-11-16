# Register design and workspace usability — 2026-11-16

Engineering Startkit v3 applies. This iteration extends Avtalslänk's own components and authenticated data access. No donor import, database/Edge migration, provider activation, pricing or billing change.

| Part | Implementation | Verification |
| --- | --- | --- |
| 1. New public hero | PublicSite/public.css | Replaces slogan/italic heading/mock document with a factual register, direct account entry and operator/status facts; desktop/mobile screenshots and live visual review |
| 2. Subscription rows | PlanSection | Ruled Start/Team/API records replace three card layout; unchanged planned-only/non-binding price status |
| 3. Interactive product walkthrough | ProductGuide | Keyboard tabs, next/previous, start/end states; explicitly sends/saves nothing |
| 4. Method overview | MethodOverview | Four method choices with honest disabled live status; no evidence or availability fabricated |
| 5. Server API examples | ApiExamples | cURL, JavaScript, Python selection; copy success/error; no request is executed from examples |
| 6. Workspace onboarding | GettingStarted | Checklist derives draft/template/active membership counts, routes to existing features; never activates signing/payment |
| 7. Agreement sorting | workspace/filterAgreements | Latest, oldest and Swedish name ordering; stable tie-break and no input mutation |
| 8. Date filtering | workspace/filterAgreements | Inclusive Swedish calendar dates intersect search/status; invalid interval returns no results; clear controls |
| 9. CSV export | workspace/agreementCsv | Only displayed records (maximum 100) of the current organization; UTF-8 BOM, escaped cells and formula neutralization; actual download test |
| 10. Restart unfinished MFA setup | AccountSecurity/restartableFactors | Re-fetch current factors, target only unverified TOTP named Avtalslänk; confirmation required; never intentionally selects verified/other factors |

Tenant context is checked again in list filtering and CSV generation even though rows originate from authenticated RLS. Organization switches clear old loaded envelope/template arrays; no old-organization rows are displayed/exported during a pending reload. Date bounds refer to Europe/Stockholm, not UTC dates. Export contains metadata visible in the list, no document bytes, recipient identities, keys or evidence. CSV is not a signing proof or full archive export.

MFA API behavior verified against current Supabase JavaScript unenroll reference and installed SDK 2.110.7; verified factors require AAL2 for unenrollment. Current-factor recheck narrows the UI action; Supabase remains the security authority. No real user factor is removed in verification. Browser Auth responses are network doubles; controlled real Auth/provider verification remains a separate release prerequisite.

References checked: https://supabase.com/changelog.md and https://supabase.com/docs/reference/javascript/auth-mfa-unenroll. CLI stays pinned v2; no schema CLI operation is involved.

Verification in progress. Local suite expanded from 65 to 70 code/database tests. CI will exercise existing account/signing flows plus tour, API copy, onboarding/filter/export and unfinished-MFA recovery. Public page prerendering, static API/sitemap, existing provider gates and necessary-only storage remain unchanged. Do not describe local or mocked tests as live signing/email/identity-provider proof.

First CI 43908072595: 70 code/database tests, build and worker-container passed. 22/23 browser scenarios passed, including all new functional scenarios. The remaining existing plan-to-signup scenario expected the visible link name without its decorative arrow. Added an explicit accessible plan-link name and hidden decorative arrow. Responsive agreement controls now wrap independently of desktop panel layout; the export scenario also verifies the mobile page width and captures a screenshot. Removed the unused old three-column workflow function. Final rerun pending.

Live visual inspection: the published home now uses a full-width register heading, service facts and ruled sections; no mock document, italic slogan or three-card subscription block. The live tour correctly switches to recipient preparation without sending/saving. Public page was left available for review.

## Final verification and release

Verified code commit 36bcbee3ec6605c14da7c258ee64c4cdd6f22bc4.
[CI run 43908629372](https://github.com/heke99/avtalslank/actions/runs/43908629372): SUCCESS. 70 code/database tests, 23 Chromium scenarios, web/worker/Edge TypeScript checks, production build, ten public prerendered pages/OpenAPI/sitemap verification, 18 pinned donor provenance checks, and worker-container job all passed. The new export test downloads and inspects CSV, excludes other organizations and filtered-out rows, and checks mobile layout. MFA restart tests confirm only the unfinished app factor is removed. All previous signing/account/public tests remain active.

Vercel dpl_3fjoe2Xrz59iBFiQAPj6NY2rAyaC READY at that code commit. Stable address https://avtalslank.vercel.app/. Public hero and walkthrough visually inspected in the live browser; screenshots of public desktop/mobile and workspace mobile controls are in the CI browser-verification artifact. Existing avtalslank.se/OPS DNS unchanged. Working tree synchronized with published main.

Release verdict: ten parts implemented and verified at these levels. No new DB/Edge schema or permission surface; actual PostgreSQL role/RLS regression tests still pass. Real external Auth/provider flows were not exercised by mocked browser tests. No actual user MFA factor, recipient email or payment was changed/sent. Dedicated Railway worker/scanner/sender, live email/Auth checks, provider configuration/evidence and processor/retention annexes remain before live signing. Signing and billing remain disabled. No new price or payment model was decided.
