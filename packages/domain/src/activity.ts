const labels: Record<string, string> = {
    'contacts.imported':'Kontakter importerade', 'api_key.rotated':'API-nyckel roterad',
    'webhook.secret_rotated':'Webhookhemlighet bytt', 'account.registration_completed':'Konto färdigregistrerat',
    'envelope.finalization_retried':'Slutdokument köat igen',
    'recipient.updated' :'Mottagare ändrad', 'recipient.removed':'Mottagare borttagen', 'recipients.reordered':'Signeringsordning ändrad',
    'envelope.fields_saved':'Dokumentfält sparade', 'envelope.duplicated':'Utkast kopierat', 'envelope.declined':'Avtal avböjt',
    'document.detached':'Dokument borttaget från utkast', 'contact.saved':'Kontakt sparad', 'member.updated':'Medlems behörighet ändrad',
    'template.saved':'Mall sparad', 'template.deleted':'Mall borttagen', 'api_key.created':'API-nyckel skapad', 'api_key.revoked':'API-nyckel återkallad', 'webhook.configured':'Webhook ändrad',
    'organization.created': 'Företag skapat', 'organization.updated': 'Företagsprofil ändrad',
    'envelope.draft_saved': 'Utkast sparat', 'envelope.sent': 'Avtal skickat', 'envelope.completed': 'Avtal färdigställt', 'envelope.cancelled': 'Avtal avbrutet', 'envelope.expired': 'Avtal utgånget',
    'recipient.added': 'Mottagare tillagd', 'recipient.signed': 'Mottagare har godkänt', 'recipient.declined': 'Mottagare har avböjt', 'recipient.reminder_queued': 'Påminnelse köad',
    'document.uploaded': 'Dokument uppladdat', 'document.scanned': 'Dokumentkontroll utförd',
    'team.invitation_created': 'Teaminbjudan skapad', 'team.invitation_accepted': 'Teaminbjudan accepterad', 'team.invitation_revoked': 'Teaminbjudan återkallad', 'member.left': 'Medlem lämnade företaget', 'member.role_changed': 'Medlems behörighet ändrad',
};
export function activityLabel(kind: string) { return labels[kind] ?? 'Systemhändelse'; }
