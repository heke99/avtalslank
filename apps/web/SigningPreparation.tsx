import { PdfFieldPage, fieldOverlay, fieldPosition, type PageGeometry } from "./PdfFieldPage";
import {currentSession} from "./session";
import {TemplateApply} from "./TemplateApply";
import {copyField,validateEditorFields} from "../../packages/editor/src/index";
import {requestJson} from "../../packages/http/src/index";
import React, { useEffect, useState, useRef } from "react";
import { apiUrl,displayError } from "./client";
type Doc = {
  id: string;
  name: string;
  page_count: number | null;
  storage_path: string;
  status: string;
};
type Recipient = { id: string; name: string };
type Field = {
  id: string;
  documentId: string;
  recipientId: string;
  label: string;
  type: "text" | "date";
  required: boolean;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export async function envelopeApi(
  orgId: string,
  id: string,
  operation: string,
  body?: unknown,
) {
  const session=await currentSession();
  const result=await requestJson(`${apiUrl}/v1/envelopes/${id}/${operation}?organizationId=${orgId}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({...body as object,organizationId:orgId})})});
  return result.data;
}
export function SigningPreparation({
  orgId,
  envelopeId,
  generation,
  locked,
  documents,
  recipients,
  onSaved,onDirty,
}: {
  orgId: string;
  envelopeId: string;
  generation: number;
  locked: boolean;
  documents: Doc[];
  recipients: Recipient[];
  onSaved: (e: any) => void;onDirty:(dirty:boolean)=>void;
}) {
  const [fields, setFields] = useState<Field[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [previewId, setPreviewId] = useState(""),
    [geometry, setGeometry] = useState<PageGeometry>(),
    [page, setPage] = useState(0),[selected,setSelected]=useState(""),[saved,setSaved]=useState("[]"),[notice,setNotice]=useState("");
  const readyDocuments = documents.filter(doc => doc.status === "ready" && doc.page_count);
  const previewDoc = readyDocuments.find(doc => doc.id === previewId) ?? readyDocuments[0];
  const pageFields = fields.filter(field => field.documentId === previewDoc?.id && field.page === page);
  const activeField = pageFields.find(field => field.id === selected);
  const canPlace = Boolean(activeField && geometry && !locked && !busy);
  useEffect(() => { setGeometry(undefined); setPage(0); }, [previewDoc?.id]);
  const dirty=loaded&&JSON.stringify(fields)!==saved;
  useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
  useEffect(()=>{const leave=(ev:BeforeUnloadEvent)=>{if(dirty){ev.preventDefault();ev.returnValue="";}};window.addEventListener("beforeunload",leave);return()=>window.removeEventListener("beforeunload",leave);},[dirty]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    envelopeApi(orgId, envelopeId, "prepare")
      .then((s) => {
        if (active) {
          setFields(s.envelope.fields ?? []);setSaved(JSON.stringify(s.envelope.fields??[]));
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(displayError(e));
      });
    return () => {
      active = false;
    };
  }, [orgId, envelopeId]);
  const update = (id: string, values: Partial<Field>) =>
    setFields(current => current.map(f => f.id === id ? { ...f, ...values } : f));
  function addField() {
    if (!previewDoc || !recipients.length) return;
    const id = crypto.randomUUID();
    setFields(current => [...current, {
      id, documentId: previewDoc.id, recipientId: recipients[0].id,
      label: "Nytt fält", type: "text", required: true, page,
      x: 0.1, y: 0.1, width: 0.4, height: 0.05,
    }]);
    setSelected(id);
    setNotice("Klicka på PDF-sidan där fältet ska placeras.");
  }
  return (
    <section className="field-preparation">
      <h2>Fält i dokumenten</h2>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {!locked&&<TemplateApply orgId={orgId} documents={documents} recipients={recipients} fields={fields} disabled={busy||!loaded} onApply={(v,name,version)=>{setFields(v);setSelected(v.at(-1)?.id??'');setNotice('Fält från '+name+' (version '+version+') har lagts in. Spara dokumentfälten för att behålla dem.');}}/>}
      {notice&&<p role="status">{notice}</p>}
      {dirty&&<p className="muted">Dokumentfälten har osparade ändringar.</p>}
      {readyDocuments.length === 0 && <p>Ladda upp en PDF i dokumentsteget. Fält kan läggas till när kontrollen är klar.</p>}
      {!locked && recipients.length === 0 && <p>Lägg till minst en mottagare för att skapa ett fält.</p>}
      {previewDoc && <>
        <div className="field-preview-controls">
          <label>Dokument att förhandsvisa
            <select value={previewDoc.id} disabled={busy} onChange={e => { if (e.target.value !== previewDoc.id) { setGeometry(undefined); setPage(0); setPreviewId(e.target.value); } }}>
              {readyDocuments.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
            </select>
          </label>
          <label>PDF-sida
            <select value={page} onChange={e => { if (Number(e.target.value) !== page) { setGeometry(undefined); setPage(Number(e.target.value)); } }}>
              {Array.from({ length: previewDoc.page_count ?? 0 }, (_, i) => <option key={i} value={i}>Sida {i + 1}</option>)}
            </select>
          </label>
        </div>
        {!locked && <div className="field-preview-controls">
          <button className="secondary" type="button" disabled={busy || !loaded || fields.length >= 200 || !recipients.length} onClick={addField}>
            Lägg till dokumentfält
          </button>
          <label>Fält att placera
            <select value={activeField?.id ?? ""} disabled={busy || !pageFields.length} onChange={e => setSelected(e.target.value)}>
              <option value="">Välj ett fält</option>
              {pageFields.map(f => <option key={f.id} value={f.id}>{f.label} · {recipients.find(r => r.id === f.recipientId)?.name}</option>)}
            </select>
          </label>
        </div>}
        <div className={canPlace ? "field-canvas can-place" : "field-canvas"}
          tabIndex={locked ? -1 : 0} role="group" aria-label="Positionsyta för valt fält"
          onKeyDown={event => {
            if (!canPlace || !activeField || !geometry || event.target !== event.currentTarget) return;
            const delta = event.shiftKey ? 0.05 : 0.01;
            const directions: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            const overlay = fieldOverlay(activeField, geometry);
            update(activeField.id, fieldPosition(activeField, geometry, parseFloat(overlay.left) / 100 + direction[0], parseFloat(overlay.top) / 100 + direction[1]));
          }}
          onClick={event => {
            if (!canPlace || !activeField || !geometry || !(event.target instanceof HTMLCanvasElement)) return;
            const rect = event.target.getBoundingClientRect();
            update(activeField.id, fieldPosition(activeField, geometry, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height));
          }}
        >
          <PdfFieldPage key={previewDoc.id} path={previewDoc.storage_path} page={page} onRendered={setGeometry} />
          {geometry && pageFields.map(f => (
            <button key={f.id} type="button" disabled={locked || busy} aria-pressed={selected === f.id}
              className={"placed-field" + (selected === f.id ? " selected" : "")}
              style={fieldOverlay(f, geometry)} onClick={event => { event.stopPropagation(); setSelected(f.id); }}>
              {f.label}
            </button>
          ))}
        </div>
        {!locked && <p className="muted">Välj ett fält och klicka där det ska ligga på PDF-sidan. Du kan även flytta fältet med piltangenterna.</p>}
      </>}
      <fieldset disabled={locked || busy || !loaded} className="signer-fields">
        {fields.map((f) => (
          <div className="operation-form" key={f.id}>
            <div className="two-columns">
              <label>
                Etikett
                <input
                  value={f.label}
                  maxLength={120}
                  onChange={(e) => update(f.id, { label: e.target.value })}
                />
              </label>
              <label>
                Mottagare
                <select
                  value={f.recipientId}
                  onChange={(e) =>
                    update(f.id, { recipientId: e.target.value })
                  }
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dokument
                <select
                  value={f.documentId}
                  onChange={(e) =>
                    update(f.id, { documentId: e.target.value, page: 0 })
                  }
                >
                  {documents
                    .filter((d) => d.status === "ready" && d.page_count)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Typ
                <select
                  value={f.type}
                  onChange={(e) =>
                    update(f.id, { type: e.target.value as "text" | "date" })
                  }
                >
                  <option value="text">Text</option>
                  <option value="date">Datum</option>
                </select>
              </label>
              <label>
                Sida
                <input
                  type="number"
                  min={1}
                  max={
                    documents.find((d) => d.id === f.documentId)?.page_count ??
                    1
                  }
                  value={f.page + 1}
                  onChange={(e) =>
                    update(f.id, { page: Number(e.target.value) - 1 })
                  }
                />
              </label>
              {(["x", "y", "width", "height"] as const).map((k) => (
                <label key={k}>
                  {
                    {
                      x: "Från vänster (%)",
                      y: "Från toppen (%)",
                      width: "Bredd (%)",
                      height: "Höjd (%)",
                    }[k]
                  }
                  <input
                    type="number"
                    min={k === "width" || k === "height" ? 1 : 0}
                    max={100}
                    step={1}
                    value={Math.round(f[k] * 100)}
                    onChange={(e) =>
                      update(f.id, { [k]: Number(e.target.value) / 100 })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) => update(f.id, { required: e.target.checked })}
              />
              Obligatoriskt
            </label>
            <button
              className="secondary"
              onClick={() => setFields(fields.filter((x) => x.id !== f.id))}
            >
              Ta bort fält
            </button>
            <button type="button" className="secondary" disabled={fields.length>=200} onClick={()=>{const copied=copyField(f);setFields([...fields,copied]);setSelected(copied.id);}}>Kopiera dokumentfält</button>
          </div>
        ))}
        <div className="operation-tools">
          <button
            className="primary"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                validateEditorFields(fields,documents,recipients);
                const e = await envelopeApi(orgId, envelopeId, "fields", {
                  generation,
                  fields,
                });
                setFields(e.fields??fields);setSaved(JSON.stringify(e.fields??fields));setNotice("Dokumentfälten är sparade.");onSaved(e);
              } catch (e) {
                setError(displayError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Spara dokumentfält
          </button>
        </div>
      </fieldset>
    </section>
  );
}
export function DeliveryHistory({
  orgId,
  envelopeId,
  status,onRefresh,
}: {
  orgId: string;
  envelopeId: string;
  status: string;
  onRefresh:()=>Promise<void>;
}) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState("");
  const version=useRef(0);
  const [busy,setBusy]=useState(false),[downloading,setDownloading]=useState(false),[loaded,setLoaded]=useState(false);
  async function load() {
    setBusy(true);setError("");const attempt=++version.current;
    try {const data=await envelopeApi(orgId,envelopeId,"deliveries");if(attempt===version.current){setItems(data);setLoaded(true);}}
    catch(e){if(attempt===version.current)setError(displayError(e));}
    finally{if(attempt===version.current)setBusy(false);}
  }
  useEffect(()=>{void load();return()=>{version.current++;};},[orgId,envelopeId]);
  async function recover(item:any,outcome:"retry"|"accepted"){
    let reference:string|null=null;
    if(item.status==="reconcile"){
      reference=window.prompt(outcome==="retry"?"Kontrollera först att leverantören inte tog emot mejlet. Ange referensen för den kontrollen.":"Ange leverantörens bekräftade leveransreferens.");
      if(!reference?.trim())return;
    }else if(!window.confirm("Starta om den misslyckade mejlleveransen?"))return;
    setBusy(true);
    try{await envelopeApi(orgId,envelopeId,"recover-email",{jobId:item.id,outcome,reference});await load();}
    catch(e){setError(displayError(e));}finally{setBusy(false);}
  }
  return (
    <section className="operation-form">
      <h2>Leveranser och slutdokument</h2>
      {error && <p role="alert">{error}</p>}
      <button className="secondary" disabled={busy} onClick={async()=>{await load();try{await onRefresh();}catch(e){setError(displayError(e));}}}>
        Uppdatera leveransstatus
      </button>
      {items.length === 0 ? (
        <p>{loaded&&!error?"Inga utskick registrerade.":busy?"Hämtar leveransstatus…":"Leveransstatus har inte hämtats."}</p>
      ) : (
        items.map((i) => (
          <div className="list-row" key={i.id}>
            <span className="grow">
              {{
                invitation: "Signeringsinbjudan",
                finalize: "Slutdokument",
                webhook: "Webhook",
                completion: "Slutmejl",
              }[i.kind as "invitation"] ?? i.kind}
            </span>
            <span>
              {{
                pending: "I kö",
                running: "Bearbetas",
                accepted: "Mottaget av e-postleverantören",
                completed: "Klart",
                failed: "Misslyckat",
                reconcile: "Behöver avstämmas",
                cancelled: "Avbrutet",
              }[i.status as "pending"] ?? i.status}
            </span>
            {i.canRecover&&i.kind==="finalize"&&i.status==="failed"&&<button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await envelopeApi(orgId,envelopeId,"retry-finalize",{});await load();}catch(e){setError(displayError(e));}finally{setBusy(false);}}}>Starta om slutdokument</button>}
            {i.canRecover&&["invitation","completion"].includes(i.kind)&&["reconcile","failed"].includes(i.status)&&<div>
              {i.status==="reconcile"&&<button className="secondary" disabled={busy} onClick={()=>recover(i,"accepted")}>Registrera bekräftad leverans</button>}
              <button className="secondary" disabled={busy} onClick={()=>recover(i,"retry")}>{i.status==="reconcile"?"Köa igen efter leveranskontroll":"Köa misslyckad leverans igen"}</button>
            </div>}
          </div>
        ))
      )}
      {status === "completed" && (
        <button
          className="secondary"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);setError("");const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);try{
            const session=await currentSession();
            const r = await fetch(
              `${apiUrl}/v1/envelopes/${envelopeId}/final?organizationId=${orgId}`,
              {
                headers: {
                  authorization: `Bearer ${session.access_token}`,
                },
                signal:controller.signal,
              },
            );
            if (!r.ok) {
              setError("Slutpaketet kunde inte hämtas.");
              return;
            }
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = url;
            a.download = "avtalslank-bevispaket.zip";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            }catch(e){setError(displayError(controller.signal.aborted?Error("REQUEST_TIMEOUT"):e));}finally{clearTimeout(timer);setDownloading(false);}
          }}
        >
          Hämta dokument och bevispaket
        </button>
      )}
    </section>
  );
}
