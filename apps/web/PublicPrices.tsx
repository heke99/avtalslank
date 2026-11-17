import React,{useEffect,useState} from 'react';

export default function PublicPrices(){
 const [prices,setPrices]=useState<any[]>([]),[document,setDocument]=useState<any>(null);
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{
   let active=true, version=0;
   const refresh=async()=>{
     const attempt=++version;
     try{
       const {supabase}=await import('./client');
       const [d,p]=await Promise.all([supabase.rpc('al_public_document_price'),supabase.rpc('al_public_prices')]);
       if(!active||attempt!==version)return;
       if(!d.error)setDocument(d.data);
       if(!p.error&&Array.isArray(p.data))setPrices(p.data);
       setStatus(d.error||p.error?'error':'ready');
     }catch{if(active&&attempt===version)setStatus('error');}
   };
   void refresh();
   const timer=setInterval(refresh,15000);
   window.addEventListener('focus',refresh);
   return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[]);
 const money=(n:number)=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(n/100);
 return <section className="public-section"><h2>Priser</h2>
   {status==='loading'&&<p role="status">Hämtar aktuella priser…</p>}
   {status==='error'&&<p role="status">Alla priser kunde inte hämtas just nu.</p>}
   {status==='ready'&&!document&&!prices.length&&<p>Kontakta oss för en offert.</p>}
   {document&&<article><h3>Per signerat dokument</h3><p><strong>{money(document.documentOre)}</strong> per PDF med {document.includedSigners} signerare inkluderade. Därefter {money(document.extraSignerOre)} per extra signerare.</p><p>Kostnaden registreras när alla har signerat och dokumentet är färdigställt.</p></article>}
   {(document||prices.length>0)&&<p>Priser i SEK exklusive moms. Beställning och betalning sker separat från kontoregistreringen.</p>}
   {prices.length>0&&<div className="public-table"><table><thead><tr><th>Paket</th><th>Fast pris</th><th>Dokumentpris</th><th>Villkor</th></tr></thead><tbody>{prices.map(p=><tr key={p.code}><th>{p.terms.name}<small style={{display:'block'}}>{p.terms.description}</small></th><td>{money(p.terms.baseOre)} / {p.terms.interval==='year'?'år':'månad'}</td><td>{money(p.terms.documentOre)} / dokument · {p.terms.includedSigners??1} signerare ingår · {money(p.terms.extraSignerOre??0)} / extra signerare</td><td>{p.terms.includedDocuments} inkluderade dokument · bindning {p.terms.bindingMonths} mån · uppsägning {p.terms.noticeMonths} mån</td></tr>)}</tbody></table></div>}
 </section>;
}
