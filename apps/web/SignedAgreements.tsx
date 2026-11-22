import {bounded} from './deadline';
import React,{useState} from 'react';
import {accountApi} from './AccountOperations';import {supabase,displayError} from './client';import {envelopeApi} from './SigningPreparation';
export function SignedAgreementSearch({orgId,admin=false,onOpen}:{orgId?:string;admin?:boolean;onOpen?:(id:string)=>void}){const [q,setQ]=useState(''),[rows,setRows]=useState<any[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false),[applied,setApplied]=useState('');async function search(next:string|null=null){setBusy(true);setError('');if(!next){setRows([]);setCursor(null);setSearched(false);}try{const query=next?applied:q;let r;if(admin){const x=await bounded(supabase.rpc('al_admin_search_signed',{p_query:query,p_org:orgId??null,p_cursor:next}));if(x.error)throw x.error;r=x.data;}else r=await accountApi('/v1/signed-search?query='+encodeURIComponent(query)+(next?'&cursor='+encodeURIComponent(next):'')+'&organizationId='+encodeURIComponent(orgId!),null);setRows(next?[...rows,...r.items]:r.items);setCursor(r.nextCursor);setApplied(query);setSearched(true);}catch(e){setError(displayError(e));}finally{setBusy(false);}}return <section className="panel detail-panel signed-search"><h2>Sök signerade avtal</h2><form onSubmit={e=>{e.preventDefault();search();}}><label>Namn, företag, organisationsnummer eller e-post<input value={q} maxLength={160} onChange={e=>setQ(e.target.value)}/></label><button className="primary" disabled={busy}>{busy?'Söker…':'Sök signerade avtal'}</button></form>{error&&<p role="alert">{error}</p>}{searched&&!rows.length&&<p>Inga signerade avtal matchar sökningen.</p>}{rows.map(r=><article className="list-row" key={r.id}><div className="grow"><strong>{r.title}</strong><p>{r.company} · {new Date(r.finalized_at).toLocaleString('sv-SE')}</p>{r.signers?.map((s:any,i:number)=><small key={i}>{s.name} · {s.email} · {s.company} {s.registrationNumber}</small>)}</div>{onOpen&&<button className="secondary" onClick={()=>onOpen(r.id)}>Öppna avtal</button>}</article>)}{cursor&&<button className="secondary" disabled={busy} onClick={()=>search(cursor)}>Visa fler signerade avtal</button>}</section>;}
export function DocumentTariffAdmin({orgId=null}:{orgId?:string|null}){const [state,setState]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);async function load(){const r=await bounded(supabase.rpc('al_admin_document_tariff',{p_org:orgId}));if(r.error)throw r.error;setState(r.data);}React.useEffect(()=>{load().catch(e=>setError(displayError(e)));},[orgId]);return <section className="company-commercial"><h3>{orgId?'Pris per signerad PDF':'Generellt dokumentpris på hemsidan'}</h3>{error&&<p role="alert">{error}</p>}<p>{orgId?'Bolagets eget pris ersätter det generella priset.':'Sparade ändringar visas automatiskt på hemsidans prissida och används för bolag utan eget pris.'} Pris per PDF plus tillägg för signerare utöver inkluderat antal. Sparade prisversioner ändrar inte skickade ärenden. Belopp exkl. moms.</p><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await load();}catch(e){setError(displayError(e));}finally{setBusy(false);}}}>Hämta sparat dokumentpris</button><fieldset disabled={busy||!state}><legend>Dokumentpris</legend><form key={state?.tariff?.id??orgId} onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{const ore=(v:FormDataEntryValue|null)=>{const s=String(v).replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('INVALID_PRICE');return Math.round(Number(s)*100);};const r=await bounded(supabase.rpc('al_admin_document_tariff',{p_org:orgId,p_payload:{version:state?.tariff?.version??0,documentOre:ore(f.get('base')),includedSigners:Number(f.get('included')),extraSignerOre:ore(f.get('extra')),reason:f.get('reason')}}));if(r.error)throw r.error;await load();}catch(err){setError(displayError(err));}finally{setBusy(false);}}}><label>Dokumentpris i kronor<input name="base" inputMode="decimal" required defaultValue={state?.tariff?String(state.tariff.document_ore/100):''}/></label><label>Inkluderade signerare<input name="included" type="number" required min={1} max={50} defaultValue={state?.tariff?.included_signers??1}/></label><label>Tillägg per extra signerare i kronor<input name="extra" inputMode="decimal" required defaultValue={state?.tariff?String(state.tariff.extra_signer_ore/100):''}/></label><label>Anledning<textarea name="reason" required minLength={10} maxLength={500}/></label><button className="primary" disabled={busy}>Spara dokumentpris</button></form></fieldset><h4>Registrerade dokumentkostnader</h4>{state?.charges?.map((c:any)=><p key={c.id}>{c.document_id} · {c.signers} signerare · {(c.amount_ore/100).toFixed(2)} kr · {c.status==='blocked_provider'?'Väntar på betalningsanslutning':c.status}</p>)}</section>;}
type PriceReviewProps={orgId:string;envelopeId:string;generation:number;documentIds:string[];recipientIds:string[];onAccept:(hash:string)=>void;autoLoad:boolean};
export function PriceReview(props:PriceReviewProps){
 return <VersionPriceReview key={[props.orgId,props.envelopeId,props.generation,...props.documentIds,'recipients',...props.recipientIds].join(':')} {...props}/>;
}
function VersionPriceReview({orgId,envelopeId,generation,documentIds,recipientIds,onAccept,autoLoad}:PriceReviewProps){
 const [quote,setQuote]=useState<{hash:string;documents:number;signers:number;unitOre:number;totalOre:number;complimentary?:boolean}|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=React.useRef(0);
 async function load(){
  const id=++request.current;
  setBusy(true);setError('');onAccept('');setQuote(null);
  try{
   const next=await envelopeApi(orgId,envelopeId,'quote');
   if(id!==request.current)return;
   const same=(a:string[],b:string[])=>a.length===b.length&&a.every((value,i)=>value===b[i]);
   if((next.generation!==undefined&&next.generation!==generation)||
      (Array.isArray(next.documentIds)&&!same(documentIds.toSorted(),next.documentIds))||
      (Array.isArray(next.recipientIds)&&!same(recipientIds,next.recipientIds)))throw Error('VERSION_CONFLICT');
   setQuote(next);
   if(next.complimentary===true)onAccept(next.hash);
  }catch(e){if(id===request.current)setError(displayError(e));}
  finally{if(id===request.current)setBusy(false);}
 }
 React.useEffect(()=>{
   onAccept('');
   if(autoLoad)void load();
   return ()=>{request.current++;};
 },[autoLoad]);
 if(quote?.complimentary)return <p>Signering ingår utan kostnad.</p>;
 return <section className="panel detail-panel">
  <h3>Kostnad för signering</h3>
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="secondary" disabled={busy||!autoLoad} onClick={()=>void load()}>Hämta aktuellt signeringspris</button>
  {quote&&<><p>{quote.documents} PDF · {quote.signers} signerare · {(quote.unitOre/100).toFixed(2)} kr per PDF. Totalt {(quote.totalOre/100).toFixed(2)} kr exkl. moms.</p>
  <p>Kostnaden registreras först när alla har signerat och dokumentet är färdigställt.</p>
  <label><input type="checkbox" key={quote.hash} onChange={e=>onAccept(e.target.checked?quote.hash:'')}/>Jag godkänner priset för detta utskick</label></>}
 </section>;
}
export function ComplimentarySigning({orgId}:{orgId:string}){
 const [enabled,setEnabled]=useState<boolean|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){
  const {data,error}=await bounded(supabase.rpc('al_admin_complimentary_signing',{p_org:orgId}));
  if(error)throw error;
  setEnabled(data);
 }
 React.useEffect(()=>{void load().catch(e=>setError(displayError(e)));},[orgId]);
 return <section className="company-commercial">
  <h3>Kostnadsfri signering</h3>
  {error&&<p role="alert">{error}</p>}
  {enabled===null?<button className="secondary" type="button" onClick={()=>void load().catch(e=>setError(displayError(e)))}>Hämta signeringstillgång</button>:
  <form onSubmit={async event=>{
   event.preventDefault();
   const reason=new FormData(event.currentTarget).get('reason');
   setBusy(true);setError('');
   try{
    const {data,error}=await bounded(supabase.rpc('al_admin_complimentary_signing',{p_org:orgId,p_enabled:!enabled,p_reason:reason}));
    if(error)throw error;
    setEnabled(data);
   }catch(e){setError(displayError(e));}finally{setBusy(false);}
  }}>
   <p>{enabled?'Företaget har kostnadsfri signering.':'Företagets ordinarie signeringspris gäller.'}</p>
   <label>Anledning till ändrad signeringstillgång<input name="reason" required minLength={10} maxLength={500}/></label>
   <button type="submit" className="secondary" disabled={busy}>{enabled?'Ta bort kostnadsfri signering':'Ge kostnadsfri signering'}</button>
  </form>}
 </section>;
}
export function RecipientCompany({orgId,envelopeId,recipient,onSaved}:{orgId:string;envelopeId:string;recipient:any;onSaved:()=>void}){const [error,setError]=useState(''),[busy,setBusy]=useState(false);return <details><summary>Företagsuppgifter för {recipient.name}</summary>{error&&<p role="alert">{error}</p>}<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);try{await envelopeApi(orgId,envelopeId,'party',{recipientId:recipient.id,companyName:f.get('company'),registrationNumber:String(f.get('number')??'').replace(/[- ]/g,'')});onSaved();}catch(err){setError(displayError(err));}finally{setBusy(false);}}}><label>Företagsnamn<input name="company" maxLength={120} defaultValue={recipient.company_name??''}/></label><label>Organisationsnummer<input name="number" maxLength={11} pattern="[0-9 -]*" defaultValue={recipient.registration_number??''}/></label><button className="secondary" disabled={busy}>Spara mottagarens företag</button></form></details>;}
