import { validateFields, type TemplateField } from '../../domain/src/index';
export type Field = {
    id: string;
    documentId: string;
    recipientId: string;
    label: string;
    type: 'text' | 'date';
    required: boolean;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
};
export type FieldTemplate = {
    id: string;
    name: string;
    version: number;
    fields: TemplateField[];
};
export type EditorDocument = {
    id: string;
    status: string;
    page_count: number | null;
};
export function templateList<T extends FieldTemplate>(templates: T[], query: string, sort: string) { const q = query.trim().toLocaleLowerCase('sv'); return templates.filter(t => (t.name + ' ' + t.fields.map(f => f.label + ' ' + f.recipientRole).join(' ')).toLocaleLowerCase('sv').includes(q)).toSorted((a, b) => (sort === 'fields' ? b.fields.length - a.fields.length : sort === 'version' ? b.version - a.version : a.name.localeCompare(b.name, 'sv')) || a.id.localeCompare(b.id)); }
export function validateTemplateFields(fields: TemplateField[]) { try {
    validateFields(fields);
    if (fields.length > 200 || fields.some(f => f.label.trim().length > 120 || f.recipientRole.trim().length > 120 || typeof f.required !== 'boolean'))
        throw Error();
}
catch {
    throw Error('INVALID_TEMPLATE_LAYOUT');
} }
export function templateRoles(template: FieldTemplate) { return [...new Set(template.fields.map(f => String(f.recipientRole ?? '').trim()))]; }
export function validateEditorFields(fields: Field[], documents: EditorDocument[], recipients: {
    id: string;
}[]) {
    if (fields.length > 200)
        throw Error('FIELD_LIMIT');
    const ids = new Set();
    for (const f of fields) {
        const doc = documents.find(d => d.id === f.documentId);
        if (!doc || doc.status !== 'ready' || !doc.page_count || !Number.isInteger(f.page) || f.page < 0 || f.page >= doc.page_count || !recipients.some(r => r.id === f.recipientId))
            throw Error('INVALID_FIELD_ASSIGNMENT');
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(f.id) || ids.has(f.id) || !['text', 'date'].includes(f.type) || !f.label.trim() || f.label.trim().length > 120 || typeof f.required !== 'boolean')
            throw Error('INVALID_FIELDS');
        ids.add(f.id);
        if (![f.x, f.y, f.width, f.height].every(Number.isFinite) || f.x < 0 || f.y < 0 || f.width <= 0 || f.height <= 0 || f.x + f.width > 1 || f.y + f.height > 1)
            throw Error('FIELD_OUTSIDE_PAGE');
    }
    return fields;
}
export function applyTemplate(template: FieldTemplate, doc: EditorDocument, mapping: Record<string, string>, recipients: {
    id: string;
}[], existing: Field[], newId: () => string = () => crypto.randomUUID()): Field[] {
    validateTemplateFields(template.fields);
    if (!template.fields.length)
        throw Error('EMPTY_TEMPLATE');
    if (template.fields.some(f => f.type === 'signature'))
        throw Error('TEMPLATE_SIGNATURE_FIELD');
    for (const role of templateRoles(template))
        if (!Object.hasOwn(mapping, role) || !recipients.some(r => r.id === mapping[role]))
            throw Error('ROLE_MAPPING_REQUIRED');
    const copied = template.fields.map(f => ({ id: newId(), documentId: doc.id, recipientId: mapping[f.recipientRole.trim()], label: f.label.trim(), type: f.type as 'text' | 'date', required: f.required, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }));
    validateEditorFields(copied, [doc], recipients);
    const result = [...existing, ...copied];
    if (result.length > 200)
        throw Error('FIELD_LIMIT');
    if (new Set(result.map(f => f.id)).size !== result.length)
        throw Error('INVALID_FIELDS');
    return result;
}
export function moveField(field: Field, dx: number, dy: number): Field { return { ...field, x: Math.min(1 - field.width, Math.max(0, Math.round((field.x + dx) * 10000) / 10000)), y: Math.min(1 - field.height, Math.max(0, Math.round((field.y + dy) * 10000) / 10000)) }; }
export function copyField(field: Field, newId: () => string = () => crypto.randomUUID()): Field { return { ...moveField(field, 0.02, 0.02), id: newId(), label: (field.label + ' – kopia').slice(0, 120) }; }
