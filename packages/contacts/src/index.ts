import { csvCell } from '../../workspace/src/index';
export type ContactInput = {
    name: string;
    email: string;
    company: string;
};
export function parseContactCsv(source: string, delimiter: ',' | ';' = ';'): string[][] {
    if (new TextEncoder().encode(source).length > 262144)
        throw Error('CSV_TOO_LARGE');
    source = source.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let row: string[] = [], value = '', quoted = false, closed = false;
    const cell = () => { row.push(value); value = ''; closed = false; if (row.length > 30)
        throw Error('CSV_COLUMNS'); };
    const line = () => { cell(); if (row.some(c => c !== ''))
        rows.push(row); row = []; if (rows.length > 201)
        throw Error('CONTACT_IMPORT_LIMIT'); };
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\0')
            throw Error('INVALID_CSV');
        if (quoted) {
            if (c === '"') {
                if (source[i + 1] === '"') {
                    value += '"';
                    i++;
                }
                else {
                    quoted = false;
                    closed = true;
                }
            }
            else
                value += c;
            continue;
        }
        if (c === '"') {
            if (value || closed)
                throw Error('INVALID_CSV');
            quoted = true;
        }
        else if (c === delimiter)
            cell();
        else if (c === '\r' || c === '\n') {
            if (c === '\r' && source[i + 1] === '\n')
                i++;
            line();
        }
        else {
            if (closed)
                throw Error('INVALID_CSV');
            value += c;
        }
    }
    if (quoted)
        throw Error('INVALID_CSV');
    if (value || row.length || closed)
        line();
    if (rows.length < 2)
        throw Error('CSV_NO_DATA');
    const width = rows[0].length;
    if (rows.some(r => r.length !== width))
        throw Error('CSV_COLUMNS');
    if(rows[0].length===4&&rows[0][0]==='Namn'&&rows[0][1]==='E-post'&&rows[0][2]==='Företag'&&rows[0][3]===transferMarker){
        return rows.map((r,i)=>r.slice(0,3).map(value=>i>0&&value.startsWith("'")?value.slice(1):value));
    }
    return rows;
}
export function inspectContactRows(table: string[][], mapping: {
    name: number;
    email: number;
    company: number;
}) {
    const indexes = [mapping.name, mapping.email, ...(mapping.company >= 0 ? [mapping.company] : [])];
    if (indexes.some(i => !Number.isInteger(i) || i < 0 || i >= table[0]?.length) || new Set(indexes).size !== indexes.length)
        throw Error('CSV_MAPPING');
    const seen = new Set<string>();
    return table.slice(1).map((r, i) => {
        const contact = { name: (r[mapping.name] ?? '').trim(), email: (r[mapping.email] ?? '').trim().toLowerCase(), company: mapping.company < 0 ? '' : (r[mapping.company] ?? '').trim() };
        const errors: string[] = [];
        if (contact.name.length < 2 || contact.name.length > 120)
            errors.push('Namn ska vara 2–120 tecken.');
        if (contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))
            errors.push('Ogiltig e-postadress.');
        if (contact.company.length > 160)
            errors.push('Företag får vara högst 160 tecken.');
        if (seen.has(contact.email))
            errors.push('Dubblett av e-post i filen.');
        seen.add(contact.email);
        return { row: i + 2, contact, errors };
    });
}
export function contactCsv(rows: ContactInput[]) { return '\uFEFF' + [['Namn', 'E-post', 'Företag'], ...rows.map(c => [c.name, c.email, c.company])].map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'; }

const transferMarker='Avtalslänk CSV v1';
export function contactTransferFiles(rows: ContactInput[]) {
    const encoder=new TextEncoder();
    const files: string[]=[];
    let part: ContactInput[]=[];
    let bytes=0;
    const encode=(value:string)=>csvCell(value.startsWith("'")?"'"+value:value);
    const write=()=>{
        const headers=['Namn','E-post','Företag',transferMarker].map(csvCell).join(';');
        files.push('\uFEFF'+[headers,...part.map(c=>[encode(c.name),encode(c.email),encode(c.company),'""'].join(';'))].join('\r\n')+'\r\n');
        part=[];bytes=0;
    };
    for(const contact of rows){
        const size=encoder.encode(JSON.stringify(contact)).length;
        if(part.length===200||bytes+size>60000)write();
        part.push(contact);bytes+=size+1;
    }
    if(part.length)write();
    return files;
}
