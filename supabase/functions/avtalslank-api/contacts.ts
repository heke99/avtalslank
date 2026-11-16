import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7';
export async function contactsRoute(req: Request, path: string, db: SupabaseClient, identity: {
    actor: string | null;
    keyHash: string | null;
    organizationId: string | null;
}, body: Record<string, unknown>) {
    if (path !== '/v1/contacts/imports' || !['GET', 'POST'].includes(req.method))
        return null;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (!identity.keyHash && (!identity.actor || !uuid.test(identity.organizationId ?? '')))
        throw Error('AUTH_REQUIRED');
    if (req.method === 'POST' && (!uuid.test(String(body.requestId ?? '')) || !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 200))
        throw Error('CONTACT_IMPORT_LIMIT');
    const r = await db.rpc('al_contact_import', { p_actor: identity.actor, p_key_hash: identity.keyHash, p_org: identity.keyHash ? null : identity.organizationId, p_request: req.method === 'POST' ? body.requestId : null, p_rows: req.method === 'POST' ? body.rows : null });
    if (r.error)
        throw r.error;
    return { data: r.data };
}
