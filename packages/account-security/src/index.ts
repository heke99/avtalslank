export type KeyRecord = {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    expires_at: string | null;
    last_used_at: string | null;
    revoked_at: string | null;
    created_at: string;
};
export function keyStatus(key: Pick<KeyRecord, 'expires_at' | 'revoked_at'>, now = Date.now()) { return key.revoked_at ? 'revoked' : key.expires_at && Date.parse(key.expires_at) <= now ? 'expired' : 'active'; }
export function filterKeys(keys: KeyRecord[], query: string, status: string, now = Date.now()) { const q = query.trim().toLocaleLowerCase('sv'); return keys.filter(k => (!status || keyStatus(k, now) === status) && (k.name + ' ' + k.prefix).toLocaleLowerCase('sv').includes(q)); }
