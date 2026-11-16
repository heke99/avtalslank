import { test, expect } from '@playwright/test';
const auth = 'https://ykddnagtuacflilbchwx.supabase.co';
test('public hero, plans and legal navigation with no optional tracking or storage', async ({ page }) => {
    const external: string[] = [];
    page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname))
        external.push(u.hostname); });
    await page.goto('/');
    await expect(page.locator('#public-main')).toHaveCSS('margin-left','0px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Avtal, dokument\s*och mottagare\./);
    await expect(page.getByText('En tjänst från Trafexa Nordic AB.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Skapa ditt företagskonto' })).toHaveAttribute('href', '/signup');
    await page.getByRole('button', { name: 'Cookieinställningar', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Inte i bruk');
    await expect(page.getByRole('button', { name: 'Stäng inställningar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cookieinställningar', exact: true })).toBeFocused();
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
    expect(external).toEqual([]);
    await page.screenshot({ path: '.verification/public-home-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Jämför abonnemangen' }).click();
    await expect(page.getByRole('heading', { name: 'Välj upplägg för dina avtal' })).toBeVisible();
    await expect(page.getByText('Pris och omfattning enligt separat offert.',{exact:true})).toBeVisible();
    await page.getByRole('link', { name: 'Välj Team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Skapa konto', exact: true })).toBeVisible();
    await expect(page.getByLabel('Önskat upplägg', { exact: true })).toHaveValue('team');
});
test('signup requires terms, carries only declared plan metadata, and creates no purchase', async ({ page }) => {
    let payload: any = null;
    const commerce: string[] = [];
    page.on('request', r => { if (/checkout|payment|billing|stripe/.test(r.url()))
        commerce.push(r.url()); });
    await page.route(auth + '/auth/v1/signup**', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'new@example.invalid', identities: [] }, session: null }) }); });
    await page.goto('/signup?plan=api');
    await page.getByLabel('E-postadress', { exact: true }).fill('new@example.invalid');
    await page.getByLabel('Lösenord', { exact: true }).fill('synthetic-test-password');
    await page.getByRole('button', { name: 'Skapa konto', exact: true }).click();
    expect(payload).toBeNull();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Skapa konto', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Kontrollera din inkorg');
    expect(payload.data).toEqual({ account_terms_version: '2026-11-16.2', account_terms_accepted: true, plan_interest: 'api' });
    expect(commerce).toEqual([]);
    await page.goto('/signup?plan=owner');
    await expect(page.getByLabel('Önskat upplägg', { exact: true })).toHaveValue('');
});
test('public policies and version errors are available signed out and consistently identify the operator', async ({ page }) => {
    for (const [path, heading] of [['/integritet', 'Integritetspolicy'], ['/cookies', 'Cookies och lokal lagring'], ['/villkor', 'Allmänna villkor'], ['/dataskydd', 'Dataskydd för företag'], ['/sakerhet', 'Säkerhet och tillgänglighet'], ['/hjalp', 'Hjälp och kontakt'], ['/api', 'Avtal i ditt eget system'], ['/produkt', 'En arbetsyta för hela avtalsflödet']]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        await expect(page.getByRole('contentinfo')).toContainText('556855-4884');
    }
    await page.goto('/villkor?version=unknown');
    await expect(page.getByRole('alert')).toContainText('dokumentversionen finns inte');
    await expect(page.getByRole('heading', { name: '1. Parter och omfattning' })).toHaveCount(0);
});
test('mobile navigation, plans and policy tables stay within viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Öppna meny', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Huvudmeny' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Huvudmeny' }).getByRole('link', { name: 'Abonnemang', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Välj upplägg för dina avtal' })).toBeVisible();
    for (const path of ['/', '/abonnemang', '/integritet', '/cookies']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto('/');
    await page.screenshot({ path: '.verification/public-home-mobile.png', fullPage: true });
});
test('guided product tour supports keyboard steps without requests or pretending to send',async({page})=>{
 await page.goto('/');await expect(page.locator('.public-document')).toHaveCount(0);await page.getByRole('tab',{name:'01 Dokument',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'02 Mottagare',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tabpanel')).toContainText('Bestäm vem');await page.getByRole('button',{name:'Nästa steg',exact:true}).click();await expect(page.getByRole('tabpanel')).toContainText('Granska innan');await expect(page.getByRole('button',{name:'Nästa steg',exact:true})).toBeDisabled();await expect(page.getByText('Inget skickas eller sparas.',{exact:false})).toBeVisible();
});
test('API examples switch language and copy the selected server example',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.goto('/api');await page.getByLabel('Språk för API-exempel').selectOption('javascript');await expect(page.locator('.api-examples pre')).toContainText('process.env.AVTALSLANK_API_KEY');await page.getByRole('button',{name:'Kopiera API-exempel'}).click();await expect(page.getByRole('status')).toHaveText('Exemplet har kopierats.');expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('process.env.AVTALSLANK_API_KEY');await page.getByLabel('Språk för API-exempel').selectOption('python');await expect(page.locator('.api-examples pre')).toContainText('urllib.request');
});
test('customer pages omit build-stage wording and preserve archived policy versions',async({page})=>{
 for(const path of ['/','/produkt','/abonnemang','/api','/sakerhet','/integritet','/villkor','/dataskydd']){await page.goto(path);await expect(page.locator('body')).not.toContainText(/skarpa utskick|skarp signering|inför lansering/i);}
 await page.goto('/villkor');await expect(page.locator('.public-version')).toContainText('Version 2026-11-16.2');await expect(page.getByRole('link',{name:'Tidigare version'})).toHaveAttribute('href','/legal/2026-11-16/villkor.html');
});
test('account startup presents recovery when session refresh cannot finish',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sb-ykddnagtuacflilbchwx-auth-token',JSON.stringify({access_token:'expired-synthetic-token',refresh_token:'synthetic-refresh',token_type:'bearer',expires_at:1,user:{id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})));
 await page.route('**/auth/v1/token**',()=>new Promise(()=>{}));await page.goto('/login');await expect(page.getByRole('heading',{name:'Inloggningen kunde inte läsas in'})).toBeVisible({timeout:18000});await expect(page.getByRole('button',{name:'Försök igen',exact:true})).toBeEnabled();
});
test('email entry routes work in a fresh browser with or without a trailing slash', async ({ page }) => {
 await page.route('**/functions/v1/avtalslank-api/v1/signer/view', async route => {
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type'}});
  expect(route.request().postDataJSON().token).toBe('f'.repeat(64));
  return route.fulfill({status:401,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({error:{code:'INVALID_SIGNING_LINK'}})});
 });
 for(const path of ['/s','/s/']){
  await page.goto(path+'#token='+'f'.repeat(64));
  await expect(page.getByRole('heading',{name:'Signeringslänken kan inte öppnas',exact:true})).toBeVisible();
 }
 for(const path of ['/reset-password','/reset-password/']){
  await page.goto(path);await expect(page.getByRole('heading',{name:'Nytt lösenord',exact:true})).toBeVisible();
  await expect(page.getByText('Öppna en giltig återställningslänk från din e-post för att fortsätta.')).toBeVisible();
 }
 for(const path of ['/join','/join/']){
  await page.goto(path+'#token='+'e'.repeat(64));await expect(page.getByRole('heading',{name:'Inbjudan till Avtalslänk',exact:true})).toBeVisible();
 }
});
