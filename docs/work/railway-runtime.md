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

## Verified release

Application code **a45151de9500b8d25902bcfd0ac8d7cd91242e44**, [CI43949709310](https://github.com/heke99/avtalslank/actions/runs/43949709310) **SUCCESS**:100 code/database tests,38 Chromium scenarios,18 provenance checks, web/worker/Edge type checks, production/prerender/OpenAPI build and packaged-container checks. Container evidence includes real qpdf11.3.0 inspection of a generated PDF, /live200 versus /ready and /health503 without credentials, POST405, and SIGTERM drain exiting0 with worker_stopped. Unit tests cover failed-poll timestamps, stale dependencies, overlap prevention, backoff reset and strict scanner/self-test outcomes. No separate live in-flight signing/drain journey is claimed.

Railway worker deployment **a2164589-8f97-408b-a61b-adc5e869ae2d SUCCESS**, pinned to that code. Actual build logs confirm DOCKERFILE and /live healthcheck succeeded. Worker runs privately in staging/Amsterdam with no public domain or TCP proxy. Actual worker logs show configured=false, missing=[SUPABASE_SERVICE_ROLE_KEY], dependencies={database:false,scanner:true,pdf:true}. scanner=true requires real private PING/VERSION, signature freshness and clean/EICAR positive tests; pdf=true requires real version/sample-PDF inspection. This confirms those actual Railway dependencies while the database remains intentionally unconnected from the worker.

Railway ClamAV deployment **15d2acb8-e289-4c28-9735-7ddf9103c28b SUCCESS**. Version1.5.4 image, private endpoint clamav.railway.internal:3310, no public domain/proxy. AlertExceedsMax=yes ensures scan-limit heuristic findings are not silently presented as clean. No document or user data was sent to it; only generated benign self-test bytes and the standard harmless EICAR pattern. Official image configuration reference: https://github.com/Cisco-Talos/clamav-docker/blob/main/clamav/README-debian.md. Region reference: https://docs.railway.com/deployments/regions#region-options.

Public worker-domain generation was rejected by automatic safety review because it would expose a service designed as private staging infrastructure. No domain was created; no indirect workaround was attempted after the explicit rejection was observed. Verification continued through Railway's own healthcheck and private runtime logs. Private deployment fulfills the worker task; public exposure is not required.

All ten runtime parts are implemented and verified at the levels above. Project existed already and was reused; its only environment is staging, avoiding duplicate projects/services. No schema, capability or billing changes were made. APIv10 and prior frontend remain compatible. The older signing-v1 report's statement that Railway had no source/deployment is historical and superseded here.

Remaining secure provisioning: the project's own SUPABASE_SERVICE_ROLE_KEY for the database connection; dedicated RESEND_API_KEY and verified SIGNING_EMAIL_FROM/domain; shared SIGNING_LINK_SECRET in worker and Edge. Supabase plugin exposes publishable keys only, and no credential from another product was used. Do not treat deployment SUCCESS or /live200 as business readiness. After provisioning, verify actual worker database access, scanning/upload lifecycle, Auth email/redirects and controlled signing before enabling capabilities. BankID/Freja provider activation and payment model remain separate unfinished work.
