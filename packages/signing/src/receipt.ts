import {PDFDocument,StandardFonts} from 'pdf-lib';
function printable(v:unknown){return String(v??'Ej registrerat').replace(/[\r\n\t]/g,' ').replace(/[^\u0020-\u007e\u00a0-\u00ff]/gu,c=>'\\u{'+c.codePointAt(0)!.toString(16)+'}');}
export async function appendApprovalReceipt(bytes:Uint8Array, context:{envelopeId:string;documentId:string;originalHash:string;snapshotHash:string;recipients:any[];decisions:any[]}){
 const pdf=await PDFDocument.load(bytes),font=await pdf.embedFont(StandardFonts.Helvetica);let page=pdf.addPage([595,842]),y=800;
 const line=(v:string)=>{let rest=printable(v);while(rest.length){let end=rest.length;while(end>1&&font.widthOfTextAtSize(rest.slice(0,end),9)>535)end--;if(y<45){page=pdf.addPage([595,842]);y=800;}page.drawText(rest.slice(0,end),{x:30,y,size:9,font});y-=14;rest=rest.slice(end);}if(!v)y-=10;};
 ['Avtalslank - signeringsbilaga',`Avtals-ID: ${context.envelopeId}`,`Dokument-ID: ${context.documentId}`,`Original SHA-256: ${context.originalHash}`,`Dokumentuppsattning SHA-256: ${context.snapshotHash}`,'Metod: godkannande via e-post','Identitetsuppgifter ar sjalvdeklarerade, inte verifierade med e-legitimation.','Serverns tidpunkt ar inte en oberoende betrodd tidsstampling.',''].forEach(line);
 for(const d of context.decisions){const r=context.recipients.find(r=>r.id===d.recipientId);const ev=d.evidence;
  [`Namn: ${ev?.name??r?.name??'Ej registrerat'}`,`Personnummer: ${ev?.personalNumber??'Ej insamlat vid denna signering'}`,`E-post: ${r?.email??'Ej registrerad'}`,`Tidpunkt (UTC): ${ev?.signedAt??d.consumedAt}`,`Signeringshash (SHA-256): ${ev?.signingHash??'Ej skapad i tidigare version'}`,`IP-adress: ${ev?.ip??'Ej tillganglig'}`,`IP-kalla: ${ev?.ipSource==='forwarded_unverified'?'vidarebefordrad header, ej oberoende verifierad':'ej registrerad'}`,`Samtyckesversion: ${d.decision.consentVersion}`,''].forEach(line);
 }return pdf.save();
}
