import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7';
import { randomToken } from '../../../packages/crypto/src/tokens.ts';
import { sha256Hex } from '../../../packages/crypto/src/hash.ts';
type Identity = {
    actor: string | null;
    keyHash: string | null;
    organizationId: string | null;
};
const uuid = (v: unknown) => { if (typeof v !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))
    throw Error('INVALID_ID'); return v; };
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>) { const r = await db.rpc(name, args); if (r.error)
    throw r.error; return r.data; }
export async function securityRoute(req: Request, path: string, db: SupabaseClient, identity: Identity, body: Record<string, unknown>) {
    if (!['/v1/account/legal', '/v1/plan-preference', '/v1/security/keys', '/v1/security/webhook-rotate'].includes(path))
        return null;
    if (!identity.actor || identity.keyHash)
        throw Error('AUTH_REQUIRED');
    if (path === '/v1/account/legal') {
        if (!['GET', 'POST'].includes(req.method))
            return null;
        return { data: await rpc(db, 'al_legal_account', { p_actor: identity.actor, p_action: req.method === 'GET' ? 'read' : 'accept', p_payload: req.method === 'GET' ? {} : body }) };
    }
    const org = uuid(identity.organizationId);
    if (path === '/v1/plan-preference') {
        if (!['GET', 'POST'].includes(req.method))
            return null;
        if (req.method === 'POST' && (!Number.isInteger(body.revision) || typeof body.revision !== 'number' || body.revision < 0 || body.revision > 2147483646 || (body.plan !== null && !['start', 'team', 'api'].includes(String(body.plan)))))
            throw Error('INVALID_PLAN');
        return { data: await rpc(db, 'al_plan_preference', { p_actor: identity.actor, p_org: org, p_save: req.method === 'POST', p_plan: req.method === 'POST' ? body.plan : null, p_revision: req.method === 'POST' ? body.revision : null }) };
    }
    if (path === '/v1/security/webhook-rotate' && req.method === 'POST') {
        const secret = randomToken();
        const data = await rpc(db, 'al_rotate_webhook', { p_actor: identity.actor, p_org: org, p_id: uuid(body.id), p_secret: secret });
        return { data: { ...data, secret } };
    }
    if (path === '/v1/security/keys') {
        if (req.method === 'GET')
            return { data: await rpc(db, 'al_manage_keys', { p_actor: identity.actor, p_org: org, p_action: 'list' }) };
        if (req.method !== 'POST' || !['create', 'rotate', 'revoke_all'].includes(String(body.action)))
            throw Error('INVALID_BODY');
        if (body.action === 'revoke_all')
            return { data: await rpc(db, 'al_manage_keys', { p_actor: identity.actor, p_org: org, p_action: 'revoke_all' }) };
        const raw = 'al_live_' + randomToken();
        let payload: Record<string, unknown> = { prefix: raw.slice(0, 16), tokenHash: await sha256Hex(raw) };
        if (body.action === 'rotate')
            payload.id = uuid(body.id);
        else {
            if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.length > 80 || !Array.isArray(body.scopes) || body.scopes.length < 1 || body.scopes.length > 5 || body.scopes.some(s => !['envelopes:read', 'envelopes:write', 'templates:read', 'templates:write', 'billing:read'].includes(String(s))))
                throw Error('INVALID_KEY');
            const days = body.expiryDays ?? 0;
            if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365)
                throw Error('INVALID_KEY_EXPIRY');
            payload = { ...payload, name: body.name, scopes: body.scopes, expiresAt: days ? new Date(Date.now() + days * 86400000).toISOString() : null };
        }
        const data = await rpc(db, 'al_manage_keys', { p_actor: identity.actor, p_org: org, p_action: String(body.action), p_payload: payload });
        return { data: { ...data, key: raw } };
    }
    return null;
}
