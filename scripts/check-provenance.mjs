import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../docs/reuse-manifest.json',import.meta.url),'utf8'));
for(const file of manifest.files){
 if(!/^[a-f0-9]{40}$/.test(file.commit)||!/^packages\//.test(file.destination)||file.destination.includes('..'))throw new Error('Invalid provenance entry');
 const bytes=await readFile(new URL('../'+file.destination,import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==file.destinationSha256)throw new Error(`Update adaptation record and digest for ${file.destination}`);
}
console.log(`${manifest.files.length} pinned code ports verified; no runtime donor dependency required.`);
