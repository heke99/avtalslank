import React, { useEffect, useState } from 'react';
import { supabase, displayError } from './client';
import { applyTemplate, templateRoles, type Field, type FieldTemplate, type EditorDocument } from '../../packages/editor/src/index';
export function TemplateApply({ orgId, documents, recipients, fields, onApply, disabled }: {
    orgId: string;
    documents: (EditorDocument & {
        name: string;
    })[];
    recipients: {
        id: string;
        name: string;
    }[];
    fields: Field[];
    onApply: (fields: Field[], name: string, version: number) => void;
    disabled: boolean;
}) {
    const [templates, setTemplates] = useState<FieldTemplate[]>([]), [id, setId] = useState(''), [docId, setDocId] = useState(''), [mapping, setMapping] = useState<Record<string, string>>({}), [error, setError] = useState('');
    useEffect(() => { let active = true; supabase.from('al_templates').select('id,name,version,fields').eq('organization_id', orgId).order('name').then(({ data, error }) => { if (!active)
        return; if (error)
        setError(displayError(error));
    else
        setTemplates(data ?? []); }); return () => { active = false; }; }, [orgId]);
    const template = templates.find(t => t.id === id);
    return <fieldset className="template-apply" disabled={disabled}><legend>Använd fältmall</legend><p>Fälten kopieras till ett dokument. Koppla varje roll till en mottagare och spara sedan dokumentfälten. Mallens original ändras inte.</p>{error && <p role="alert">{error}</p>}<label>Fältmall<select aria-label="Fältmall att använda" value={id} onChange={e => { setId(e.target.value); setMapping({}); setError(''); }}><option value="">Välj fältmall</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · version {t.version}</option>)}</select></label>
 <label>Måldokument<select aria-label="Mallens måldokument" value={docId} onChange={e => setDocId(e.target.value)}><option value="">Välj kontrollerad PDF</option>{documents.filter(d => d.status === 'ready' && d.page_count).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
 {template && templateRoles(template).map(role => <label key={role}>Mottagare för {role}<select aria-label={'Mottagare för ' + role} value={mapping[role] ?? ''} onChange={e => setMapping({ ...mapping, [role]: e.target.value })}><option value="">Välj mottagare</option>{recipients.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>)}
 <button type="button" className="secondary" disabled={!template || !docId} onClick={() => { setError(''); try {
        const doc = documents.find(d => d.id === docId);
        if (!template || !doc)
            throw Error('INVALID_FIELD_ASSIGNMENT');
        const result = applyTemplate(template, doc, mapping, recipients, fields);
        onApply(result, template.name, template.version);
    }
    catch (e) {
        setError(displayError(e));
    } }}>Lägg in mallens fält</button></fieldset>;
}
