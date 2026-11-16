import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { plans, selectedPlan, signupMetadata, legalVersion, publicPaths, storageInventory } from '../packages/public-site/src/index.ts';
import { PublicSite } from '../apps/web/PublicSite.tsx';
import { readFile } from 'node:fs/promises';
test('plan selection is a bounded declaration and never a billing entitlement', () => {
    for (const p of plans)
        assert.equal(selectedPlan(p.id), p.id);
    for (const p of ['owner', 'enterprise', '<script>', '', null])
        assert.equal(selectedPlan(p), null);
    assert.throws(() => signupMetadata('team', false), /TERMS_REQUIRED/);
    assert.deepEqual(signupMetadata('team', true), { account_terms_version: legalVersion, account_terms_accepted: true, plan_interest: 'team' });
    assert.deepEqual(Object.keys(signupMetadata('api', true)).sort(), ['account_terms_accepted', 'account_terms_version', 'plan_interest']);
});
test('every public page renders on server without auth, private data or invented provider readiness', () => {
    for (const path of publicPaths) {
        const html = renderToString(React.createElement(PublicSite, { path }));
        assert.ok(html.includes('<h1>'), path);
        assert.ok(html.includes('Trafexa Nordic AB'), path);
        assert.ok(html.includes('556855-4884'), path);
        assert.ok(html.includes('/integritet'), path);
        assert.ok(html.includes('/villkor'), path);
        assert.ok(!html.includes('dangerouslySetInnerHTML'));
    }
    const plansHtml = renderToString(React.createElement(PublicSite, { path: '/abonnemang' }));
    assert.ok(plansHtml.includes('Inga debiteringar'));
    assert.ok(plansHtml.includes('Inte fastställt'));
    const unknown = renderToString(React.createElement(PublicSite, { path: '/villkor', requestedVersion: 'unknown' }));
    assert.ok(unknown.includes('begärda dokumentversionen'));
    assert.ok(!unknown.includes('1. Parter och omfattning'));
});
test('public storage inventory is necessary-only and hosting preserves static policy/API assets', async () => {
    assert.equal(storageInventory.length, 3);
    const cfg = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.equal(cfg.rewrites.some((r: {
        source: string;
    }) => r.source.includes('assets')), false);
    assert.ok(cfg.rewrites.some((r: {
        source: string;
    }) => r.source === '/s/:path*'));
    assert.ok(!cfg.rewrites.some((r: {
        source: string;
    }) => r.source === '/cookies' || r.source === '/openapi.json'));
});
