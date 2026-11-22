import {bounded} from './deadline';
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
    const [attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true),[loadFailed,setLoadFailed]=useState(false);
    useEffect(()=>{let active=true;setLoading(true);setError('');bounded(supabase.from('al_templates').select('id,name,version,fields').eq('organization_id',orgId).is('pdf_path',null).order('name')).then(({data,error})=>{if(error)throw error;if(active){setTemplates(data??[]);setLoadFailed(false);}}).catch(e=>{if(active){setError(displayError(e));setLoadFailed(true);}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[orgId,attempt]);
    const template = templates.find(t => t.id === id);
    return <fieldset className="template-apply" disabled={disabled}><legend>Använd fältmall</legend><p>Fälten kopieras till ett dokument. Koppla varje roll till en mottagare och spara sedan dokumentfälten. Mallens original ändras inte.</p>{error && <><p role="alert">{error}</p><button type="button" className="secondary" disabled={loading} onClick={()=>setAttempt(a=>a+1)}>Hämta fältmallar igen</button></>}<label>Fältmall<select aria-label="Fältmall att använda" disabled={loading} value={id} onChange={e => { setId(e.target.value); setMapping({}); setError(''); }}><option value="">Välj fältmall</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · version {t.version}</option>)}</select></label>
 <label>Måldokument<select aria-label="Mallens måldokument" value={docId} onChange={e => setDocId(e.target.value)}><option value="">Välj kontrollerad PDF</option>{documents.filter(d => d.status === 'ready' && d.page_count).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
 {template && templateRoles(template).map(role => <label key={role}>Mottagare för {role}<select aria-label={'Mottagare för ' + role} value={mapping[role] ?? ''} onChange={e => setMapping({ ...mapping, [role]: e.target.value })}><option value="">Välj mottagare</option>{recipients.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>)}
 <button type="button" className="secondary" disabled={loading || loadFailed || !template || !docId} onClick={() => { setError(''); try {
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
