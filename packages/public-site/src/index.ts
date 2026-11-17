export const legalVersion = '2026-11-17';
export const plans = [
    { id: 'start', name: 'Start', audience: 'För enstaka avtal', description: 'Ett enkelt upplägg för dig som skickar avtal då och då.', features: ['Webbapp för dokument och mottagare', 'Sparade kontakter och återanvändbara mallar', 'Överblick över avtal och händelser'] },
    { id: 'team', name: 'Team', audience: 'För företag som arbetar tillsammans', description: 'En gemensam arbetsyta för kollegor, avtal och uppföljning.', features: ['Arbetsyta med flera användare', 'Roller för ägare, administratörer, avsändare och läsare', 'Gemensamma kontakter, mallar och aktivitetslogg'] },
    { id: 'api', name: 'API', audience: 'För avtal i ditt eget system', description: 'Bygg in avtalsflödet i företagets befintliga tjänster.', features: ['API-nycklar med avgränsad behörighet', 'Dokument och mottagare via API', 'Webhook-inställningar och leveranshistorik'] },
] as const;
export type PlanId = typeof plans[number]['id'];
export function selectedPlan(value: string | null): PlanId | null { return plans.some(p => p.id === value) ? value as PlanId : null; }
export function signupMetadata(plan: string | null, accepted: boolean) { if (!accepted)
    throw Error('TERMS_REQUIRED'); return { account_terms_version: legalVersion, account_terms_accepted: true, plan_interest: selectedPlan(plan) }; }
export const publicPaths = ['/', '/abonnemang', '/produkt', '/api', '/integritet', '/cookies', '/villkor', '/dataskydd', '/sakerhet', '/hjalp'] as const;
export const pageTitles: Record<string, string> = { '/': 'Avtal från första utkast till nästa steg', '/abonnemang': 'Välj upplägg för dina avtal', '/produkt': 'En arbetsyta för hela avtalsflödet', '/api': 'Avtal i ditt eget system', '/integritet': 'Integritetspolicy', '/cookies': 'Cookies och lokal lagring', '/villkor': 'Allmänna villkor', '/dataskydd': 'Dataskydd för företag', '/sakerhet': 'Säkerhet och tillgänglighet', '/hjalp': 'Hjälp och kontakt' };
export const storageInventory = [
    ['sb-ykddnagtuacflilbchwx-auth-token', 'Supabase / Avtalslänk', 'Inloggningssession och förnyelse av session', 'Tills utloggning eller när sessionen blir ogiltig; en stängd webbläsare rensar inte automatiskt lokal lagring.'],
    ['sb-ykddnagtuacflilbchwx-auth-token-code-verifier', 'Supabase / Avtalslänk', 'Verifiering av en inloggnings- eller återställningslänk, när flödet kräver det', 'Till slutfört flöde eller tills du rensar webbplatsdata.'],
    ['al.join', 'Avtalslänk', 'Behåller en inbjudningslänk när du verifierar ett konto i en annan flik', 'Giltig i högst sju dagar. Tas bort vid accepterad inbjudan eller nästa kontroll efter utgången giltighet.'],
] as const;
