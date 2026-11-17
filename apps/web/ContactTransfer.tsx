import {bounded} from './deadline';
import React, { useState, useRef, useEffect } from 'react';
import { parseContactCsv, inspectContactRows, contactCsv, type ContactInput } from '../../packages/contacts/src/index';
import { accountApi } from './AccountOperations';
import { displayError } from './client';
export function ContactTransfer({ orgId, writable, visible, onImported }: {
    orgId: string;
    writable: boolean;
    visible: ContactInput[];
    onImported: () => Promise<void>;
}) {
    const [table, setTable] = useState<string[][]>([]), [delimiter, setDelimiter] = useState<',' | ';'>(';'), [source, setSource] = useState(''), [mapping, setMapping] = useState({ name: 0, email: 1, company: 2 }), [requestId, setRequestId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<any>(null), [history, setHistory] = useState<any[]>([]);
    const readVersion=useRef(0),currentDelimiter=useRef(delimiter);currentDelimiter.current=delimiter;
    useEffect(()=>()=>{readVersion.current++;},[]);
    function parse(text: string, sep: ',' | ';') { setTable([]); setResult(null); setError(''); setRequestId(crypto.randomUUID()); try {
        const rows = parseContactCsv(text, sep);
        setTable(rows);
        const headers = rows[0].map(c => c.trim().toLocaleLowerCase('sv'));
        const pick = (names: string[], fallback: number) => { const i = headers.findIndex(h => names.includes(h)); return i >= 0 ? i : fallback; };
        setMapping({ name: pick(['namn', 'name'], 0), email: pick(['e-post', 'email', 'e-postadress'], 1), company: pick(['företag', 'company'], -1) });
    }
    catch (e) {
        setError(displayError(e));
    } }
    let preview: ReturnType<typeof inspectContactRows> = [], mappingError = '';
    try {
        if (table.length)
            preview = inspectContactRows(table, mapping);
    }
    catch (e) {
        mappingError = displayError(e);
    }
    const valid = preview.length > 0 && preview.every(r => !r.errors.length) && !mappingError;
    const payload = { organizationId: orgId, requestId, rows: preview.map(r => r.contact) };
    const tooLarge = new TextEncoder().encode(JSON.stringify(payload)).length > 64000;
    async function loadHistory() { setHistory(await accountApi('/v1/contacts/imports', orgId)); }
    return <section className="contact-transfer"><h3>Import och export</h3><p>CSV med högst 200 kontakter per import. Befintliga e-postadresser, även arkiverade, lämnas oförändrade. Ingen inbjudan eller e-post skickas.</p>
 <button type="button" className="secondary" disabled={busy || !visible.length} onClick={() => { const url = URL.createObjectURL(new Blob([contactCsv(visible)], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'avtalslank-kontakter.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Exportera visade kontakter ({visible.length})</button><p className="muted">Exporten omfattar sökresultatet i den inlästa kontaktlistan, högst 500 kontakter.</p>
 {writable && <><label>CSV-fil<input aria-label="CSV-fil med kontakter" type="file" accept=".csv,text/csv" disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file)
            return; const attempt=++readVersion.current;setError(''); setResult(null); setTable([]); setSource(''); if (file.size > 262144) {
            setError('CSV-filen får vara högst 256 KB.');
            return;
        } try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(await bounded(file.arrayBuffer()));
            if(attempt!==readVersion.current)return;setSource(text);
            parse(text, currentDelimiter.current);
        }
        catch (e) {
            if(attempt!==readVersion.current)return;setError((e as Error).message==='REQUEST_TIMEOUT'?displayError(e):'Filen måste vara en UTF-8-kodad CSV-fil.');
        } }}/></label><label>Avgränsare<select aria-label="CSV-avgränsare" disabled={busy} value={delimiter} onChange={e => { const sep = e.target.value as ',' | ';'; setDelimiter(sep); if (source)
            parse(source, sep); }}><option value=";">Semikolon</option><option value=",">Komma</option></select></label>
 {table.length > 0 && <><div className="two-columns">{(['name', 'email', 'company'] as const).map(k => <label key={k}>{{ name: 'Namnkolumn', email: 'E-postkolumn', company: 'Företagskolumn' }[k]}<select aria-label={{ name: 'Namnkolumn', email: 'E-postkolumn', company: 'Företagskolumn' }[k]} disabled={busy || !!result} value={mapping[k]} onChange={e => { setMapping({ ...mapping, [k]: Number(e.target.value) }); setRequestId(crypto.randomUUID()); setResult(null); }}>{k === 'company' && <option value={-1}>Ingen företagskolumn</option>}{table[0].map((h, i) => <option key={i} value={i}>{i + 1}. {h || '(utan rubrik)'}</option>)}</select></label>)}</div><h4>Förhandsgranskning – {preview.length} kontakter</h4>{mappingError && <p role="alert">{mappingError}</p>}{tooLarge && <p role="alert">Importen är för stor för ett anrop. Dela upp den i mindre filer.</p>}<p className="muted">Förhandsgranskningstabellen kan rullas i sidled.</p><div className="table-wrap" role="region" aria-label="Förhandsgranskning av kontaktimport" tabIndex={0}><table><thead><tr><th>CSV-post</th><th>Namn</th><th>E-post</th><th>Företag</th><th>Kontroll</th></tr></thead><tbody>{preview.map(r => <tr key={r.row}><td>{r.row}</td><td>{r.contact.name}</td><td>{r.contact.email}</td><td>{r.contact.company}</td><td>{r.errors.join(' ') || 'OK'}</td></tr>)}</tbody></table></div><p>Ingen kontakt sparas förrän du bekräftar importen. Alla fel behöver rättas först.</p><button type="button" className="primary" disabled={busy || !valid || tooLarge || !!result} onClick={async () => { setBusy(true); setError(''); try {
            const data = await accountApi('/v1/contacts/imports', orgId, payload);
            setResult(data);
            await onImported();
            await loadHistory();
        }
        catch (e) {
            setError(displayError(e));
        }
        finally {
            setBusy(false);
        } }}>Bekräfta kontaktimport</button><small>Importreferens: {requestId}. Om svaret avbryts kan du försöka igen med samma förhandsgranskning.</small></>}
 </>}
 {error && <p role="alert">{error}</p>}{result && <p role="status">Import klar: {result.created} nya, {result.skipped} befintliga hoppades över ({result.archivedSkipped} arkiverade).</p>}
 <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try {
        await loadHistory();
    }
    catch (e) {
        setError(displayError(e));
    }
    finally {
        setBusy(false);
    } }}>Hämta importhistorik</button>{history.map(h => <p key={h.requestId}>{new Date(h.createdAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })} · {h.result.created} nya, {h.result.skipped} överhoppade<small>Referens: {h.requestId}</small></p>)}</section>;
}
