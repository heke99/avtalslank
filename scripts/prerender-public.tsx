import React from 'react';
import { renderToString } from 'react-dom/server';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { PublicSite } from '../apps/web/PublicSite';
import { publicPaths, pageTitles } from '../packages/public-site/src/index';
const original = await readFile('dist/index.html', 'utf8');
const descriptions: Record<string, string> = {
    '/': 'Samla dokument, mottagare och kollegor i Avtalslänk. Förbered avtal i webbappen eller anslut ert system via API.',
    '/abonnemang': 'Jämför de planerade uppläggen Start, Team och API. Registrering startar inget betalt abonnemang.',
    '/integritet': 'Så hanterar Trafexa Nordic AB uppgifter i Avtalslänk. Ansvar, ändamål, leverantörer och dina rättigheter.',
    '/cookies': 'Nödvändig lokal lagring för konto och inbjudningar. Ingen analys- eller annonsspårning i webbappens kod.',
};
const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const siteOrigin = new URL(process.env.VITE_SITE_URL ?? 'https://www.avtalslank.se').origin;
for (const path of publicPaths) {
    const title = path === '/' ? 'Avtalslänk – avtal för företag' : pageTitles[path] + ' | Avtalslänk';
    const description = descriptions[path] ?? pageTitles[path] + '. Avtalslänk, en fristående företagstjänst från Trafexa Nordic AB.';
    const html = original.replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`).replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escape(description)}"/>`).replace('</head>', `<link rel="canonical" href="${siteOrigin + path}"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:type" content="website"/><meta property="og:url" content="${siteOrigin + path}"/></head>`).replace('<div id="root"></div>', `<div id="root">${renderToString(<PublicSite path={path}/>)}</div>`);
    const directory = path === '/' ? 'dist' : 'dist' + path;
    await mkdir(directory, { recursive: true });
    await writeFile(directory + '/index.html', html);
}
await copyFile('docs/openapi.json', 'dist/openapi.json');
await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPaths.map(path => `<url><loc>${siteOrigin + path}</loc></url>`).join('')}</urlset>`);
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /login\nDisallow: /signup\nDisallow: /join/\nDisallow: /s/\nDisallow: /reset-password\nSitemap: ${siteOrigin}/sitemap.xml\n`);
console.log(`Prerendered ${publicPaths.length} public pages; OpenAPI and sitemap generated.`);
