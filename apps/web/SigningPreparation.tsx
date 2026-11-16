import {TemplateApply} from "./TemplateApply";
import {moveField,copyField,validateEditorFields} from "../../packages/editor/src/index";
import {requestJson} from "../../packages/http/src/index";
import React, { useEffect, useState, useRef } from "react";
import { apiUrl, supabase, friendlyError,displayError } from "./client";
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
  const { data } = await supabase.auth.getSession();
  const result=await requestJson(`${apiUrl}/v1/envelopes/${id}/${operation}?organizationId=${orgId}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${data.session?.access_token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({...body as object,organizationId:orgId})})});
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
    [preview, setPreview] = useState<string | null>(null),
    [previewDoc, setPreviewDoc] = useState<Doc | null>(null),
    [page, setPage] = useState(0),[selected,setSelected]=useState(""),[saved,setSaved]=useState("[]"),[notice,setNotice]=useState("");
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
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
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const update = (id: string, values: Partial<Field>) =>
    setFields(fields.map((f) => (f.id === id ? { ...f, ...values } : f)));
  return (
    <section className="field-preparation">
      <h2>Fält i dokumenten</h2>
      <p className="muted">
        Placeringen anges i procent från sidans övre vänstra hörn. Du kan klicka
        på positionsytan eller ange exakta värden.
      </p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {!locked&&<TemplateApply orgId={orgId} documents={documents} recipients={recipients} fields={fields} disabled={busy||!loaded} onApply={(v,name,version)=>{setFields(v);setSelected(v.at(-1)?.id??'');setNotice('Fält från '+name+' (version '+version+') har lagts in. Spara dokumentfälten för att behålla dem.');}}/>}
      {notice&&<p role="status">{notice}</p>}
      {dirty&&<p className="muted">Dokumentfälten har osparade ändringar.</p>}
      <label>
        Dokument att förhandsvisa
        <select
          value={previewDoc?.id ?? ""}
          disabled={busy}
          onChange={async (e) => {
            const doc = documents.find((d) => d.id === e.target.value);
            if (!doc) return;
            setBusy(true);
            try {
              const { data, error } = await supabase.storage
                .from("al-documents")
                .download(doc.storage_path);
              if (error) throw error;
              if(!alive.current)return;setError("");setPreview(URL.createObjectURL(data));
              setPreviewDoc(doc);
              setPage(0);
            } catch {
              setError("Dokumentet kunde inte öppnas.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="">Välj kontrollerad PDF</option>
          {documents
            .filter((d) => d.status === "ready" && d.page_count)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      </label>
      {preview && previewDoc && (
        <>
          <label>
            Sida
            <select
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {Array.from({ length: previewDoc.page_count ?? 0 }, (_, i) => (
                <option key={i} value={i}>
                  Sida {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>Fält att placera<select aria-label="Fält att placera" value={selected} disabled={locked||busy} onChange={e=>setSelected(e.target.value)}><option value="">Välj ett fält</option>{fields.filter(f=>f.documentId===previewDoc.id&&f.page===page).map(f=><option key={f.id} value={f.id}>{f.label} · {recipients.find(r=>r.id===f.recipientId)?.name}</option>)}</select></label>
          <div tabIndex={locked?-1:0} role="group" aria-label="Positionsyta för valt fält" onKeyDown={event=>{if(locked||busy)return;const delta=event.shiftKey?0.05:0.01;const directions:Record<string,[number,number]>={ArrowLeft:[-delta,0],ArrowRight:[delta,0],ArrowUp:[0,-delta],ArrowDown:[0,delta]};const direction=directions[event.key],f=fields.find(f=>f.id===selected&&f.documentId===previewDoc.id&&f.page===page);if(direction&&f){event.preventDefault();update(f.id,moveField(f,...direction));}}}
            className="field-canvas"
            onClick={(e) => {
              if (locked||busy) return;
              const f = fields.find(
                (f) => f.id===selected&&f.documentId === previewDoc.id && f.page === page,
              );
              if (!f) return;
              const r = e.currentTarget.getBoundingClientRect();
              update(f.id, {
                x: Math.min(
                  1 - f.width,
                  Math.max(0, (e.clientX - r.left) / r.width),
                ),
                y: Math.min(
                  1 - f.height,
                  Math.max(0, (e.clientY - r.top) / r.height),
                ),
              });
            }}
          >
            <iframe
              title="PDF med fältplacering"
              key={preview + page}
              src={preview + "#page=" + (page + 1)}
              tabIndex={-1}
            />
            {fields
              .filter((f) => f.documentId === previewDoc.id && f.page === page)
              .map((f) => (
                <span
                  className={"placed-field"+(selected===f.id?" selected":"")}
                  key={f.id}
                  style={{
                    left: f.x * 100 + "%",
                    top: f.y * 100 + "%",
                    width: f.width * 100 + "%",
                    height: f.height * 100 + "%",
                  }}
                >
                  {f.label}
                </span>
              ))}
          </div>
          <p className="muted">Välj fältet som ska flyttas. Använd piltangenterna för 1 procentenhet eller Skift + pil för 5.
            Positionsytan visar ungefärlig placering. Procentvärdena nedan styr
            den sparade placeringen.
          </p>
        </>
      )}
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
                    .filter((d) => d.page_count)
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
            className="secondary"
            disabled={
              fields.length >= 200 ||
              !documents.some((d) => d.page_count) ||
              !recipients.length
            }
            onClick={() => {
              const doc = previewDoc ?? documents.find((d) => d.page_count);
              if (!doc){setPreview(null);setPreviewDoc(null);return;}
              setFields([
                ...fields,
                {
                  id: crypto.randomUUID(),
                  documentId: doc.id,
                  recipientId: recipients[0].id,
                  label: "Nytt fält",
                  type: "text",
                  required: true,
                  page: previewDoc ? page : 0,
                  x: 0.1,
                  y: 0.1,
                  width: 0.4,
                  height: 0.05,
                },
              ]);
            }}
          >
            Lägg till dokumentfält
          </button>
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
  status,
}: {
  orgId: string;
  envelopeId: string;
  status: string;
}) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setItems(await envelopeApi(orgId, envelopeId, "deliveries"));
    } catch (e) {
      setError(displayError(e));
    }
  }
  useEffect(() => {
    void load();
  }, [orgId, envelopeId]);
  return (
    <section className="operation-form">
      <h2>Leveranser och slutdokument</h2>
      {error && <p role="alert">{error}</p>}
      <button className="secondary" onClick={load}>
        Uppdatera leveransstatus
      </button>
      {items.length === 0 ? (
        <p>Inga utskick registrerade.</p>
      ) : (
        items.map((i) => (
          <div className="list-row" key={i.id}>
            <span className="grow">
              {{
                invitation: "Signeringsinbjudan",
                finalize: "Slutdokument",
                webhook: "Webhook",
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
          </div>
        ))
      )}
      {status === "completed" && (
        <button
          className="secondary"
          onClick={async () => {
            const { data } = await supabase.auth.getSession();
            const r = await fetch(
              `${apiUrl}/v1/envelopes/${envelopeId}/final?organizationId=${orgId}`,
              {
                headers: {
                  authorization: `Bearer ${data.session?.access_token}`,
                },
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
          }}
        >
          Hämta dokument och bevispaket
        </button>
      )}
    </section>
  );
}
