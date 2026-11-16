# Public website and account entry — 2026-11-16

Engineering Startkit v3 applies. Avtalslänk remains a standalone Trafexa Nordic AB product. Existing provider and payment gates remain unchanged. This iteration extends Avtalslänk code; no donor import, customer data or credentials were copied. All 18 pinned donor ports remain unchanged.

| Part | Implementation | Verification |
| --- | --- | --- |
| 1. Hero and public navigation | PublicSite, public.css | Desktop/mobile hero, working CTAs and menu |
| 2. Product journey | /produkt, Workflow | Public product page and truthful method readiness |
| 3. Plan overview and comparison | /abonnemang, central bounded plans | Start/Team/API are planned alternatives, no invented prices, quotas, binding periods or billing activation |
| 4. Plan-aware signup | Auth + signupMetadata | Required account-terms checkbox; privacy is information, not blanket consent; bounded plan selection |
| 5. Developer entry | /api and generated /openapi.json | Actual API base, downloadable specification, no live example request or leaked key |
| 6. Privacy information | /integritet | Actual operator, controller/processor distinction, data, purposes/bases, providers, retention criteria, rights and contact |
| 7. Cookies and storage | /cookies + native settings dialog | Necessary-only inventory; no optional analytics/ads, no artificial consent banner; dialog focus/Escape; clean-browser network/storage audit |
| 8. Account terms | /villkor version 2026-11-16 | B2B account/draft scope; no payment conversion; contact termination; wrong version never silently substitutes current content; print stylesheet |
| 9. Security and business data protection | /sakerhet, /dataskydd | Honest launch status, incident contact and prerequisites; informational processor page is NOT a concluded DPA |
| 10. Support, FAQ and legal access | /hjalp, FAQ, footer, auth legal links | Public access, correct operator/contact, no unconnected contact form claiming submission |

Additional: ten public HTML routes prerender at build, route titles/descriptions/canonical/OG, sitemap, robots, favicon and static OpenAPI asset. Vercel rewrites now cover only application/auth/signing routes, preserving public static files. Existing signed-in root still opens the workspace. Signed-out root becomes the landing page; /login and /signup are explicit entry points. Invitation/recovery/signing routes remain functional.

## Truth and legal boundaries

Prices, document volumes, renewal/cancellation periods and payment provider are undecided. Plan interest is declared user metadata, NOT trusted subscription state, entitlement, proof of a paid order or immutable legal evidence. Account-terms acknowledgement/version is also client-declared signup metadata; authenticated server-enforced, immutable commercial acceptance must be implemented before paid checkout. Privacy information is presented separately and is not an extra required consent.

Account terms cover company accounts and preparation with test material only. Live signing stays disabled. No commercial signing SLA, certificate, qualified signature or GDPR-compliance badge is claimed. The public data-protection page describes needed DPA annexes; it does not publish an incomplete DPA as a concluded agreement. Exact processor/transfer annexes, deletion and backup deadlines remain launch prerequisites for live customer documents. Account closure/privacy requests are manual via the actual operator contact. No arbitrary retention deadline is claimed to be implemented.

Cookies: app currently includes no optional trackers, no analytics provider and no ad scripts. Therefore no opt-in/accept-all/reject-all banner is appropriate. Settings explain necessary-only use, without introducing a needless persistent preference. SDK session storage is functional; invitation local storage has seven-day validity and is removed on acceptance or a subsequent expired-token check. Hosting-level security behavior needs separate review at custom-domain/runtime changes. Nothing in this iteration changes server-side data retention or signing permissions.

Official references consulted 2026-11-16:
- PTS: https://pts.se/internet-och-telefoni/kakor-cookies — necessary exception, purpose/name/duration inventory and active consent for optional use.
- IMY: https://www.imy.se/vanliga-fragor-och-svar/vad-ska-en-integritetspolicy-innehalla/ — transparent information tied to actual processing.
- IMY controller/processor roles: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/

## Verification status

In progress. No database or Edge API change in this iteration, so no new hosted migration is required. Existing actual PostgreSQL/two-tenant suite is rerun with web/Edge/worker typechecks, provenance and build. New browser scenarios cover public pages, plan registration, no purchase, legal version handling, cookies, responsive navigation and public network/storage. Auth requests are mocked in browser verification; real signup email and provider signing are not proven by those checks. Capture public-page screenshots in CI and inspect the deployed public UI separately.

Local: npm run verify passes 65 code/database tests, web/Edge/worker typechecks, 18 pinned provenance checks, production build and 10-page prerender/OpenAPI/sitemap verification. Public styles are scoped against workspace sidebar and table defaults. Live browser inspection confirmed the hero, planned Start/Team/API overview, cookie settings and /cookies navigation. No real account, terms acceptance, payment or email was submitted.

CI run 43900677474: code/database/build checks passed, then browser installation failed because ubuntu-latest resolved to Ubuntu 26.04, unsupported by locked Playwright 1.58.2. Both jobs are now pinned to ubuntu-24.04. Cookie dialog explicitly focuses its close button after showModal, then restores the opener on closure. Rerun pending.
