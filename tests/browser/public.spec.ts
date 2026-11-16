import { test, expect } from '@playwright/test';
const auth = 'https://ykddnagtuacflilbchwx.supabase.co';
test('public hero, plans and legal navigation with no optional tracking or storage', async ({ page }) => {
    const external: string[] = [];
    page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname))
        external.push(u.hostname); });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mindre administration.Mer avtalat.');
    await expect(page.getByText('Konton och utkast är öppna.', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Inte fastställt. Inga köp eller debiteringar är öppna.')).toBeVisible();
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
    expect(payload.data).toEqual({ account_terms_version: '2026-11-16', account_terms_accepted: true, plan_interest: 'api' });
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
