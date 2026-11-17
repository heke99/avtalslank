import { ScannerProbe, PdfProbe } from "./probes.ts";
import { signingTick, signingConfigured } from "./signing.ts";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../packages/crypto/src/hash.ts";
import { ClamAvInstreamClient, QpdfInspector, } from "../../packages/document-processing/src/production.ts";
import { runtimeConfig, RuntimeState, checkDependencies, healthRoute, scannerHealthReady } from "./runtime.ts";
const config = runtimeConfig(process.env), state = new RuntimeState(config);
const safeFetch: typeof fetch = (input, init = {}) => fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
const db = config.url && config.key && config.invalid.length === 0 ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } }) : null;
const signingConfig = { secret: process.env.SIGNING_LINK_SECRET ?? "", publicOrigin: process.env.PUBLIC_APP_ORIGIN ?? "", resendKey: process.env.RESEND_API_KEY ?? "", from: process.env.SIGNING_EMAIL_FROM ?? "", domainVerified: process.env.SIGNING_EMAIL_DOMAIN_VERIFIED === "true" };
const scanner = config.scannerHost && !config.invalid.includes('CLAMAV_HOST') ? new ClamAvInstreamClient(config.scannerHost, config.scannerPort, config.probeMs, 10485760) : null;
const scannerProbe = scanner ? new ScannerProbe(scanner) : null, pdfProbe = new PdfProbe(new QpdfInspector('qpdf', config.probeMs));
const server = createServer((req, res) => { const r = healthRoute(req.method ?? 'GET', new URL(req.url ?? '/', 'http://worker.invalid').pathname, state, signingConfigured(signingConfig)); res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(r.status === 405 ? { Allow: 'GET, HEAD' } : {}) }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(r.body)); });
server.listen(config.port, '::');
console.log(JSON.stringify({ event: 'worker_started', configured: state.configured, missing: config.missing, invalid: config.invalid }));
let lastCleanup=0;
async function cleanStorage(client: NonNullable<typeof db>) {
    if(Date.now()-lastCleanup<60000)return;
    lastCleanup=Date.now();
    const work=await client.rpc("al_storage_cleanup_batch");
    if(work.error)throw work.error;
    for(const bucket of ["al-documents","al-final-documents"]){
        const paths=(work.data as {bucket:string;path:string}[]).filter(row=>row.bucket===bucket).map(row=>row.path);
        if(!paths.length)continue;
        const removal=await client.storage.from(bucket).remove(paths);
        if(removal.error)throw removal.error;
        const done=await client.rpc("al_storage_cleanup_done",{p_bucket:bucket,p_paths:paths});
        if(done.error)throw done.error;
    }
}
async function tick() {
    if (!state.begin())
        return;
    let success = false;
    let job: {
        id: string;
        leaseToken: string;
        document: {
            id: string;
            storage_path: string;
            sha256: string;
            byte_size: number;
        };
    } | null = null;
    try {
        state.dependencies = await checkDependencies({ database: async () => { if (!db)
                return false; const r = await db.rpc('al_capabilities', {}); return !r.error && Array.isArray(r.data); }, scanner: async () => scannerProbe ? scannerProbe.check() : false, pdf: async () => pdfProbe.check() });
        state.lastCheck = Date.now();
        if (!state.configured || !db || !Object.values(state.dependencies).every(Boolean)) {
            // Revoke the advertised heartbeat even when a local dependency fails.
            if (db && state.dependencies.database) {
                const r = await db.rpc('al_signing_worker', { p_action: 'heartbeat', p_payload: { ready: false, keyFingerprint: null } });
                if (r.error)
                    throw r.error;
            }
            throw Error('WORKER_DEPENDENCY_FAILED');
        }
        if (state.stopping)
            return;
        await signingTick(db, signingConfig, true);
        try { await cleanStorage(db); }
        catch { console.error(JSON.stringify({event:"storage_cleanup_failed"})); }
        if (state.stopping)
            return;
        const claimed = await db.rpc('al_claim_document_job');
        if (claimed.error)
            throw claimed.error;
        job = claimed.data;
        if (!job) {
            success = true;
            return;
        }
        const download = await db.storage
            .from("al-documents")
            .download(job.document.storage_path);
        if (download.error)
            throw download.error;
        const bytes = new Uint8Array(await download.data.arrayBuffer());
        if (bytes.length !== Number(job.document.byte_size) ||
            (await sha256Hex(bytes)) !== job.document.sha256)
            throw new Error("DOCUMENT_INTEGRITY_MISMATCH");
        const [malware, pdf] = await Promise.all([
            new ClamAvInstreamClient(config.scannerHost, config.scannerPort, 30000, 10485760).scan(bytes),
            new QpdfInspector("qpdf", 30000).inspect(bytes, {
                maximumBytes: 10485760,
                maximumPages: 100,
            }),
        ]);
        const report = {
            sha256: await sha256Hex(bytes),
            byteSize: bytes.length,
            malware: malware.result,
            pdf: pdf.passed && !pdf.encrypted ? "PASS" : "FAIL",
            scanner: malware.engine,
            scannerVersion: malware.engineVersion,
            pdfTool: pdf.engine,
            pageCount: pdf.pageCount,
            pdfVersion: pdf.engineVersion,
            checkedAt: new Date().toISOString(),
        };
        const completed = await db.rpc("al_finish_document_job", {
            p_id: job.id,
            p_lease: job.leaseToken,
            p_report: report,
        });
        if (completed.error)
            throw completed.error;
        state.completed++;
        success = true;
    }
    catch {
        state.failed++;
        // Do not log document bytes, tokens, provider payloads or raw errors.
        console.error(JSON.stringify({ event: "worker_cycle_failed", failures: state.failures + 1, dependencies: state.dependencies }));
        if (job && db)
            await db.rpc("al_finish_document_job", {
                p_id: job.id,
                p_lease: job.leaseToken,
                p_report: null,
                p_error: "DOCUMENT_PROCESSING_FAILED",
            });
    }
    finally {
        state.finish(success);
    }
}
let timer: ReturnType<typeof setTimeout> | null = null;
async function poll() { try {
    await tick();
}
catch {
    console.error(JSON.stringify({ event: 'worker_poll_failed' }));
}
finally {
    if (!state.stopping)
        timer = setTimeout(() => void poll(), state.delay());
} }
void poll();
async function stop() {
    if (state.stopping)
        return;
    state.stopping = true;
    if (timer)
        clearTimeout(timer);
    console.log(JSON.stringify({ event: 'worker_stopping', processing: state.processing }));
    const deadline = Date.now() + config.drainMs;
    while (state.processing && Date.now() < deadline)
        await new Promise(r => setTimeout(r, 100));
    if (state.processing) {
        console.error(JSON.stringify({ event: 'worker_drain_timeout' }));
        process.exit(1);
    }
    if (db && state.configured) {
        try {
            await db.rpc('al_signing_worker', { p_action: 'heartbeat', p_payload: { ready: false, keyFingerprint: null } }).abortSignal(AbortSignal.timeout(2000));
        }
        catch { }
    }
    server.close(() => { console.log(JSON.stringify({ event: 'worker_stopped' })); process.exit(0); });
    setTimeout(() => process.exit(1), 1000).unref();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
