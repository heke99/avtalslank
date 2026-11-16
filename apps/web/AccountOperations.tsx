import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, apiUrl, friendlyError } from './client';
export async function accountApi(path: string, orgId: string | null, body?: Record<string, unknown>) {
    const { data } = await supabase.auth.getSession();
    if (!data.session)
        throw Error('AUTH_REQUIRED');
    const response = await fetch(apiUrl + path + (body ? '' : orgId ? '?organizationId=' + encodeURIComponent(orgId) : ''), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify({ ...body, organizationId: orgId }) } : {}) });
    const result = await response.json();
    if (!response.ok)
        throw Error(result.error?.code ?? result.error ?? 'REQUEST_FAILED');
    return result.data;
}
function useOperation() { const [busy, setBusy] = useState(false), [message, setMessage] = useState(''); async function run(fn: () => Promise<void>) { if (busy)
    return; setBusy(true); setMessage(''); try {
    await fn();
}
catch (e) {
    setMessage(friendlyError((e as Error).message));
}
finally {
    setBusy(false);
} } return { busy, message, setMessage, run }; }
export function TeamInvitations({ orgId, admin, owner }: {
    orgId: string;
    admin: boolean;
    owner: boolean;
}) {
    const [items, setItems] = useState<any[]>([]), [link, setLink] = useState('');
    const op = useOperation();
    async function load() { setItems(await accountApi('/v1/team/invitations', orgId)); }
    useEffect(() => { if (admin)
        op.run(load); }, [orgId, admin]);
    return <section className="operation-form"><h3>Bjud in till företaget</h3>{op.message && <p role="alert">{op.message}</p>}
 {admin && <><p>Inbjudan gäller i sju dagar och kan bara tas emot med den angivna, verifierade e-postadressen. Dela länken med personen.</p>
 <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setLink(''); op.run(async () => { const v = await accountApi('/v1/team/invitations', orgId, { email: f.get('email'), role: f.get('role') }); setLink(location.origin + '/join/#token=' + v.token); await load(); }); }}>
 <label>E-post för inbjudan<input name="email" type="email" maxLength={254} required/></label><label>Inbjudans roll<select name="role"><option value="sender">Avsändare</option><option value="reader">Läsare</option>{owner && <option value="admin">Administratör</option>}</select></label><button className="primary" disabled={op.busy}>Skapa inbjudningslänk</button></form>
 {link && <label>Inbjudningslänk – visas bara nu<input readOnly value={link} onFocus={e => e.target.select()}/></label>}
 {items.map(i => <div className="list-row" key={i.id}><span className="grow">{i.email}<small>{i.accepted_at ? 'Accepterad' : i.revoked_at ? 'Återkallad' : new Date(i.expires_at) <= new Date() ? 'Utgången' : 'Väntar på svar'}</small></span>{!i.accepted_at && !i.revoked_at && <button className="secondary" disabled={op.busy} onClick={() => op.run(async () => { await accountApi('/v1/team/revoke', orgId, { id: i.id }); await load(); })}>Återkalla inbjudan</button>}</div>)}</>}
 <button className="secondary" disabled={op.busy} onClick={() => { if (confirm('Vill du lämna företaget? Din åtkomst och dina API-nycklar för företaget avslutas.'))
        op.run(async () => { await accountApi('/v1/team/leave', orgId, {}); location.assign('/'); }); }}>Lämna företaget</button><p className="muted">Den sista ägaren måste först utse en annan ägare.</p></section>;
}
export function JoinInvitation({ session, children }: {
    session: Session | null;
    children: React.ReactNode;
}) {
    const op = useOperation();
    const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    // The same-origin token survives a confirmation redirect across tabs, expires locally, and never goes in a URL query.
    useEffect(() => { if (/^[a-f0-9]{64}$/.test(token))
        localStorage.setItem('al.join', JSON.stringify({ token, until: Date.now() + 7 * 86400000 })); }, [token]);
    let saved = '';
    try {
        const v = JSON.parse(localStorage.getItem('al.join') ?? '{}');
        if (v.until > Date.now() && /^[a-f0-9]{64}$/.test(v.token))
            saved = v.token;

    }
    catch { }
    useEffect(()=>{try{const v=JSON.parse(localStorage.getItem('al.join')??'{}');if(v.until && v.until<=Date.now())localStorage.removeItem('al.join');}catch{localStorage.removeItem('al.join');}},[]);
    const invitation = /^[a-f0-9]{64}$/.test(token) ? token : saved;
    return <><section className="panel detail-panel"><h1>Inbjudan till Avtalslänk</h1><p>Logga in med e-postadressen som inbjudan skickades till. Ett nytt konto behöver verifieras via e-post.</p>{op.message && <p role="alert">{op.message}</p>}{session && <><p>Inloggad som {session.user.email}</p><button className="primary" disabled={op.busy || !invitation} onClick={() => op.run(async () => { await accountApi('/v1/team/accept', null, { token: invitation }); localStorage.removeItem('al.join'); location.replace('/'); })}>Acceptera inbjudan</button><button className="secondary" onClick={() => op.run(async () => { const r = await supabase.auth.signOut({ scope: 'local' }); if (r.error)
        throw r.error; })}>Byt konto</button></>}{!invitation && <p role="alert">Inbjudningslänken saknas. Öppna länken du fick.</p>}</section>{!session && children}</>;
}
export function AccountSecurity() {
    const op = useOperation();
    const [factors, setFactors] = useState<Array<{
        id: string;
        friendly_name?: string;
    }>>([]), [enrollment, setEnrollment] = useState<{
        id: string;
        qr: string;
        secret: string;
    } | null>(null), [nonceSent, setNonceSent] = useState(false);
    async function load() { const r = await supabase.auth.mfa.listFactors(); if (r.error)
        throw r.error; setFactors(r.data.totp); }
    useEffect(() => { op.run(load); }, []);
    return <section className="panel detail-panel full-grid"><h2>Kontosäkerhet</h2>{op.message && <p role="status">{op.message}</p>}<h3>Tvåstegsverifiering</h3><p>Använd en autentiseringsapp för en extra kontroll vid inloggning. Företagets behörigheter gäller fortfarande.</p>
 {!factors.length && !enrollment && <button className="secondary" disabled={op.busy} onClick={() => op.run(async () => { const r = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Avtalslänk' }); if (r.error)
        throw r.error; setEnrollment({ id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret }); })}>Ställ in autentiseringsapp</button>}
 {enrollment && <div><img src={enrollment.qr} alt="QR-kod för autentiseringsapp" width={180} height={180}/><label>Manuell inställningsnyckel<input readOnly value={enrollment.secret}/></label></div>}
 {(enrollment || factors.length > 0) && <form onSubmit={e => { e.preventDefault(); const code = String(new FormData(e.currentTarget).get('code')); op.run(async () => { const id = enrollment?.id ?? factors[0].id; const c = await supabase.auth.mfa.challenge({ factorId: id }); if (c.error)
        throw c.error; const v = await supabase.auth.mfa.verify({ factorId: id, challengeId: c.data.id, code }); if (v.error)
        throw v.error; setEnrollment(null); await load(); op.setMessage('Tvåstegsverifieringen är klar för den här sessionen.'); }); }}><label>Kod från autentiseringsappen<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6}/></label><button className="primary" disabled={op.busy}>Verifiera kod</button></form>}
 {factors.length > 0 && <><p>Autentiseringsapp är aktiverad. Verifiera en kod efter inloggning för att höja sessionens säkerhetsnivå.</p><button className="secondary" disabled={op.busy} onClick={() => { if (confirm('Ta bort autentiseringsappen?'))
        op.run(async () => { const a = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(); if (a.error)
            throw a.error; if (a.data.currentLevel !== 'aal2')
            throw Error('MFA_REQUIRED'); const r = await supabase.auth.mfa.unenroll({ factorId: factors[0].id }); if (r.error)
            throw r.error; await load(); }); }}>Ta bort autentiseringsapp</button></>}
 <h3>Byt lösenord</h3><p>Begär en verifieringskod via e-post innan du byter lösenord.</p><button className="secondary" disabled={op.busy} onClick={() => op.run(async () => { const r = await supabase.auth.reauthenticate(); if (r.error)
        throw r.error; setNonceSent(true); op.setMessage('Kontrollera din e-post efter verifieringskoden.'); })}>Skicka verifieringskod</button>
 {nonceSent && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); op.run(async () => { if (f.get('password') !== f.get('confirm'))
        throw Error('PASSWORD_MISMATCH'); const r = await supabase.auth.updateUser({ password: String(f.get('password')), nonce: String(f.get('nonce')) }); if (r.error)
        throw r.error; setNonceSent(false); op.setMessage('Lösenordet är ändrat.'); }); }}><label>Verifieringskod från e-post<input name="nonce" autoComplete="one-time-code" required/></label><label>Nytt lösenord<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label><label>Bekräfta nytt lösenord<input name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label><button className="primary" disabled={op.busy}>Spara nytt lösenord</button></form>}
 <h3>Aktiva sessioner</h3><button className="secondary" disabled={op.busy} onClick={() => { if (confirm('Logga ut från alla enheter?'))
        op.run(async () => { const r = await supabase.auth.signOut({ scope: 'global' }); if (r.error)
            throw r.error; location.assign('/login'); }); }}>Logga ut från alla enheter</button><p className="muted">Utloggning stoppar förnyelse av sessioner. Redan utfärdade åtkomsttoken gäller tills de löper ut.</p></section>;
}
export function OperationalStatus({ orgId }: {
    orgId: string;
}) { const op = useOperation(); const [status, setStatus] = useState<any>(null); async function load() { setStatus(await accountApi('/v1/status', orgId)); } useEffect(() => { op.run(load); }, [orgId]); return <section className="panel detail-panel full-grid"><h2>Driftstatus</h2>{op.message && <p role="alert">{op.message}</p>}{status && <><p>Dokumentarbetare: {status.workerFresh ? 'Aktuell beredskapssignal' : 'Ingen aktuell beredskapssignal'}</p><p>Signeringsutskick: {status.signingConfigured ? 'Förberett; leveransen behöver verifieras' : 'Inte konfigurerat'}</p><h3>Företagets leveransjobb</h3>{Object.entries(status.deliveries).map(([k, n]) => <p key={k}>{k}: {String(n)}</p>)}<p className="muted">En beredskapssignal är inte bevis på en genomförd signering eller leverans.</p></>}<button className="secondary" disabled={op.busy} onClick={() => op.run(load)}>Uppdatera driftstatus</button></section>; }
export function RemindRecipient({ orgId, envelopeId, recipientId }: {
    orgId: string;
    envelopeId: string;
    recipientId: string;
}) { const op = useOperation(); return <span><button className="secondary" disabled={op.busy} onClick={() => op.run(async () => { await accountApi('/v1/envelopes/' + envelopeId + '/remind', orgId, { recipientId }); op.setMessage('Påminnelsen ligger i utskickskön.'); })}>Skicka påminnelse</button>{op.message && <small role="status">{op.message}</small>}</span>; }
