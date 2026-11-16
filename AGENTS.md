# Avtalslänk

Standalone product operated by Trafexa Nordic AB. Never connect donor projects at runtime.
Resolve organization from verified membership or an authenticated scoped API client. Never trust caller-supplied organization IDs alone.
Clients must not set signed/completed/validated status, evidence, usage or provider readiness.
Keep document versions immutable after sending. Persist jobs and audit in the business transaction.
BankID/Freja remain unavailable until real configuration and independent evidence verification exist.
Billing is undecided: support subscription, per-document and hybrid structures without a chosen price or payment provider. Never charge from retries.
Record donor path, pinned commit, digest and adaptations in docs/reuse-manifest.json. No credentials or user data from donors.
Run npm run verify; run real two-tenant SQL/RLS and browser tests for changed surfaces. Report unexecuted provider/container checks honestly.

## Required engineering baseline
Use docs/engineering/AGENTS.md and docs/engineering/docs/ENGINEERING_STANDARD.md for all future work. Preserve the Avtalslänk-specific rules above. Current implementation and evidence live in docs/IMPLEMENTATION.md; active signing work is tracked in docs/work/signing-v1.md. Never describe a pure module test as a verified production signing flow.
