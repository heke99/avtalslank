import React, { useEffect, useState, useRef } from 'react';
import { accountApi } from './AccountOperations';
import { supabase, displayError } from './client';
import { filterKeys, keyStatus, type KeyRecord } from '../../packages/account-security/src/index';
function useTask() { const [busy, setBusy] = useState(false), [error, setError] = useState(''); const running = useRef(false); return { busy, error, run: async (fn: () => Promise<void>) => { if (running.current)
        return; running.current = true; setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(displayError(e));
    }
    finally {
        running.current = false;
        setBusy(false);
    } } }; }
const date = (value: string | null) => value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }) : 'Ej registrerad';
export function SecurityKeys({ orgId }: {
    orgId: string;
}) {
    const [keys, setKeys] = useState<KeyRecord[]>([]), [secret, setSecret] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('');
    const op = useTask();
    async function load() { setKeys(await accountApi('/v1/security/keys', orgId)); }
    useEffect(() => { op.run(load); }, [orgId]);
    async function change(body: Record<string, unknown>) { setSecret(''); const v = await accountApi('/v1/security/keys', orgId, body); if (v.key)
        setSecret(v.key); await load(); }
    return <section className="panel detail-panel account-controls"><h1>API-nycklar</h1><p>Ge varje integration en egen nyckel med de behörigheter den behöver. Endast ägare och administratörer kan hantera nycklar.</p>{op.error && <p role="alert">{op.error}</p>}
 <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); op.run(() => change({ action: 'create', name: f.get('name'), scopes: f.getAll('scope'), expiryDays: Number(f.get('expiryDays')) })); }}>
 <label>Nyckelnamn<input name="name" required minLength={2} maxLength={80}/></label>
 <label>Giltighetstid<select name="expiryDays" defaultValue="90"><option value="30">30 dagar</option><option value="90">90 dagar</option><option value="365">365 dagar</option><option value="0">Utan slutdatum</option></select></label>
 <fieldset><legend>Behörigheter</legend>{[['envelopes:read', 'Läsa avtal'], ['envelopes:write', 'Hantera avtal'], ['templates:read', 'Läsa mallar'], ['templates:write', 'Hantera mallar'], ['billing:read', 'Läsa förbrukning']].map(([value, label]) => <label key={value}><input type="checkbox" name="scope" value={value} defaultChecked={value === 'envelopes:read'}/>{label}</label>)}</fieldset><button className="primary" disabled={op.busy}>Skapa API-nyckel</button></form>
 {secret && <div role="status"><strong>Spara API-nyckeln. Den visas bara nu.</strong><code style={{ display: 'block', overflowWrap: 'anywhere', margin: '12px 0' }}>{secret}</code><button className="secondary" onClick={() => setSecret('')}>Jag har sparat nyckeln</button></div>}
 <div className="list-row"><label>Sök nyckel<input value={query} onChange={e => setQuery(e.target.value)}/></label><label>Nyckelstatus<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Alla</option><option value="active">Aktiva</option><option value="expired">Utgångna</option><option value="revoked">Återkallade</option></select></label></div>
 <p className="muted">Visar högst 200 senast skapade nycklar. Senast använd uppdateras högst en gång per minut.</p>
 {filterKeys(keys, query, status).map(k => <div className="list-row" key={k.id}><span className="grow"><strong>{k.name}</strong><small>{k.prefix}… · {{ active: 'Aktiv', expired: 'Utgången', revoked: 'Återkallad' }[keyStatus(k)]}</small><small>{k.scopes.join(', ')}</small><small>Giltig till: {k.expires_at ? date(k.expires_at) : 'Utan slutdatum'} · Senast använd: {date(k.last_used_at)}</small></span>{keyStatus(k) === 'active' && <button className="secondary" disabled={op.busy} onClick={() => { if (confirm('Byta nyckeln? Den nuvarande slutar fungera direkt. Behörigheter och slutdatum behålls.'))
        op.run(() => change({ action: 'rotate', id: k.id })); }}>Byt nyckel</button>}{!k.revoked_at && <button className="secondary" disabled={op.busy} onClick={() => { if (confirm('Återkalla denna nyckel?'))
        op.run(async () => { const r = await supabase.rpc('al_revoke_api_key', { p_org: orgId, p_id: k.id }); if (r.error)
            throw r.error; await load(); }); }}>Återkalla</button>}</div>)}
 <button className="secondary" disabled={op.busy || !keys.some(k => !k.revoked_at)} onClick={() => { if (confirm('Återkalla alla företagets API-nycklar? Samtliga anslutna integrationer förlorar åtkomst.'))
        op.run(() => change({ action: 'revoke_all' })); }}>Återkalla alla nycklar</button></section>;
}
export function LegalAccount() {
    const [state, setState] = useState<any>(null), [accepted, setAccepted] = useState(false);
    const op = useTask();
    useEffect(() => { op.run(async () => setState(await accountApi('/v1/account/legal', null))); }, []);
    return <section className="panel detail-panel account-controls"><h2>Kontovillkor</h2>{op.error && <p role="alert">{op.error}</p>}{state && <><p><a href={state.document.url} target="_blank" rel="noreferrer">Läs kontovillkor, version {state.document.version}</a></p>{state.accepted ? <p>Accepterade {date(state.acceptedAt)}.</p> : <form onSubmit={e => { e.preventDefault(); op.run(async () => { setState(await accountApi('/v1/account/legal', null, { accepted, version: state.document.version, sha256: state.document.sha256 })); setAccepted(false); }); }}><label><input type="checkbox" checked={accepted} required onChange={e => setAccepted(e.target.checked)}/>Jag accepterar kontovillkoren för mitt konto.</label><p>Accepten startar ingen betalning.</p><button className="secondary" disabled={op.busy || !accepted}>Acceptera kontovillkor</button></form>}<details><summary>Historik över accepterade villkor</summary>{state.history.length === 0 ? <p>Ingen registrerad accept.</p> : state.history.map((h: any) => <p key={h.version}><a href={'/legal/' + h.version + '/villkor.html'}>{h.version}</a> · {date(h.acceptedAt)}<small style={{ display: 'block', overflowWrap: 'anywhere' }}>SHA-256: {h.sha256}</small></p>)}</details></>}</section>;
}
export function PlanPreference({ orgId }: {
    orgId: string;
}) { const [state, setState] = useState<any>(null), [plan, setPlan] = useState(''); const op = useTask(); async function load() { const v = await accountApi('/v1/plan-preference', orgId); setState(v); setPlan(v.plan ?? ''); } useEffect(() => { op.run(load); }, [orgId]); return <section className="panel detail-panel account-controls"><h2>Företagets planintresse</h2><p>Spara vilket upplägg ni är intresserade av. Det startar inget abonnemang och ändrar inga behörigheter. Pris och betalningsmodell bestäms i en separat beställning.</p>{op.error && <p role="alert">{op.error}</p>}{state && <form onSubmit={e => { e.preventDefault(); op.run(async () => { const v = await accountApi('/v1/plan-preference', orgId, { plan: plan || null, revision: state.revision }); setState(v); }); }}><label>Upplägg<select value={plan} disabled={!state.canManage || op.busy} onChange={e => setPlan(e.target.value)}><option value="">Ej valt</option><option value="start">Start</option><option value="team">Team</option><option value="api">API</option></select></label>{state.canManage ? <button className="secondary" disabled={op.busy}>Spara planintresse</button> : <p>Företagets administratör kan ändra valet.</p>}{state.updatedAt && <small>Senast sparat {date(state.updatedAt)}</small>}</form>}<button className="secondary" disabled={op.busy} onClick={() => op.run(load)}>Hämta sparat val</button></section>; }
