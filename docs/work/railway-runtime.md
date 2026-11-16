# Worker runtime and Railway — 2026-11-16

Ten-part runtime iteration; Engineering_Startkit_v3.0.0 remains unchanged. Existing worker, signing outbox/fencing, malware and PDF adapters are reused locally. No donor credentials or external project dependency.

| Part | Implementation |
| --- | --- |
| 1. Validated configuration | bounded ports/poll/probe/drain settings, HTTPS database URL; values never returned/logged |
| 2. Liveness and readiness | /live process status; /ready and legacy /health require actual dependencies and fresh successful cycle; GET/HEAD only |
| 3. Database probe | service client's al_capabilities RPC, bounded HTTP fetch; claim/heartbeat retain server-role guards |
| 4. Malware probe | private ClamAV PING/VERSION, signature age <=72h, clean/EICAR self-tests once/hour or version change |
| 5. PDF probe | actual qpdf version and generated one-page PDF inspection, cached per binary version |
| 6. Truthful health | failed polls never refresh last success; any dependency failure suppresses readiness and withdraws advertised signing heartbeat when DB reachable |
| 7. Retry scheduling | one in-flight cycle, bounded jittered backoff up to60s, resets on successful poll; no new email/webhook retry policy |
| 8. Graceful shutdown | stop claims, drain<=60s, heartbeat withdrawal bounded2s; nonzero exit on drain timeout |
| 9. Safe telemetry and tests | boolean dependencies/counters and fixed event names; no raw errors, customer payloads, secret values or provider data |
| 10. Railway deployment | existing project avtalslank, staging worker and private ClamAV in Amsterdam, pinned worker source, bounded resources and restart policy |

/live=200 is not signing/document readiness. Unconfigured workers remain /ready=503 and make no business claims. Independently available local dependencies can be checked while the server credential is missing. Server credentials remain necessary for database verification from Railway. Signing capabilities/payment stay unchanged.

Private ClamAV uses clamav/clamav:1.5.4-debian13-slim, TCP3310 on private IPv6 endpoint clamav.railway.internal, max stream10M, two scan threads, hourly FreshClam configuration and no public domain/TCP proxy. Worker budget0.5GB/0.5vCPU; scanner2GB/0.5vCPU. Container restarts may reload bundled definitions; no persistent signature volume is claimed. Runtime refuses a stale/unknown/future signature timestamp. EICAR is a harmless standard AV test generated in memory, never stored or treated as a customer document.

Railway direct service settings are authoritative. The plugin rejected the old railwayConfigFile option as deprecated; legacy railway.worker.json is not applied by this deployment. Dockerfile path, /live healthcheck, European region, single replica, no sleeping, five failure restarts and65s draining are set through supported service operations. Inspect actual build/deployment before claiming success.

Project d6d18789-7d93-4c36-ab98-6bdff50109fe; staging30204f54-6210-480f-9f3d-e1047e15fccb; document-worker e73cd74a-3a1d-437e-86e4-ed1709a59ded; clamav d311c5a9-992b-4511-bf30-51a50eff984f.

Local100 code/database tests and build/type gates passed; CI/container/Railway results pending. The connector cannot retrieve the project's server key. Do not substitute a publishable key or another product's key. Dedicated SUPABASE_SERVICE_ROLE_KEY, Resend key/verified sender and shared SIGNING_LINK_SECRET remain required before a live signing journey. No actual customer email/signature/charge is part of runtime verification.
