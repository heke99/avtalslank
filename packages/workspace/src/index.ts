export type AgreementRow = {
    id: string;
    organization_id: string;
    title: string;
    status: string;
    generation: number;
    updated_at: string;
};
export type AgreementFilter = {
    organizationId: string;
    query: string;
    status: string;
    from: string;
    to: string;
    sort: 'latest' | 'oldest' | 'title';
};
const localDay = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
export function filterAgreements<T extends AgreementRow>(rows: T[], f: AgreementFilter): T[] {
    const query = f.query.trim().toLocaleLowerCase('sv');
    return rows.filter(r => { const day = localDay(r.updated_at); return r.organization_id === f.organizationId && (!f.status || r.status === f.status) && r.title.toLocaleLowerCase('sv').includes(query) && (!f.from || (day && day >= f.from)) && (!f.to || (day && day <= f.to)); }).sort((a, b) => { const time = (v: string) => Number.isNaN(Date.parse(v)) ? 0 : Date.parse(v); const delta = f.sort === 'title' ? a.title.localeCompare(b.title, 'sv') : f.sort === 'oldest' ? time(a.updated_at) - time(b.updated_at) : time(b.updated_at) - time(a.updated_at); return delta || a.id.localeCompare(b.id); });
}
export function csvCell(value: unknown) { let s = String(value ?? '').replace(/\u0000/g, ''); if (/^[\s\uFEFF]*[=+\-@]/u.test(s) || /^[\t\r\n]/.test(s))
    s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
export function agreementCsv(rows: AgreementRow[], organizationId: string, statusLabels: Record<string, string>) { const own = rows.filter(r => r.organization_id === organizationId); const data = [['Avtals-ID', 'Avtalsnamn', 'Status', 'Version', 'Uppdaterad (ISO 8601)'], ...own.map(r => [r.id, r.title, statusLabels[r.status] ?? r.status, r.generation, r.updated_at])]; return '\uFEFF' + data.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'; }
export function restartableFactors(factors: Array<{
    id: string;
    status: string;
    factor_type: string;
    friendly_name?: string;
}>) { return factors.filter(f => f.status === 'unverified' && f.factor_type === 'totp' && f.friendly_name === 'Avtalslänk').map(f => f.id); }
