import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7';
import { randomToken } from '../../../packages/crypto/src/tokens.ts';
import { sha256Hex } from '../../../packages/crypto/src/hash.ts';
type Identity = {
    actor: string | null;
    keyHash: string | null;
    organizationId: string | null;
};
const id = (v: unknown) => { if (typeof v !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))
    throw Error('INVALID_ID'); return v; };
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>) { const { data, error } = await db.rpc(name, args); if (error)
    throw error; return data; }
export async function operationsRoute(req: Request, path: string, db: SupabaseClient, identity: Identity, body: Record<string, unknown>) {
    const action = path.match(/^\/v1\/team\/(invitations|revoke|accept|leave)$/)?.[1];
    if (action) {
        if (!identity.actor || identity.keyHash)
            throw Error('AUTH_REQUIRED');
        const context = { p_actor: identity.actor, p_org: action === 'accept' ? null : id(identity.organizationId) };
        if (action === 'invitations' && req.method === 'GET')
            return { data: await rpc(db, 'al_team_command', { ...context, p_action: 'list' }) };
        if (req.method !== 'POST')
            return null;
        if (action === 'invitations') {
            if (typeof body.email !== 'string' || body.email.length > 254 || !['admin', 'sender', 'reader'].includes(String(body.role)))
                throw Error('INVALID_INVITATION');
            const token = randomToken();
            const data = await rpc(db, 'al_team_command', { ...context, p_action: 'create', p_payload: { email: body.email, role: body.role, tokenHash: await sha256Hex(token) } });
            return { data: { ...data, token } };
        }
        if (action === 'accept') {
            if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token))
                throw Error('INVALID_INVITATION');
            return { data: await rpc(db, 'al_team_command', { ...context, p_action: 'accept', p_payload: { tokenHash: await sha256Hex(body.token) } }) };
        }
        return { data: await rpc(db, 'al_team_command', { ...context, p_action: action, p_payload: action === 'revoke' ? { id: id(body.id) } : {} }) };
    }
    if (path === '/v1/status' && req.method === 'GET') {
        const data = await rpc(db, 'al_operational_status', { p_actor: identity.actor, p_key_hash: identity.keyHash, p_org: identity.keyHash ? null : id(identity.organizationId) });
        return { data: { ...data, signingConfigured: Boolean(Deno.env.get('SIGNING_LINK_SECRET')) } };
    }
    const reminder = path.match(/^\/v1\/envelopes\/([a-f0-9-]+)\/remind$/i);
    if (reminder && req.method === 'POST')
        return { data: await rpc(db, 'al_remind_signer', { p_actor: identity.actor, p_key_hash: identity.keyHash, p_org: identity.keyHash ? null : id(identity.organizationId), p_envelope: id(reminder[1]), p_recipient: id(body.recipientId) }) };
    return null;
}
