import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

const require = createRequire(import.meta.url);
const fontPackages = ['@fontsource/noto-sans', '@fontsource/noto-sans-sc'];
let catalog: Promise<{ file: string; ranges: [number, number][] }[]> | undefined;

function fontCatalog() {
  return catalog ??= Promise.all(fontPackages.map(async (name) => {
    const cssPath = require.resolve(name + '/400.css');
    const css = await readFile(cssPath, 'utf8');
    return [...css.matchAll(/url\(\.\/([^)]*?\.woff)\)[^;]*;\s*unicode-range:\s*([^;]+)/gi)].map(([, path, raw]) => ({
      file: join(dirname(cssPath), path),
      ranges: raw.split(',').map(range => {
        const [from, to = from] = range.trim().replace(/^U\+/i, '').split('-');
        return [parseInt(from, 16), parseInt(to, 16)] as [number, number];
      })
    }));
  })).then(groups => groups.flat());
}

export async function appendApprovalReceipt(bytes:Uint8Array, context:{envelopeId:string;documentId:string;originalHash:string;snapshotHash:string;recipients:any[];decisions:any[]}) {
  const pdf=await PDFDocument.load(bytes);
  pdf.registerFontkit(fontkit);
  const standard=await pdf.embedFont(StandardFonts.Helvetica);
  const standardCharacters=new Set(standard.getCharacterSet());
  const embedded=new Map<string,{font:PDFFont;characters:Set<number>}>();
  let page=pdf.addPage([595,842]),y=800;

  async function select(character: string): Promise<{ font: PDFFont; text: string }> {
    const code=character.codePointAt(0)!;
    if(standardCharacters.has(code))return {font:standard,text:character};
    for(const entry of await fontCatalog()){
      if(!entry.ranges.some(([from,to])=>code>=from&&code<=to))continue;
      let candidate=embedded.get(entry.file);
      if(!candidate){
        const font=await pdf.embedFont(await readFile(entry.file),{subset:true});
        candidate={font,characters:new Set(font.getCharacterSet())};
        embedded.set(entry.file,candidate);
      }
      if(candidate.characters.has(code))return {font:candidate.font,text:character};
    }
    return {font:standard,text:'\\u{'+code.toString(16)+'}'};
  }

  async function line(value: string) {
    if(!value){y-=10;return;}
    let runs:{font:PDFFont;text:string}[]=[];
    let width=0;
    function write(){
      if(y<45){page=pdf.addPage([595,842]);y=800;}
      let x=30;
      for(const run of runs){
        page.drawText(run.text,{x,y,size:9,font:run.font});
        x+=run.font.widthOfTextAtSize(run.text,9);
      }
      y-=14;runs=[];width=0;
    }
    for(const character of value.replace(/[\r\n\t]/g,' ')){
      const run=await select(character);
      const length=run.font.widthOfTextAtSize(run.text,9);
      if(width+length>535)write();
      const previous=runs.at(-1);
      if(previous?.font===run.font)previous.text+=run.text;else runs.push(run);
      width+=length;
    }
    if(runs.length)write();
  }
  for(const row of ['Avtalslänk – signeringsbilaga',`Avtals-ID: ${context.envelopeId}`,`Dokument-ID: ${context.documentId}`,`Original SHA-256: ${context.originalHash}`,`Dokumentuppsättning SHA-256: ${context.snapshotHash}`,'Metod: godkännande via e-post','Identitetsuppgifterna är självdeklarerade.','Tidpunkten har registrerats av Avtalslänks server.',''])await line(row);
  for(const d of context.decisions){
    const r=context.recipients.find(r=>r.id===d.recipientId),ev=d.evidence;
    for(const row of [
      `Namn: ${ev?.name??r?.name??'Ej registrerat'}`,`Personnummer: ${ev?.personalNumber??'Ej insamlat vid denna signering'}`,
      `E-post: ${r?.email??'Ej registrerad'}`,`Tidpunkt (UTC): ${ev?.signedAt??d.consumedAt}`,
      `Signeringshash (SHA-256): ${ev?.signingHash??'Ej skapad i tidigare version'}`,`IP-adress: ${ev?.ip??'Ej tillgänglig'}`,
      `IP-källa: ${ev?.ipSource==='forwarded_unverified'?'vidarebefordrad header, ej oberoende verifierad':'ej registrerad'}`,
      `Samtyckesversion: ${d.decision.consentVersion}`,''
    ])await line(row);
  }
  return pdf.save();
}
