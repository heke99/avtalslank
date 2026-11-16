import React, { useEffect, useState } from 'react';
import { supabase, friendlyError } from './client';
export default function GettingStarted({ orgId, envelopes, templates, open }: {
    orgId: string;
    envelopes: number;
    templates: number;
    open: (view: string) => void;
}) {
    const [team, setTeam] = useState<number | null>(null), [error, setError] = useState('');
    useEffect(() => { let active = true; setTeam(null); setError(''); supabase.from('al_memberships').select('user_id').eq('organization_id', orgId).eq('active', true).then(({ data, error }) => { if (!active)
        return; if (error)
        setError(friendlyError(error.message));
    else
        setTeam(data?.length ?? 0); }); return () => { active = false; }; }, [orgId]);
    const steps = [{ label: 'Första utkastet', done: envelopes > 0, detail: 'Skapa ett utkast och lägg till dokument och mottagare.', view: 'agreements' }, { label: 'En återanvändbar mall', done: templates > 0, detail: 'Spara fält som återkommer i era avtal.', view: 'templates' }, { label: 'Fler kollegor i arbetsytan', done: team !== null && team > 1, detail: team === null ? 'Medlemskap kontrolleras…' : 'Bjud in en kollega med rätt behörighet.', view: 'workspace' }];
    return <section className="panel getting-started"><div className="panel-header"><div><h2>Kom igång med arbetsytan</h2><p>{steps.filter(s => s.done).length} av 3 förberedelser klara</p></div></div>{error && <p role="alert">{error}</p>}<ol>{steps.map((s, i) => <li key={s.label}><span aria-label={s.done ? 'Klart' : 'Återstår'}>{s.done ? '✓' : String(i + 1).padStart(2, '0')}</span><div><strong>{s.label}</strong><p>{s.detail}</p></div><button className="secondary" onClick={() => open(s.view)}>Öppna {s.label.toLocaleLowerCase('sv')}</button></li>)}</ol><p className="muted">Checklistan följer företagets faktiska uppgifter. Den aktiverar inte betalning eller signering.</p></section>;
}
