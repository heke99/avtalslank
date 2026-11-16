import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LegalContent } from '../apps/web/LegalContent';
import { legalVersion } from '../packages/public-site/src/index';
const html = '<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Avtalslänk – kontovillkor ' + legalVersion + '</title><style>body{max-width:850px;margin:40px auto;padding:0 20px;font:16px/1.65 Arial;color:#202727}h2{margin-top:32px}</style><p>Trafexa Nordic AB · 556855-4884 · Version ' + legalVersion + '</p>' + renderToStaticMarkup(<LegalContent path="/villkor"/>) + '</html>';
const directory = 'public/legal/' + legalVersion;
await mkdir(directory, { recursive: true });
try {
    const existing = await readFile(directory + '/villkor.html', 'utf8');
    if (existing !== html)
        throw Error('IMMUTABLE_TERMS_SNAPSHOT');
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw e;
}
await writeFile(directory + '/villkor.html', html);
await writeFile('/tmp/al-terms-snapshot.json', JSON.stringify({ version: legalVersion, html, sha256: createHash('sha256').update(html).digest('hex') }));
