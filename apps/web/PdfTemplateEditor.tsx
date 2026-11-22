import React, { useEffect, useState } from "react";
import { validateTemplateFields } from "../../packages/editor/src/index";
import type { TemplateField } from "../../packages/domain/src/index";
import { sha256Hex } from "../../packages/crypto/src/hash";
import { displayError, rpc, supabase } from "./client";
import { bounded } from "./deadline";
import { PdfFieldPage, fieldOverlay, fieldPosition, type PageGeometry } from "./PdfFieldPage";

export type PdfTemplate = { id: string; version: number; name: string; fields: TemplateField[]; pdf_path: string };

export function PdfTemplateEditor({orgId, template, useTemplate, onSaved, onCreate}: {
  orgId: string;
  template?: PdfTemplate;
  useTemplate: boolean;
  onSaved: () => Promise<void>;
  onCreate: (name: string, pdf: File) => Promise<void>;
}) {
  const [name,setName]=useState(template?.name??"");
  const [fields,setFields]=useState<TemplateField[]>(template?.fields??[]);
  const [source,setSource]=useState<Blob>();
  const [pageCount,setPageCount]=useState(0);
  const [page,setPage]=useState(0);
  const [geometry,setGeometry]=useState<PageGeometry>();
  const [selected,setSelected]=useState("");
  const [values,setValues]=useState<Record<string,string>>({});
  const [uploadedPath,setUploadedPath]=useState(template?.pdf_path);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(Boolean(template));
  const [busy,setBusy]=useState(false);
  const activeField=fields.find(field=>field.id===selected&&field.page===page);

  async function validatePdf(pdf: Blob) {
    if(pdf.size>10485760)throw Error("DOCUMENT_TOO_LARGE");
    const {PDFDocument}=await import("pdf-lib");
    let count:number;
    try{count=(await PDFDocument.load(await pdf.arrayBuffer())).getPageCount();}
    catch{throw Error("INVALID_PDF");}
    if(count<1||count>100)throw Error("INVALID_PDF");
    return count;
  }

  useEffect(()=>{
    if(!template)return;
    let active=true;
    async function load(){
      const {data,error}=await bounded(supabase.storage.from("al-documents").download(template!.pdf_path));
      if(error)throw error;
      const count=await validatePdf(data);
      if(active){setSource(data);setPageCount(count);}
    }
    void load().catch(e=>{if(active)setError(displayError(e));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[template?.pdf_path]);

  function changeField(id:string, patch:Partial<TemplateField>){
    setFields(current=>current.map(field=>field.id===id?{...field,...patch}:field));
  }

  async function applyTemplate(pdf: Blob){
    const {finalPdf}=await import("../../packages/signing/src/index");
    const original=new Uint8Array(await pdf.arrayBuffer());
    const documentId=crypto.randomUUID(), recipientId=crypto.randomUUID();
    const result=await finalPdf(original,await sha256Hex(original),fields.map(field=>({...field,documentId,recipientId})),values,documentId);
    const safeName=name.replace(/[^\p{L}\p{N}_.-]+/gu,"_").slice(0,110);
    await onCreate(name.trim(),new File([new Uint8Array(result.bytes)],safeName+".pdf",{type:"application/pdf"}));
  }

  async function save(pdf:Blob){
    let path=uploadedPath;
    if(!path){
      path=orgId+"/templates/"+crypto.randomUUID()+".pdf";
      const {error}=await bounded(supabase.storage.from("al-documents").upload(path,pdf,{contentType:"application/pdf",upsert:false}));
      if(error)throw error;
      setUploadedPath(path);
    }
    await rpc("al_save_pdf_template",{p_org:orgId,p_name:name.trim(),p_fields:fields,p_path:path,p_id:template?.id??null,p_version:template?.version??null});
    await onSaved();
  }

  return <form className="pdf-template-form" onSubmit={async event=>{
    event.preventDefault();
    if(!source||busy)return;
    setBusy(true);setError("");
    try{
      validateTemplateFields(fields);
      if(fields.some(field=>field.page>=pageCount))throw Error("INVALID_TEMPLATE_LAYOUT");
      if(useTemplate)await applyTemplate(source);
      else await save(source);
    }catch(e){setError(displayError(e));}
    finally{setBusy(false);}
  }}>
    <label>{useTemplate?"Avtalets namn":"Mallnamn"}<input value={name} onChange={event=>setName(event.target.value)} required minLength={2} maxLength={160}/></label>
    {!template&&<label>Mallens PDF<input type="file" accept=".pdf,application/pdf" disabled={busy||loading} onChange={async event=>{
      const file=event.target.files?.[0];
      if(!file)return;
      setError("");setLoading(true);
      try{
        const count=await validatePdf(file);
        setSource(file);setPageCount(count);setPage(0);setFields([]);setSelected("");setUploadedPath(undefined);setGeometry(undefined);
        if(!name)setName(file.name.replace(/\.pdf$/i,"").slice(0,160));
      }catch(e){setError(displayError(e));}finally{setLoading(false);}
    }}/></label>}
    {loading&&<p role="status">Öppnar mallens PDF…</p>}
    {error&&<p className="alert" role="alert">{error}</p>}
    {source&&<>
      <div className="field-preview-controls">
        <label>PDF-sida<select aria-label="Mallens PDF-sida" value={page} onChange={event=>{setGeometry(undefined);setPage(Number(event.target.value));}}>
          {Array.from({length:pageCount},(_,index)=><option key={index} value={index}>Sida {index+1}</option>)}
        </select></label>
        {!useTemplate&&<button type="button" className="secondary" disabled={busy||fields.length>=200} onClick={()=>{
          const id=crypto.randomUUID();
          setFields(current=>[...current,{id,label:"Fält "+(current.length+1),required:true,type:"text",recipientRole:"Avsändare",page,x:0.1,y:0.1,width:0.3,height:0.05}]);
          setSelected(id);
        }}>Lägg till fält</button>}
      </div>
      {!useTemplate&&<p>Välj ett fält och klicka på PDF:en för att placera det.</p>}
      <div className={"field-canvas"+(!useTemplate&&activeField?" can-place":"")} onClick={event=>{
        if(useTemplate||busy||!activeField||!geometry||!(event.target instanceof HTMLCanvasElement))return;
        const rect=event.target.getBoundingClientRect();
        changeField(activeField.id,fieldPosition(activeField,geometry,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height));
      }}>
        <PdfFieldPage source={source} page={page} onRendered={setGeometry}/>
        {geometry&&fields.filter(field=>field.page===page).map(field=>{
          const shown=useTemplate?values[field.id]||field.label:field.label;
          return useTemplate
            ? <span key={field.id} className="placed-field" style={fieldOverlay(field,geometry)}>{shown}</span>
            : <button key={field.id} type="button" className={"placed-field"+(field.id===selected?" selected":"")} style={fieldOverlay(field,geometry)} aria-pressed={field.id===selected} onClick={()=>setSelected(field.id)}>{shown}</button>;
        })}
      </div>
      {!useTemplate&&activeField&&<fieldset className="operation-form">
        <legend>Valt fält</legend>
        <label>Fältnamn<input required maxLength={120} value={activeField.label} onChange={event=>changeField(activeField.id,{label:event.target.value})}/></label>
        <label>Typ<select value={activeField.type} onChange={event=>changeField(activeField.id,{type:event.target.value as "text"|"date"})}><option value="text">Text</option><option value="date">Datum</option></select></label>
        <label>Bredd (%)<input type="number" inputMode="numeric" min={1} max={100} value={Math.round(activeField.width*100)} onChange={event=>{
          const width=Math.max(0.01,Math.min(1,Number(event.target.value)/100));
          changeField(activeField.id,{width,x:Math.min(activeField.x,Math.round((1-width)*100)/100)});
        }}/></label>
        <label className="checkbox"><input type="checkbox" checked={activeField.required} onChange={event=>changeField(activeField.id,{required:event.target.checked})}/>Obligatoriskt</label>
        <button type="button" className="secondary" onClick={()=>{setFields(current=>current.filter(field=>field.id!==selected));setSelected("");}}>Ta bort fält</button>
      </fieldset>}
      {useTemplate&&fields.map(field=><label key={field.id}>{field.label}<input type={field.type==="date"?"date":"text"} maxLength={500} required={field.required} value={values[field.id]??""} onChange={event=>setValues(current=>({...current,[field.id]:event.target.value}))}/></label>)}
    </>}
    <button className="primary" type="submit" disabled={busy||loading||!source||!fields.length}>{busy?"Sparar…":useTemplate?"Skapa avtal med ifylld PDF":"Spara PDF-mall"}</button>
  </form>;
}
