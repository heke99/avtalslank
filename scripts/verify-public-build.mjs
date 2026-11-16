import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const paths=['/','/abonnemang','/produkt','/api','/integritet','/cookies','/villkor','/dataskydd','/sakerhet','/hjalp'];
for(const path of paths){const html=await readFile(path==='/'?'dist/index.html':`dist${path}/index.html`,'utf8');assert.ok(html.includes('<h1>'),path);assert.ok(html.includes('Trafexa Nordic AB'),path);assert.ok(html.includes('rel="canonical"'),path);assert.ok(html.includes('property="og:title"'),path);assert.ok(!/gtag\(|googletagmanager|connect.facebook|hotjar|segment.io/.test(html),path);}
const api=JSON.parse(await readFile('dist/openapi.json','utf8'));assert.equal(api.openapi,'3.1.0');assert.ok(api.paths['/v1/envelopes']);
const sitemap=await readFile('dist/sitemap.xml','utf8');assert.equal((sitemap.match(/<url>/g)??[]).length,paths.length);assert.ok(!sitemap.includes('/s/'));
console.log('Public build: 10 prerendered pages, metadata, tracker-free markup, actual OpenAPI and sitemap verified.');
