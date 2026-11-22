export type RuntimeConfig = {
    port: number;
    pollMs: number;
    probeMs: number;
    staleMs: number;
    drainMs: number;
    url: string;
    key: string;
    scannerHost: string;
    scannerPort: number;
    missing: string[];
    invalid: string[];
};
export function runtimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
    const invalid: string[] = [];
    const number = (name: string, fallback: number, min: number, max: number) => { const value = env[name] === undefined ? fallback : Number(env[name]); if (!Number.isInteger(value) || value < min || value > max) {
        invalid.push(name);
        return fallback;
    } return value; };
    const url = env.SUPABASE_URL ?? '', key = env.SUPABASE_SERVICE_ROLE_KEY ?? '', scannerHost = env.CLAMAV_HOST ?? '';
    if (url) {
        try {
            if (new URL(url).protocol !== 'https:')
                invalid.push('SUPABASE_URL');
        }
        catch {
            invalid.push('SUPABASE_URL');
        }
    }
    if (scannerHost && (!/^[a-zA-Z0-9_.:-]+$/.test(scannerHost) || scannerHost.length > 253))
        invalid.push('CLAMAV_HOST');
    const missing = [...(!url ? ['SUPABASE_URL'] : []), ...(!key ? ['SUPABASE_SERVICE_ROLE_KEY'] : []), ...(!scannerHost ? ['CLAMAV_HOST'] : [])];
    return { port: number('PORT', 8080, 1, 65535), pollMs: number('WORKER_POLL_MS', 2500, 1000, 60000), probeMs: number('WORKER_PROBE_TIMEOUT_MS', 5000, 500, 30000), staleMs: 120000, drainMs: number('WORKER_DRAIN_MS', 60000, 1000, 60000), url, key, scannerHost, scannerPort: number('CLAMAV_PORT', 3310, 1, 65535), missing, invalid };
}
export type Dependencies = {
    database: boolean;
    scanner: boolean;
    pdf: boolean;
};
export class RuntimeState {
    stopping = false;
    processing = false;
    lastSuccess: number | null = null;
    lastCheck: number | null = null;
    failures = 0;
    cycles = 0;
    completed = 0;
    failed = 0;
    dependencies: Dependencies = { database: false, scanner: false, pdf: false };
    constructor(readonly config: RuntimeConfig, readonly startedAt = Date.now()) { }
    get configured() { return this.config.missing.length === 0 && this.config.invalid.length === 0; }
    begin() { if (this.stopping || this.processing)
        return false; this.processing = true; this.cycles++; return true; }
    finish(ok: boolean, now = Date.now()) { this.processing = false; if (ok) {
        this.lastSuccess = now;
        this.failures = 0;
    }
    else {
        this.failures++;
    } }
    ready(now = Date.now()) { return this.configured && !this.stopping && Object.values(this.dependencies).every(Boolean) && this.lastCheck !== null && now - this.lastCheck < this.config.staleMs && this.lastSuccess !== null && now - this.lastSuccess < this.config.staleMs && this.failures === 0; }
    delay(random = Math.random()) { return this.failures ? Math.floor(Math.min(60000, this.config.pollMs * 2 ** Math.min(this.failures, 6)) * (0.8 + Math.min(1, Math.max(0, random)) * 0.2)) : this.config.pollMs; }
    summary(signingConfigured: boolean, now = Date.now()) { return { service: 'avtalslank-document-worker', configured: this.configured, healthy: this.ready(now), processing: this.processing, stopping: this.stopping, signingConfigured: signingConfigured && this.ready(now), missing: this.config.missing, invalid: this.config.invalid, dependencies: this.dependencies, lastSuccessfulCycleAt: this.lastSuccess === null ? null : new Date(this.lastSuccess).toISOString(), uptimeSeconds: Math.max(0, Math.floor((now - this.startedAt) / 1000)), failures: this.failures, cycles: this.cycles, completed: this.completed, failed: this.failed }; }
}
export async function checkDependencies(probes: {
    database: () => Promise<boolean>;
    scanner: () => Promise<boolean>;
    pdf: () => Promise<boolean>;
}): Promise<Dependencies> { const results = await Promise.allSettled([probes.database(), probes.scanner(), probes.pdf()]); return { database: results[0].status === 'fulfilled' && results[0].value === true, scanner: results[1].status === 'fulfilled' && results[1].value === true, pdf: results[2].status === 'fulfilled' && results[2].value === true }; }
export function healthRoute(method: string, path: string, state: RuntimeState, signing: boolean, now = Date.now()) {
    if (!['GET', 'HEAD'].includes(method))
        return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } };
    if (!['/health', '/ready', '/live'].includes(path))
        return { status: 404, body: { error: 'NOT_FOUND' } };
    if (path === '/live')
        return { status: state.stopping ? 503 : 200, body: { service: 'avtalslank-document-worker', live: !state.stopping } };
    return { status: state.ready(now) ? 200 : 503, body: state.summary(signing, now) };
}
export function scannerHealthReady(health: {
    healthy: boolean;
    version: string;
}, now = Date.now()) {
    const match = /^ClamAV\s+[^/\s]+\/\d+\/(.+)$/.exec(health.version);
    if (!health.healthy || !match)
        return false;
    const updated = Date.parse(match[1]);
    return Number.isFinite(updated) && updated <= now + 300000 && now - updated <= 72 * 3600000;
}
