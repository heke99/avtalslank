const labels: Record<string, string> = {
    'organization.created': 'Företag skapat', 'organization.updated': 'Företagsprofil ändrad',
    'envelope.draft_saved': 'Utkast sparat', 'envelope.sent': 'Avtal skickat', 'envelope.completed': 'Avtal färdigställt', 'envelope.cancelled': 'Avtal avbrutet', 'envelope.expired': 'Avtal utgånget',
    'recipient.added': 'Mottagare tillagd', 'recipient.signed': 'Mottagare har godkänt', 'recipient.declined': 'Mottagare har avböjt', 'recipient.reminder_queued': 'Påminnelse köad',
    'document.uploaded': 'Dokument uppladdat', 'document.scanned': 'Dokumentkontroll utförd',
    'team.invitation_created': 'Teaminbjudan skapad', 'team.invitation_accepted': 'Teaminbjudan accepterad', 'team.invitation_revoked': 'Teaminbjudan återkallad', 'member.left': 'Medlem lämnade företaget', 'member.role_changed': 'Medlems behörighet ändrad',
};
export function activityLabel(kind: string) { return labels[kind] ?? 'Systemhändelse'; }
