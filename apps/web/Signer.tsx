import {signingDecisionFits} from "../../packages/signing/src/decision";
import { normalizePersonalNumber } from "../../packages/signing/src/identity";
import React, { useEffect, useRef, useState } from "react";
import { apiUrl, friendlyError } from "./client";
import { sha256Hex } from "../../packages/crypto/src/hash.ts";
type Field = {
  id: string;
  label: string;
  type: "text" | "date";
  required: boolean;
  page: number;
  documentId: string;
};
type SignerData = {
  title: string;
  message: string;
  status: string;
  snapshotHash: string;
  expiresAt: string;
  waiting: boolean;
  recipient: { id: string; name: string; method: string; status: string };
  fields: Field[];
  documents: Array<{ id: string; name: string; sha256: string }>;
};
export default function Signer() {
  const token = useRef(
    new URLSearchParams(location.hash.slice(1)).get("token") ??
      location.pathname.split("/s/")[1]?.split("/")[0] ??
      "",
  ).current;
  const [data, setData] = useState<SignerData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [consent, setConsent] = useState(false),
    [reason, setReason] = useState(""),
    [declining, setDeclining] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [seen, setSeen] = useState<string[]>([]),
    [done, setDone] = useState("");
  const [signedName,setSignedName]=useState(""),[personalNumber,setPersonalNumber]=useState("");
  const decision = useRef<unknown>(null);
  async function request(action: string, body: Record<string, unknown> = {}) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
    const incoming = await fetch(apiUrl + "/v1/signer/" + action, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    });
    // Keep the deadline active through the response body, including PDF downloads.
    const response=new Response(await incoming.arrayBuffer(),{status:incoming.status,statusText:incoming.statusText,headers:incoming.headers});
    if (!response.ok) {
      const e = await response.json();
      throw Object.assign(Error(e.error?.code ?? "REQUEST_FAILED"), {
        httpStatus: response.status,
      });
    }
    return response;
    }catch(e){if(controller.signal.aborted)throw Error("REQUEST_TIMEOUT");throw e;}finally{clearTimeout(timer);}
  }
  const showError = (e: unknown) => {
    const code = (e as Error).message;
    setError(
      (
        {
          INVALID_SIGNING_LINK:
            "Länken är ogiltig, återkallad eller har gått ut.",
          LINK_ALREADY_USED: "Länken har redan använts.",
          DOCUMENT_SET_CHANGED: "Avtalet har ändrats. Öppna länken på nytt.",
          WAITING_FOR_PREVIOUS_RECIPIENT:
            "En tidigare mottagare behöver signera först.",
          INVALID_DECISION:
            "Kontrollera uppgifterna och bekräfta ditt godkännande.",
        } as Record<string, string>
      )[code] ?? friendlyError(code),
    );
  };
  useEffect(() => {
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError("Signeringslänken kan inte öppnas");
      setLoading(false);
      return;
    }
    request("view")
      .then((r) => r.json())
      .then((r) => {
        if (active) {setData(r.data);setSignedName(r.data.recipient.name??"");}
      })
      .catch((e) => {
        if (active) showError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(()=>{
    if(!data || data.recipient.status!=="signed" || !["sent","in_progress","finalizing"].includes(data.status))return;
    let active=true,inFlight=false;const timer=setInterval(()=>{if(inFlight)return;inFlight=true;request("view").then(r=>r.json()).then(r=>{if(active){setData(r.data);setError('');}}).catch(e=>{if(active)showError(e);}).finally(()=>{inFlight=false;});},5000);
    return ()=>{active=false;clearInterval(timer);};
  },[data?.status,data?.recipient.status]);
  async function openDocument(doc: SignerData["documents"][number]) {
    setBusy(true);
    setError("");
    try {
      const r = await request("document", { documentId: doc.id });
      const bytes = new Uint8Array(await r.arrayBuffer());
      if ((await sha256Hex(bytes)) !== doc.sha256)
        throw Error("ORIGINAL_CHANGED");
      setPreview(
        URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
      );
      setSeen((s) => (s.includes(doc.id) ? s : [...s, doc.id]));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function decide(intent: "approve" | "decline") {
    if (!data) return;
    setBusy(true);
    setError("");
    // Freeze the first submitted decision for exact retry after an unknown response.
    if (!decision.current && intent === "approve") {
      try {normalizePersonalNumber(personalNumber);if(signedName.trim().length<2)throw Error("INVALID_SIGNER_IDENTITY");}
      catch {setError("Ange fullständigt namn och ett giltigt personnummer med tolv siffror (ÅÅÅÅMMDDNNNN).");setBusy(false);return;}
    }
    if (!decision.current)
      decision.current = {
        intent,
        documentSetHash: data.snapshotHash,
        consentVersion: "email-approval-v1",
        consent: !!consent,
        values: intent === "approve" ? values : {},
        ...(intent === "approve" ? {identity:{name:signedName.trim(),personalNumber:normalizePersonalNumber(personalNumber)}} : {}),
        ...(intent === "decline" ? { reason } : {}),
      };
    if(!signingDecisionFits(decision.current)){
      decision.current=null;setBusy(false);
      setError(friendlyError("DECISION_TOO_LARGE"));return;
    }
    try {
      const response = await request("decide", { decision: decision.current });
      const r = await response.json();
      setData({...data,recipient:{...data.recipient,status:r.data.status},status:r.data.envelopeStatus??data.status});
      setDone(
        r.data.status === "signed"
          ? "Ditt godkännande är registrerat."
          : "Du har nekat avtalet.",
      );
    } catch (e) {
      if (
        (e as { httpStatus?: number }).httpStatus &&
        (e as { httpStatus: number }).httpStatus < 500
      )
        decision.current = null;
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function downloadFinal(documentId: string) {
    setBusy(true);
    try {
      const r = await request(documentId === "evidence" ? "evidence" : "final", { documentId });
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = documentId === "evidence" ? "bevisarkiv.zip" : "signerat-avtal.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signer-page">
      <header>
        <a className="signer-brand" href="/">
          Avtalslänk
        </a>
        <span>Dokumentsignering</span>
      </header>
      {loading ? (
        <p role="status">Öppnar avtal…</p>
      ) : (
        <>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {!data ? (
            <section className="panel signer-panel">
              <h1>Signeringslänken kan inte öppnas</h1>
              <p>
                Försök öppna sidan igen. Kontakta avsändaren om länken fortfarande inte fungerar.
              </p>
              <button className="secondary" onClick={()=>location.reload()}>Öppna länken igen</button>
            </section>
          ) : (
            <section className="panel signer-panel">
              <h1>{data.title}</h1>
              <p className="muted">
                Till {data.recipient.name} · Gäller till{" "}
                {new Date(data.expiresAt).toLocaleString("sv-SE", {
                  timeZone: "Europe/Stockholm",
                })}
              </p>
              {data.status === "completed" &&
                data.recipient.status === "signed" && (
                  <div className="operation-tools">
                    <h2>Avtalet är färdigt</h2><p>Hämta slutdokumentet eller bevisarkivet. En bekräftelse skickas också via e-post.</p>
                    <button className="secondary" disabled={busy} onClick={()=>downloadFinal("evidence")}>Hämta bevisarkiv</button>
                    {data.documents.map((doc) => (
                      <button
                        className="secondary"
                        disabled={busy}
                        key={doc.id}
                        onClick={() => downloadFinal(doc.id)}
                      >
                        Hämta signerat {doc.name}
                      </button>
                    ))}
                  </div>
                )}
              {data.message && (
                <p style={{ whiteSpace: "pre-wrap" }}>{data.message}</p>
              )}
              {done ? (
                <div role="status">
                  <h2>{done}</h2>
                  <p>{data.status === "completed" ? "Slutdokumentet är klart att hämta ovan." : "Vi inväntar övriga mottagare eller framställer slutdokumentet. Sidan uppdateras automatiskt."}</p>
                </div>
              ) : data.recipient.status !== "pending" ? (
                <p role="status">
                  Du har redan besvarat avtalet. Status:{" "}
                  {data.recipient.status === "signed" ? "Godkänt" : "Nekat"}.
                </p>
              ) : data.waiting ? (
                <p role="status">
                  Väntar på att en tidigare mottagare ska signera.
                </p>
              ) : (
                <>
                  <h2>1. Läs dokumenten</h2>
                  {data.documents.map((doc) => (
                    <div className="list-row" key={doc.id}>
                      <span className="grow">
                        <strong>{doc.name}</strong>
                        <small>
                          {seen.includes(doc.id) ? "Öppnat" : "Ej öppnat"}
                        </small>
                      </span>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => openDocument(doc)}
                      >
                        Öppna dokument
                      </button>
                    </div>
                  ))}
                  {preview && (
                    <div className="pdf-preview">
                      <iframe title="Dokument för signering" src={preview} />
                      <a href={preview} download="document.pdf">
                        Hämta dokumentet
                      </a>
                    </div>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide("approve");
                    }}
                  >
                    <h2>2. Kontrollera och godkänn</h2>
                    <fieldset
                      disabled={busy || Boolean(decision.current)}
                      className="signer-fields"
                    >
                      <label>Fullständigt namn *<input autoComplete="name" required maxLength={120} value={signedName} onChange={e=>setSignedName(e.target.value)}/></label>
                      <label>Personnummer (ÅÅÅÅMMDDNNNN) *<input inputMode="numeric" required maxLength={13} value={personalNumber} onChange={e=>setPersonalNumber(e.target.value)}/></label>
                      <p>Uppgifterna anges av dig och verifieras inte med e-legitimation. Namn och personnummer tas med i det signerade dokumentet och bevisarkivet. Tidpunkt och eventuell vidarebefordrad IP-adress registreras också.</p>
                      {data.fields.map((f) => (
                        <label key={f.id}>
                          {f.label}
                          {f.required ? " *" : ""}
                          <input
                            type={f.type === "date" ? "date" : "text"}
                            required={f.required}
                            maxLength={2000}
                            value={values[f.id] ?? ""}
                            onChange={(e) =>
                              setValues({ ...values, [f.id]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          required
                        />
                        Jag godkänner innehållet i dokumenten och vill
                        registrera mitt godkännande via e-postlänken.
                      </label>
                    </fieldset>
                    <p className="muted">
                      Metod: godkännande via e-post. Denna åtgärd använder inte
                      BankID eller Freja eID.
                    </p>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        (!decision.current &&
                          (!consent || seen.length !== data.documents.length))
                      }
                    >
                      {busy
                        ? "Registrerar…"
                        : decision.current
                          ? "Försök registrera samma svar igen"
                          : "Godkänn avtal"}
                    </button>
                  </form>
                  {!decision.current && (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setDeclining(!declining)}
                      >
                        Neka avtalet
                      </button>
                      {declining && (
                        <div className="operation-form">
                          <label>
                            Orsak (valfritt)
                            <textarea
                              maxLength={500}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                          </label>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => decide("decline")}
                          >
                            Bekräfta att jag nekar avtalet
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      <footer>
        Trafexa Nordic AB · 556855-4884 ·{" "}
        <a href="mailto:info@trafexa.com">Support</a>
      </footer>
    </main>
  );
}
