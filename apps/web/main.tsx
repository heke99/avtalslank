import AuthConfirmation from "./AuthConfirmation";
import PlatformAdmin,{PlatformAdminLink} from "./PlatformAdmin";
import {RegistrationFields,RegistrationGate,AccountRegistrationSummary} from "./Registration";
import {registrationFromForm,type AccountKind} from "../../packages/accounts/src/index";
import {templateList,validateTemplateFields} from "../../packages/editor/src/index";
import {SecurityKeys,LegalAccount,PlanPreference} from "./AccountControls";
import GettingStarted from "./GettingStarted";
import {filterAgreements,agreementCsv} from "../../packages/workspace/src/index";
import {PublicSite} from "./PublicSite";
import {publicPaths,selectedPlan,signupMetadata,plans,legalVersion} from "../../packages/public-site/src/index";
import "./public.css";
import {AccountSecurity,OperationalStatus,JoinInvitation,RemindRecipient} from "./AccountOperations";
import {activityLabel} from "../../packages/domain/src/activity";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  FileText,
  LayoutDashboard,
  Layers,
  Code2,
  Settings,
  LogOut,
  ChevronDown,
  Check,
  Clock,
  ShieldCheck,
  Link2,
  MoreHorizontal,
  X,
  Upload,
  Users,
  ChevronLeft,
  Mail,
  LockKeyhole,
  Menu,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2,
  Grip,
  PenLine,
} from "lucide-react";
import { configured, supabase, rpc, friendlyError, displayError, apiUrl } from "./client";
import {
  methodLabels,
  statusLabels,
  signingReadiness,
  safePdfFilename,
  isPdf,
  validateFields,
  type SigningMethod,
  type ProviderCapability,
  type TemplateField,
  type EnvelopeStatus,
} from "../../packages/domain/src/index.ts";
import { sha256Hex } from "../../packages/crypto/src/hash.ts";
import "./styles.css";
import Signer from "./Signer";
import Webhooks from "./Webhooks";
import {
  SigningPreparation,
  DeliveryHistory,
  envelopeApi,
} from "./SigningPreparation";
import {
  WorkspaceOperations,
  RecipientTools,
  DocumentTools,
  DuplicateDraft,
  ContactPicker,
} from "./operations";
type Envelope = {
  id: string;
  organization_id: string;
  title: string;
  message: string;
  sequential: boolean;
  expires_days: number;
  status: EnvelopeStatus;
  generation: number;
  updated_at: string;
};
type Org = { id: string; name: string; registration_number: string | null;kind?:"company"|"personal" };
type Recipient = {
  id: string;
  name: string;
  email: string;
  method: SigningMethod;
  position: number;
  status: string;
};
type Document = {
  id: string;
  name: string;
  status: string;
  storage_path: string;
  sha256: string;
  byte_size: number;
  page_count: number | null;
};
type Template = {
  id: string;
  name: string;
  fields: TemplateField[];
  version: number;
};
type Event = { id: string; kind: string; created_at: string };
const defaults: ProviderCapability[] = Object.keys(methodLabels).map(
  (method) => ({
    method: method as SigningMethod,
    enabled: false,
    reason: "Anslutning och verifiering återstår.",
  }),
);
const date = (s: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(s));
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [sessionError,setSessionError]=useState(false),
    [draftDirty,setDraftDirty]=useState(false),
    [orgs, setOrgs] = useState<Org[]>([]),
    [orgId, setOrgId] = useState(""),
    [view, setView] = useState("overview"),
    [envelopes, setEnvelopes] = useState<Envelope[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [capabilities, setCapabilities] = useState(defaults),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<"create" | "org" | null>(null),
    [selected, setSelected] = useState<Envelope | null>(null),
    [statusFilter,setStatusFilter]=useState(""),
    [dateFrom,setDateFrom]=useState(""),[dateTo,setDateTo]=useState(""),[agreementSort,setAgreementSort]=useState<"latest"|"oldest"|"title">("latest"),
    [query, setQuery] = useState(""),
    [mobileMenu, setMobileMenu] = useState(false);
  const org = orgs.find((o) => o.id === orgId);
  const displayedAgreements=filterAgreements(envelopes,{organizationId:orgId,query:view==='overview'?'':query,status:view==='overview'?'':statusFilter,from:view==='overview'?'':dateFrom,to:view==='overview'?'':dateTo,sort:view==='overview'?'latest':agreementSort}).slice(0,view==='overview'?5:100);
  function exportAgreements(){const url=URL.createObjectURL(new Blob([agreementCsv(displayedAgreements,orgId,statusLabels)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='avtalslank-avtal-'+orgId+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

  const scope = useRef("");
  scope.current = `${session?.user.id ?? ""}:${orgId}`;
  function notify(error: unknown) {
    setNotice(displayError(error));
  }
  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let active=true;const timer=setTimeout(()=>{if(active){setSessionError(true);setLoading(false);}},12000);
    supabase.auth.getSession().then(({data,error})=>{if(!active)return;clearTimeout(timer);if(error){setSessionError(true);}else{setSession(data.session);setSessionError(false);}setLoading(false);}).catch(()=>{if(active){clearTimeout(timer);setSessionError(true);setLoading(false);}});
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {active=false;clearTimeout(timer);data.subscription.unsubscribe();};
  }, []);
  async function loadOrgs() {
    const { data, error } = await supabase
      .from("al_organizations")
      .select("id,name,registration_number,kind")
      .order("created_at");
    if (error) throw error;
    setOrgs(data ?? []);
    setOrgId((old) =>
      (data ?? []).some((o) => o.id === old) ? old : (data?.[0]?.id ?? ""),
    );
  }
  useEffect(() => {
    if (session) loadOrgs().catch(notify);
    else {
      setOrgs([]);
      setOrgId("");
    }
  }, [session?.user.id,session?.access_token]);
  async function reload() {
    if (!orgId) return;
    const requestedScope = scope.current;
    const [a, b, c] = await Promise.all([
      supabase
        .from("al_envelopes")
        .select("*")
        .eq("organization_id", orgId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("al_templates")
        .select("*")
        .eq("organization_id", orgId)
        .order("updated_at", { ascending: false }),
      rpc<ProviderCapability[]>("al_capabilities", {}),
    ]);
    if (scope.current !== requestedScope) return;
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    setEnvelopes(a.data ?? []);
    setTemplates(b.data ?? []);
    setCapabilities(c);
  }
  useEffect(() => {
    setSelected(null);
    setEnvelopes([]);setTemplates([]);
    if (orgId) reload().catch(notify);
  }, [orgId]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  const nav = [
    ["overview", "Översikt", LayoutDashboard],
    ["agreements", "Avtal", FileText],
    ["templates", "Mallar", Layers],
    ["developers", "API & integration", Code2],
    ["settings", "Inställningar", Settings],
    ["workspace", org?.kind === "personal" ? "Min arbetsyta" : "Företag & team", Users],
  ] as const;
  if(sessionError)return <div className="center-screen"><Brand/><h1>Inloggningen kunde inte läsas in</h1><p>Kontrollera anslutningen och läs in sidan igen.</p><button className="primary" onClick={()=>location.reload()}>Försök igen</button><a href="/hjalp">Kontakta support</a></div>;
  if (loading)
    return (
      <div className="center-screen">
        <Brand />
        <p>Öppnar din arbetsyta…</p>
      </div>
    );
  const publicPath=location.pathname.replace(/\/$/,"")||"/";
  if(publicPaths.includes(publicPath as typeof publicPaths[number]) && (publicPath!=="/"||!session)) return <PublicSite path={publicPath} requestedVersion={new URLSearchParams(location.search).get("version")}/>;
  if (publicPath === "/auth/confirm")return <AuthConfirmation/>;
  if (publicPath === "/s" || publicPath.startsWith("/s/")) return <Signer />;
  if (publicPath === "/reset-password")
    return <PasswordReset session={session} onError={notify} notice={notice} />;
  if(session?.user.factors?.some(f=>f.status==="verified") && (()=>{try{return JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).aal!=="aal2";}catch{return true;}})()) return <main className="security-gate"><header><Brand/><h1>Verifiera din inloggning</h1><p>Ange en kod från din autentiseringsapp för att fortsätta.</p></header><AccountSecurity/></main>;
  if (location.pathname.startsWith("/join")) return <JoinInvitation session={session}><Auth onError={notify} notice={notice}/></JoinInvitation>;
  if (!session) return <Auth onError={notify} notice={notice} />;
  if(publicPath==="/admin")return <PlatformAdmin/>;
  return (
    <RegistrationGate session={session} organizations={orgs} onComplete={async id=>{await loadOrgs();setOrgId(id);}}><div className="shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <Brand /><PlatformAdminLink/>
        <button className="organization" onClick={() => setModal("org")}>
          <span className="org-avatar">{org?.name?.slice(0, 1) ?? "+"}</span>
          <span>
            <strong>{org?.name ?? "Ditt företag"}</strong>
            <small>Arbetsyta</small>
          </span>
          <ChevronDown size={16} />
        </button>
        {orgs.length > 1 && (
          <select
            aria-label="Aktivt företag"
            value={orgId}
            onChange={(e) => {if(draftDirty&&!confirm("Du har osparade ändringar. Vill du byta företag?"))return;setDraftDirty(false);setOrgId(e.target.value);}}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-label={label}
              className={view === id ? "active" : ""}
              onClick={() => {
                if(draftDirty&&!confirm('Du har osparade ändringar. Vill du lämna utkastet?'))return;
                setDraftDirty(false);setView(id);
                setSelected(null);
                setMobileMenu(false);
              }}
            >
              <Icon size={19} />
              {label}
              {id === "agreements" && envelopes.length > 0 && (
                <span className="nav-count">{envelopes.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-box">
            <ShieldCheck size={20} />
            <strong>Support</strong>
            <p>Frågor om Avtalslänk?</p>
            <a href="mailto:info@trafexa.com">
              Kontakta oss <ArrowUpRight size={14} />
            </a>
          </div>
          <button className="profile" onClick={() => {if(draftDirty&&!confirm("Du har osparade ändringar. Vill du logga ut?"))return;supabase.auth.signOut();}}>
            <span className="user-avatar">
              {session.user.email?.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>Mitt konto</strong>
              <small>{session.user.email}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon mobile-only"
            aria-label="Öppna meny"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu />
          </button>
          <span>
            Din arbetsyta <span className="crumb">/</span>{" "}
            <strong>{nav.find((n) => n[0] === view)?.[1]}</strong>
          </span>
          <span className="top-status">
            <i />
            Avtalslänk
          </span>
        </header>
        <div className="content">
          {notice && (
            <div className="alert" role="alert">
              <AlertCircle size={18} />
              {notice}
              <button
                className="icon"
                aria-label="Stäng meddelande"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!org ? (
            <div className="welcome-card">
              <div className="eyebrow">VÄLKOMMEN TILL AVTALSLÄNK</div>
              <h1>Skapa företagskonto</h1>
              <p>
                Skapa ditt företag för att börja med dokument, mottagare och
                mallar.
              </p>
              <button className="primary" onClick={() => setModal("org")}>
                <Plus size={17} />
                Skapa företagskonto
              </button>
            </div>
          ) : selected ? (
            <EnvelopeDetail
              key={selected.id}
              envelope={selected}
              orgId={orgId}
              capabilities={capabilities}
              busy={busy}
              action={action}
              onDirty={setDraftDirty}
              back={() => {
                if(draftDirty&&!confirm('Du har osparade ändringar. Vill du lämna utkastet?'))return;
                setDraftDirty(false);setSelected(null);
                reload().catch(notify);
              }}
              onSaved={(v) => {
                setSelected(v);
                reload().catch(notify);
              }}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === "overview" ? "AVTALSLÄNK" : "DIN ARBETSYTA"}
                  </div>
                  <h1>
                    {view === "overview"
                      ? "Översikt"
                      : view === "agreements"
                        ? "Alla avtal"
                        : view === "templates"
                          ? "Mallar"
                          : view === "developers"
                            ? "API och integration"
                            : view === "workspace"
                              ? "Företag & team"
                              : "Inställningar"}
                  </h1>
                  <p>
                    {view === "overview"
                      ? "Status och senast uppdaterade avtal."
                      : view === "agreements"
                        ? "Håll koll på dokument, mottagare och nästa steg."
                        : view === "templates"
                          ? "Spara återanvändbara fält och mottagarroller."
                          : view === "developers"
                            ? "Anslut ditt system med ett tydligt API."
                            : "Hantera ditt företag och se tillgängliga signeringsmetoder."}
                  </p>
                </div>
                {["overview", "agreements"].includes(view) && (
                  <button
                    className="primary"
                    onClick={() => setModal("create")}
                  >
                    <Plus size={18} />
                    Nytt avtal
                  </button>
                )}
              </div>
              {view === "overview" && <GettingStarted key={orgId} orgId={orgId} envelopes={envelopes.filter(e=>e.organization_id===orgId).length} templates={templates.length} open={setView}/>}
              {view === "overview" && (
                <>
                  <div className="stats">
                    {[
                      {
                        label: "Totalt antal avtal",
                        value: envelopes.length,
                        icon: FileText,
                        desc: "I företagskontot",
                      },
                      {
                        label: "Utkast",
                        value: envelopes.filter((e) => e.status === "draft")
                          .length,
                        icon: PenLine,
                        desc: "Under arbete",
                      },
                      {
                        label: "Väntar på signering",
                        value: envelopes.filter((e) =>
                          ["sent", "in_progress"].includes(e.status),
                        ).length,
                        icon: Clock,
                        desc: "Hos dina mottagare",
                      },
                      {
                        label: "Färdiga avtal",
                        value: envelopes.filter((e) => e.status === "completed")
                          .length,
                        icon: CheckCircle2,
                        desc: "Samtliga mottagare klara",
                      },
                    ].map((s) => (
                      <div className="stat" key={s.label}>
                        <div>
                          <span>{s.label}</span>
                          <s.icon size={19} />
                        </div>
                        <strong>{s.value}</strong>
                        <small>{s.desc}</small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {["overview", "agreements"].includes(view) && (
                <section className="panel agreements-panel">
                  <div className="panel-header">
                    <div>
                      <h2>
                        {view === "overview"
                          ? "Senaste avtal"
                          : "Avtalsöversikt"}
                      </h2>
                      <p>{envelopes.length} avtal i arbetsytan</p>
                    </div>
                    {view === "overview" ? (
                      <button
                        className="text-button"
                        onClick={() => setView("agreements")}
                      >
                        Visa alla <ArrowRight size={16} />
                      </button>
                    ) : (
                      <>
                        <label>
                          Status
                          <select aria-label="Filtrera avtal efter status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                            <option value="">Alla statusar</option>
                            {Object.entries(statusLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                        <label className="search">
                        <Search size={17} />
                        <input
                          aria-label="Sök avtal"
                          placeholder="Sök avtal…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label></>
                    )}
                  </div>
                  {view==='agreements'&&<div className="agreement-controls"><label>Sortera avtal<select value={agreementSort} onChange={e=>setAgreementSort(e.target.value as typeof agreementSort)}><option value="latest">Senast uppdaterade</option><option value="oldest">Äldst uppdaterade</option><option value="title">Avtalsnamn A–Ö</option></select></label><label>Uppdaterad från<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>Uppdaterad till<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label><button className="secondary" onClick={()=>{setQuery('');setStatusFilter('');setDateFrom('');setDateTo('');setAgreementSort('latest');}}>Rensa filter</button><button className="secondary" disabled={!displayedAgreements.length} onClick={exportAgreements}>Exportera visade avtal (CSV)</button><p>{displayedAgreements.length} visade av {envelopes.filter(e=>e.organization_id===orgId).length} inlästa avtal. Högst 100 rader visas och exporteras. Datum avser svensk tid.</p>{dateFrom&&dateTo&&dateFrom>dateTo&&<p role="alert">Fråndatum behöver vara före eller samma dag som tilldatum.</p>}</div>}
                  {envelopes.length === 0 ? (
                    <Empty
                      icon={<FileText size={27} />}
                      title="Inga avtal ännu"
                      description="Skapa ett utkast och lägg till dokument och mottagare."
                      action={
                        <button
                          className="secondary"
                          onClick={() => setModal("create")}
                        >
                          <Plus size={16} />
                          Skapa ditt första avtal
                        </button>
                      }
                    />
                  ) : (
                    <div className="table-wrap">
                      {displayedAgreements.length===0&&<p className="filtered-empty" role="status">Inga avtal matchar filtren. Ändra urvalet eller rensa filtren.</p>}
                      <table>
                        <thead>
                          <tr>
                            <th>AVTAL</th>
                            <th>STATUS</th>
                            <th>SENAST UPPDATERAT</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {displayedAgreements
                            .map((e) => (
                              <tr key={e.id}>
                                <td>
                                  <button
                                    className="file-title"
                                    onClick={() => setSelected(e)}
                                  >
                                    <span className="file-icon">
                                      <FileText size={19} />
                                    </span>
                                    <span>
                                      <strong>{e.title}</strong>
                                      <small>Version {e.generation}</small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <Status status={e.status} />
                                </td>
                                <td>{date(e.updated_at)}</td>
                                <td>
                                  <button
                                    className="icon"
                                    aria-label={`Öppna ${e.title}`}
                                    onClick={() => setSelected(e)}
                                  >
                                    <ArrowUpRight size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
              {view === "overview" && (
                <div className="footer-note">
                  <LockKeyhole size={14} />
                  Företagets dokument
                  <span>Avtalslänk · Trafexa Nordic AB</span>
                </div>
              )}
              {view === "templates" && (
                <Templates
                  templates={templates}
                  orgId={orgId}
                  action={action}
                  busy={busy}
                  reload={reload}
                />
              )}
              {view === "developers" && (
                <>
                  <Developer orgId={orgId} action={action} busy={busy} />
                  <Webhooks key={orgId} orgId={orgId} />
                </>
              )}
              {view === "workspace" && org.kind !== "personal" && (
                <WorkspaceOperations
                  key={orgId}
                  orgId={orgId}
                  action={action}
                  busy={busy}
                  reload={reload}
                />
              )}
              {view === "workspace" && org.kind === "personal" && <section className="panel detail-panel"><h2>Din privata arbetsyta</h2><p>Här samlas dina egna avtal. Undertecknare bjuds in till respektive avtal, inte som medlemmar i arbetsytan.</p><AccountRegistrationSummary/></section>}
              {view === "settings" && (
                <SettingsView
                  org={org}
                  capabilities={capabilities}
                  action={action}
                />
              )}
            </>
          )}
        </div>
      </main>
      {modal === "create" && (
        <Modal title="Börja med ett nytt avtal" close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action(async () => {
                const v = await rpc<Envelope>("al_save_draft", {
                  p_org: orgId,
                  p_title: f.get("title"),
                  p_message: f.get("message"),
                });
                await reload();
                setSelected(v);
                setModal(null);
              });
            }}
          >
            <label>
              Avtalets namn
              <input
                name="title"
                placeholder="Till exempel samarbetsavtal"
                required
                minLength={2}
                maxLength={160}
                autoFocus
              />
            </label>
            <label>
              Meddelande till mottagaren
              <textarea
                name="message"
                maxLength={2000}
                placeholder="Valfritt meddelande"
              />
            </label>
            <p className="muted">
              Du lägger till dokument, mottagare och signeringsmetod i nästa
              steg.
            </p>
            <button className="primary full" disabled={busy}>
              {busy ? "Skapar…" : "Skapa utkast"}
              <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "org" && (
        <Modal title="Skapa ett företagskonto" close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action(async () => {
                const id = await rpc<string>("al_create_organization", {
                  p_name: f.get("name"),
                  p_registration_number: f.get("registration") || null,
                });
                await loadOrgs();
                setOrgId(id);
                setModal(null);
              });
            }}
          >
            <label>
              Företagsnamn
              <input name="name" required minLength={2} maxLength={120} />
            </label>
            <label>
              Organisationsnummer
              <input name="registration" maxLength={30} />
            </label>
            <button className="primary full" disabled={busy}>
              Skapa företag
            </button>
          </form>
        </Modal>
      )}
    </div></RegistrationGate>
  );
}
function Brand() {
  return (
    <a className="brand" href="/" aria-label="Avtalslänk startsida">
      <span>
        <Link2 size={24} strokeWidth={2.7} />
      </span>
      avtalslänk<span className="brand-dot">.</span>
    </a>
  );
}
function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Status({ status }: { status: EnvelopeStatus }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {statusLabels[status]}
    </span>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) ?? [],
      );
    controls()[1]?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const c = controls(),
          first = c[0],
          last = c[c.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", h);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon" aria-label="Stäng dialog" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function PasswordReset({
  session,
  onError,
  notice,
}: {
  session: Session | null;
  onError: (e: unknown) => void;
  notice: string;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <div className="center-screen">
      <Brand />
      <section className="modal">
        <h1>Nytt lösenord</h1>
        {notice && (
          <div className="alert" role="alert">
            {notice}
          </div>
        )}
        {done ? (
          <>
            <p>Lösenordet är uppdaterat.</p>
            <a className="primary" href="/">
              Till arbetsytan
            </a>
          </>
        ) : !session ? (
          <p>
            Öppna en giltig återställningslänk från din e-post för att
            fortsätta.
          </p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (f.get("password") !== f.get("confirm")) {
                onError(new Error("PASSWORD_MISMATCH"));
                return;
              }
              setBusy(true);
              try {
                const { error } = await supabase.auth.updateUser({
                  password: String(f.get("password")),
                });
                if (error) throw error;
                setDone(true);
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nytt lösenord
              <input
                type="password"
                name="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Bekräfta lösenord
              <input
                type="password"
                name="confirm"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <button disabled={busy} className="primary full">
              Spara nytt lösenord
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
function Auth({
  notice,
  onError,
}: {
  notice: string;
  onError: (e: unknown) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">(location.pathname==="/signup"?"register":"login"),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(""),
    [confirmationEmail,setConfirmationEmail]=useState(""),
    [accountKind,setAccountKind]=useState<AccountKind>('company'),
    [plan,setPlan]=useState(selectedPlan(new URLSearchParams(location.search).get("plan"))??"");
  const confirmationHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(confirmationEmail){window.scrollTo({top:0,behavior:'instant'});confirmationHeading.current?.focus();}},[confirmationEmail]);
  if(confirmationEmail)return <main className="auth-layout"><section className="auth-main"><Brand/><div className="auth-form"><h1 ref={confirmationHeading} tabIndex={-1}>Bekräftelsemejl skickat</h1><p role="status">Vi har skickat ett bekräftelsemejl till <strong>{confirmationEmail}</strong>. Öppna mejlet och klicka på länken för att bekräfta ditt konto.</p><p>Kontrollera även skräpposten om mejlet inte finns i inkorgen. Det kan ta några minuter innan det kommer fram.</p><a className="primary full" href="/login">Till inloggningen</a><button className="text-button" onClick={()=>{setConfirmationEmail('');setSuccess('');}}>Ändra e-postadress</button><p>Behöver du hjälp? <a href="/hjalp">Kontakta oss</a>.</p></div></section></main>;
  return (
    <div className="auth-layout">
      <div className="auth-main">
        <Brand />
        <div className="auth-form">
          <span className="eyebrow">AVTALSLÄNK</span>
          <h1>
            {mode === "login"
              ? "Logga in"
              : mode === "register"
                ? "Skapa konto"
                : "Återställ lösenord"}
          </h1>
          <p>
            {mode === "login"
              ? "Ange din e-postadress och ditt lösenord."
              : mode === "register"
                ? "Välj företag eller privatperson och fyll i dina kontouppgifter."
                : "Vi skickar en länk till din e-postadress."}
          </p>
          {!configured && (
            <div className="alert">
              Inloggning behöver konfigureras för den här miljön.
            </div>
          )}
          {notice && (
            <div className="alert" role="alert">
              {notice}
            </div>
          )}
          {success && (
            <div className="success" role="status">
              {success}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setSuccess("");
              const f = new FormData(e.currentTarget);
              try {
                const email = String(f.get("email"));
                const password = String(f.get("password"));
                const result =
                  mode === "login"
                    ? await supabase.auth.signInWithPassword({
                        email,
                        password,
                      })
                    : mode === "register"
                      ? await supabase.auth.signUp({
                          email,
                          password,
                          options: { emailRedirectTo: location.origin+(location.pathname.startsWith("/join")?"/join/":""),data:{...signupMetadata(accountKind==="company"?plan:null,f.get("terms")==="on"),registration:registrationFromForm(f,accountKind)} },
                        })
                      : await supabase.auth.resetPasswordForEmail(email, {
                          redirectTo: location.origin + "/reset-password",
                        });
                if (result.error) throw result.error;
                if(mode==="register" && !("session" in result.data && result.data.session))setConfirmationEmail(email);
                if (mode !== "login")
                  setSuccess(
                    mode === "register"
                      ? "Kontrollera din inkorg för att verifiera kontot."
                      : "Om adressen har ett konto får du instruktioner via e-post.",
                  );
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "register" && <RegistrationFields kind={accountKind} setKind={setAccountKind}/>}
            <label>
              E-postadress
              <div className="input-icon">
                <Mail size={17} />
                <input
                  name="email"
                  type="email"
                  placeholder="din@epost.se"
                  required
                  autoComplete="email"
                />
              </div>
            </label>
            {mode !== "reset" && (
              <label>
                Lösenord
                <div className="input-icon">
                  <LockKeyhole size={17} />
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={mode === "register" ? 12 : 1}
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    placeholder={
                      mode === "register" ? "Minst 12 tecken" : "Ditt lösenord"
                    }
                  />
                </div>
              </label>
            )}
            {mode==="register"&&<>
              {accountKind === "company" && <><label>Önskat upplägg<select value={plan} onChange={e=>setPlan(e.target.value)} aria-label="Önskat upplägg"><option value="">Jag väljer senare</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <p className="auth-plan">Planvalet är ett önskemål. Inget betalt abonnemang, ingen bindningstid och ingen debitering startar vid registrering.</p></>}
              <div className="auth-legal"><label><input name="terms" type="checkbox" required/><span>{accountKind === "company" ? "Jag företräder företaget och accepterar" : "Jag accepterar"} <a href={"/villkor?version="+legalVersion} target="_blank" rel="noopener">allmänna villkor för kontot</a> (version {legalVersion}).</span></label><p>Så använder vi dina uppgifter: <a href="/integritet" target="_blank" rel="noopener">integritetspolicy</a>. Detta är information, inte ett samtycke till marknadsföring.</p></div>
            </>}
            <button className="primary full" disabled={busy || !configured}>
              {busy
                ? "Ett ögonblick…"
                : mode === "login"
                  ? "Logga in"
                  : mode === "register"
                    ? "Skapa konto"
                    : "Skicka återställningslänk"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-public-links"><a href="/">Till startsidan</a><a href="/abonnemang">Abonnemang</a><a href="/integritet">Integritet</a><a href="/cookies">Cookies</a><a href="/villkor">Villkor</a></div>
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <button
                  onClick={() => {
                    setMode("reset");
                    setSuccess("");
                  }}
                >
                  Glömt lösenordet?
                </button>
                <span>
                  Ny här?{" "}
                  <button
                    onClick={() => {
                      setMode("register");
                      setSuccess("");
                    }}
                  >
                    Skapa konto
                  </button>
                </span>
              </>
            ) : (
              <button
                onClick={() => {
                  setMode("login");
                  setSuccess("");
                }}
              >
                Tillbaka till inloggning
              </button>
            )}
          </div>
        </div>
        <footer>
          Trafexa Nordic AB · 556855-4884{" "}
          <a href="mailto:info@trafexa.com">Kontakta oss</a>
        </footer>
      </div>
    </div>
  );
}
function EnvelopeDetail({
  envelope: e,
  orgId,
  capabilities,
  busy,
  action,
  back,
  onSaved,onDirty,
}: {
  onDirty:(dirty:boolean)=>void;
  envelope: Envelope;
  orgId: string;
  capabilities: ProviderCapability[];
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  back: () => void;
  onSaved: (v: Envelope) => void;
}) {
  const [step, setStep] = useState(0),
    [documents, setDocuments] = useState<Document[]>([]),
    [recipients, setRecipients] = useState<Recipient[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [title, setTitle] = useState(e.title),
    [message, setMessage] = useState(e.message),
    [sequential, setSequential] = useState(e.sequential),[expiresDays,setExpiresDays]=useState(e.expires_days),[fieldsDirty,setFieldsDirty]=useState(false);
  function goStep(next:number){if(next===step)return;if(fieldsDirty&&!confirm("Dokumentfälten är inte sparade. Lämna steget och kasta ändringarna?"))return;setFieldsDirty(false);setStep(next);}
  const draftForm=useRef<HTMLFormElement>(null);
  const [uploadStage,setUploadStage]=useState('');
  const dirty=e.status==='draft'&&(title!==e.title||message!==e.message||sequential!==e.sequential||expiresDays!==e.expires_days||fieldsDirty);
  useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};const save=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&draftForm.current){event.preventDefault();if(!busy)draftForm.current.requestSubmit();}};window.addEventListener('beforeunload',leave);window.addEventListener('keydown',save);return()=>{window.removeEventListener('beforeunload',leave);window.removeEventListener('keydown',save);};},[dirty,busy]);
  async function load() {
    const [a, b, c] = await Promise.all([
      supabase.from("al_documents").select("*").eq("envelope_id", e.id),
      supabase
        .from("al_recipients")
        .select("*")
        .eq("envelope_id", e.id)
        .order("position"),
      supabase
        .from("al_events")
        .select("id,kind,created_at")
        .eq("envelope_id", e.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (a.error || b.error || c.error) throw a.error || b.error || c.error;
    setDocuments(a.data ?? []);
    setRecipients(b.data ?? []);
    setEvents(c.data ?? []);
  }
  useEffect(() => {
    action(load);
  }, [e.id]);
  const locked = e.status !== "draft";
  const issues = signingReadiness(documents, recipients, capabilities);
  return (
    <>
      <button className="back-button" onClick={back}>
        <ChevronLeft size={16} />
        Tillbaka till avtal
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">AVTAL · VERSION {e.generation}</span>
          <h1>{e.title}</h1>
          <p>Dokument, mottagare och utskicksinställningar.</p>
        </div>
        <Status status={e.status} />
      </div>
      <DuplicateDraft
        orgId={orgId}
        envelopeId={e.id}
        title={e.title}
        action={action}
        busy={busy||dirty}
        onSaved={onSaved}
      />
      {!locked&&<p role="status">{dirty?'Osparade ändringar':'Ändringarna är sparade'}</p>}
      <div className="steps">
        {["Dokument", "Mottagare & metod", "Uppgifter", "Granska & skicka"].map(
          (s, i) => (
            <button
              key={s}
              className={step === i ? "selected" : ""}
              onClick={() => goStep(i)}
            >
              <span>{i + 1}</span>
              {s}
            </button>
          ),
        )}
      </div>
      <section className="panel detail-panel">
        {step === 0 && (
          <>
            <h2>Lägg till ditt dokument</h2>
            <p className="muted">
              PDF, högst 10 MB. Originalet sparas separat och kontrolleras före
              utskick.
            </p>
            {!locked && (
              <label className={`upload-zone ${busy ? "disabled" : ""}`}>
                <Upload size={30} />
                <strong>
                  {uploadStage || "Välj en PDF att ladda upp"}
                </strong>
                <span>Dokumentet kopplas till det här avtalet.</span>
                <input
                  aria-label="Ladda upp PDF"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    action(async () => {
                      try{setUploadStage("Läser PDF-filen…");
                      const name = safePdfFilename(file.name);
                      if (file.size > 10485760)
                        throw new Error("DOCUMENT_TOO_LARGE");
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      if (!isPdf(bytes)) throw new Error("INVALID_PDF");
                      const id = crypto.randomUUID();
                      const hash = await sha256Hex(bytes);
                      setUploadStage("Kontrollerar PDF-filen…");
                      const { inspectUpload } = await import(
                        "../../packages/signing/src/index.ts"
                      );
                      await inspectUpload(
                        {
                          documentId: id,
                          envelopeId: e.id,
                          name,
                          sha256: hash,
                          byteSize: file.size,
                        },
                        bytes,
                      );
                      const path = `${orgId}/${e.id}/${id}.pdf`;
                      setUploadStage("Laddar upp dokumentet…");
                      const { error } = await supabase.storage
                        .from("al-documents")
                        .upload(path, file, {
                          contentType: "application/pdf",
                          upsert: false,
                        });
                      if (error) throw error;
                      setUploadStage("Sparar dokumentuppgifterna…");
                      await rpc("al_register_document", {
                        p_org: orgId,
                        p_envelope: e.id,
                        p_id: id,
                        p_name: name,
                        p_sha256: hash,
                        p_byte_size: file.size,
                      });
                      await load();
                      }finally{setUploadStage("");}
                    });
                    event.target.value = "";
                  }}
                />
              </label>
            )}
            {documents.map((d) => (
              <div className="list-row" key={d.id}>
                <DocumentTools
                  orgId={orgId}
                  envelopeId={e.id}
                  document={d}
                  locked={locked}
                  action={action}
                  reload={load}
                  busy={busy}
                />
                <span className="file-icon">
                  <FileText />
                </span>
                <span className="grow">
                  <strong>{d.name}</strong>
                  <small>
                    {(d.byte_size / 1024).toFixed(0)} KB ·{" "}
                    {d.status === "ready"
                      ? "Kontrollerat"
                      : d.status === "rejected"
                        ? "Dokumentet kunde inte godkännas"
                        : "Väntar på dokumentkontroll"}
                  </small>
                </span>
                <button
                  className="secondary"
                  disabled={d.status !== "ready"}
                  onClick={() =>
                    action(async () => {
                      const { data, error } = await supabase.storage
                        .from("al-documents")
                        .createSignedUrl(d.storage_path, 60);
                      if (error) throw error;
                      window.open(
                        data.signedUrl,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    })
                  }
                >
                  Öppna
                </button>
              </div>
            ))}
            <button className="primary next" onClick={() => goStep(1)}>
              Till mottagare
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Vem ska signera – och hur?</h2>
            <p className="muted">
              Välj metod för varje mottagare. Metoden låses när avtalet skickas.
            </p>
            {recipients.map((r) => (
              <div className="list-row" key={r.id}>
                <span className="recipient-number">{r.position}</span>
                <span className="grow">
                  <strong>{r.name}</strong>
                  <small>{r.email}</small>
                </span>
                <span className="method-label">{methodLabels[r.method]}</span>
                {locked && ["sent","in_progress"].includes(e.status) && r.status==="pending" && <RemindRecipient orgId={orgId} envelopeId={e.id} recipientId={r.id}/>}
                {!locked && (
                  <RecipientTools
                    orgId={orgId}
                    envelopeId={e.id}
                    recipient={r}
                    recipients={recipients}
                    action={action}
                    reload={load}
                    busy={busy}
                  />
                )}
              </div>
            ))}
            {!locked && (
              <ContactPicker
                orgId={orgId}
                action={action}
                onPick={async (c, method) => {
                  await rpc("al_add_recipient", {
                    p_org: orgId,
                    p_envelope: e.id,
                    p_name: c.name,
                    p_email: c.email,
                    p_method: method,
                    p_position: recipients.length + 1,
                  });
                  await load();
                }}
              />
            )}
            {!locked && (
              <form
                className="recipient-form"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const form = ev.currentTarget;
                  const f = new FormData(form);
                  action(async () => {
                    await rpc("al_add_recipient", {
                      p_org: orgId,
                      p_envelope: e.id,
                      p_name: f.get("name"),
                      p_email: f.get("email"),
                      p_method: f.get("method"),
                      p_position: recipients.length + 1,
                    });
                    form.reset();
                    await load();
                  });
                }}
              >
                <div className="two-columns">
                  <label>
                    Namn
                    <input name="name" required minLength={2} maxLength={120} />
                  </label>
                  <label>
                    E-post
                    <input name="email" type="email" required maxLength={254} />
                  </label>
                </div>
                <label>
                  Signeringsmetod
                  <select name="method" aria-label="Signeringsmetod">
                    {Object.entries(methodLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                        {!capabilities.find((c) => c.method === key)?.enabled
                          ? " · kontakta oss"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary" disabled={busy}>
                  <Plus size={16} />
                  Lägg till mottagare
                </button>
              </form>
            )}
            <button className="primary next" onClick={() => goStep(2)}>
              Nästa steg
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <SigningPreparation
              key={e.id}
              orgId={orgId}
              envelopeId={e.id}
              generation={e.generation}
              locked={locked}
              documents={documents}
              recipients={recipients}
              onSaved={onSaved} onDirty={setFieldsDirty}
            />
            <h2>Uppgifter och meddelande</h2>
            {fieldsDirty&&<p role="status">Spara dokumentfälten innan du går vidare till granskning.</p>}
            <form ref={draftForm}
              onSubmit={(ev) => {
                ev.preventDefault();if(fieldsDirty)return;
                action(async () => {
                  const v = await rpc<Envelope>("al_save_draft", {
                    p_org: orgId,
                    p_id: e.id,
                    p_generation: e.generation,
                    p_title: title,
                    p_message: message,
                    p_sequential: sequential,
                    p_expires_days: expiresDays,
                  });
                  setTitle(v.title);setMessage(v.message);setSequential(v.sequential);setExpiresDays(v.expires_days);
                  onSaved(v);
                  setStep(3);
                });
              }}
            >
              <label>
                Avtalets namn
                <input
                  value={title}
                  onChange={(ev) => setTitle(ev.target.value)}
                  required
                  minLength={2}
                  maxLength={160}
                  disabled={locked}
                />
              </label>
              <label>
                Meddelande
                <textarea
                  value={message}
                  onChange={(ev) => setMessage(ev.target.value)}
                  maxLength={2000}
                  disabled={locked}
                />
              </label>
              <label>Giltighetstid efter utskick (dagar)<input aria-label="Giltighetstid efter utskick (dagar)" type="number" min={1} max={90} step={1} value={expiresDays} disabled={locked} required onChange={ev=>setExpiresDays(Number(ev.target.value))}/></label>
              <p className="muted">1–90 dagar. Tiden börjar räknas när avtalet skickas.</p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={sequential}
                  onChange={(ev) => setSequential(ev.target.checked)}
                  disabled={locked}
                />
                Signera i angiven turordning
              </label>
              <button className="primary" disabled={busy || locked || fieldsDirty}>
                Spara och granska
                <ArrowRight size={16} />
              </button>
            </form>
          </>
        )}
        {step === 3 && (
          <>
            <h2>En sista kontroll.</h2>
            <p className="muted">
              Se över dokument, mottagare och metod innan avtalet skickas.
            </p>
            <div className="review-grid">
              <div>
                <small>DOKUMENT</small>
                <strong>{documents.length} PDF</strong>
              </div>
              <div>
                <small>MOTTAGARE</small>
                <strong>{recipients.length} personer</strong>
              </div>
              <div>
                <small>SIGNERINGSORDNING</small>
                <strong>{e.sequential ? "I turordning" : "Parallellt"}</strong>
              </div>
              <div>
                <small>GILTIGHETSTID</small>
                <strong>{e.expires_days} dagar</strong>
              </div>
            </div>
            {recipients.map((r) => (
              <div className="review-recipient" key={r.id}>
                <span>
                  {r.name}
                  <small>{r.email}</small>
                </span>
                <strong>{methodLabels[r.method]}</strong>
              </div>
            ))}
            {issues.length > 0 && (
              <div className="readiness">
                <strong>Innan avtalet kan skickas</strong>
                <ul>
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <p>
                  Ditt utkast är sparat. Ingen signeringsinbjudan har skickats.
                </p>
              </div>
            )}
            <div className="actions">
              <button
                className="secondary danger"
                disabled={
                  busy || !["draft", "sent", "in_progress"].includes(e.status)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      e.status === "draft"
                        ? "Vill du avbryta det här utkastet?"
                        : "Återkalla utskicket? Mottagarnas signeringslänkar slutar fungera.",
                    )
                  )
                    action(async () => {
                      onSaved({
                        ...e,
                        ...(await envelopeApi(orgId, e.id, "cancel", {})),
                      });
                    });
                }}
              >
                {e.status === "draft" ? "Avbryt utkast" : "Återkalla utskick"}
              </button>
              <button
                className="primary"
                disabled={busy || locked || issues.length > 0}
                onClick={() =>
                  action(async () => {
                    onSaved({
                      ...e,
                      ...(await envelopeApi(orgId, e.id, "send", {
                        generation: e.generation,
                      })),
                    });
                  })
                }
              >
                Skicka för signering
                <ArrowUpRight size={16} />
              </button>
            </div>
          </>
        )}
      </section>
      <DeliveryHistory orgId={orgId} envelopeId={e.id} status={e.status} />
      <section className="panel timeline">
        <h2>Händelser</h2>
        {events.length === 0 ? (
          <p className="muted">Inga händelser ännu.</p>
        ) : (
          events.map((v) => (
            <div key={v.id}>
              <i />
              <span>
                {activityLabel(v.kind)}
                <small>{date(v.created_at)}</small>
              </span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
function Templates({
  templates,
  orgId,
  action,
  busy,
  reload,
}: {
  templates: Template[];
  orgId: string;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Template | null>(null),
    [name, setName] = useState(""),
    [fields, setFields] = useState<TemplateField[]>([]),
    [open, setOpen] = useState(false),[query,setQuery]=useState(""),[sort,setSort]=useState("name");
  const shown=templateList(templates,query,sort);
  function begin(t?: Template) {
    setEditing(t ?? null);
    setName(t?.name ?? "");
    setFields(t?.fields ?? []);
    setOpen(true);
  }
  return (
    <>
      <div className="section-actions">
        <button className="primary" onClick={() => begin()}>
          <Plus size={16} />
          Ny fältmall
        </button>
      </div>
      <div className="template-filters"><label>Sök fältmall<input value={query} onChange={ev=>setQuery(ev.target.value)} placeholder="Namn, etikett eller mottagarroll"/></label><label>Sortera fältmallar<select aria-label="Sortera fältmallar" value={sort} onChange={ev=>setSort(ev.target.value)}><option value="name">Namn A–Ö</option><option value="fields">Flest fält</option><option value="version">Högst version</option></select></label><p>{shown.length} av {templates.length} fältmallar</p></div>
      <section className="panel">
        {!templates.length ? (
          <Empty
            icon={<Layers size={27} />}
            title="Börja med en återanvändbar fältmall."
            description="Spara fält och mottagarroller. Koppla mallens roller till mottagare och använd fälten på en PDF i avtalet."
            action={
              <button className="secondary" onClick={() => begin()}>
                Skapa fältmall
              </button>
            }
          />
        ) : (
          shown.length?shown.map((t) => (
            <button
              className="template-row"
              key={t.id}
              onClick={() => begin(t)}
            >
              <Layers />
              <span>
                <strong>{t.name}</strong>
                <small>
                  {t.fields.length} fält · version {t.version}
                </small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          )):<p className="empty-card">Inga fältmallar matchar sökningen.</p>
        )}
      </section>
      {open && (
        <Modal
          title={editing ? "Redigera fältmall" : "Ny fältmall"}
          close={() => setOpen(false)}
        >
          {editing && (
            <div className="operation-tools">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await rpc("al_save_template", {
                      p_org: orgId,
                      p_name: (editing.name + " – kopia").slice(0, 160),
                      p_fields: editing.fields,
                    });
                    await reload();
                    setOpen(false);
                  })
                }
              >
                Kopiera fältmall
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await rpc("al_delete_template", {
                      p_org: orgId,
                      p_id: editing.id,
                      p_version: editing.version,
                    });
                    await reload();
                    setOpen(false);
                  })
                }
              >
                Ta bort fältmall
              </button>
            </div>
          )}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              action(async () => {
                validateTemplateFields(fields);
                await rpc("al_save_template", {
                  p_org: orgId,
                  p_name: name,
                  p_fields: fields,
                  p_id: editing?.id ?? null,
                  p_version: editing?.version ?? null,
                });
                await reload();
                setOpen(false);
              });
            }}
          >
            <label>
              Mallnamn
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2} maxLength={160}
              />
            </label>
            {fields.map((f, i) => (
              <div className="field-row template-field" key={f.id}>
                <label>
                  Etikett
                  <input
                    value={f.label}
                    onChange={(e) =>
                      setFields(
                        fields.map((v, j) =>
                          j === i ? { ...v, label: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Typ
                  <select
                    value={f.type}
                    onChange={(e) =>
                      setFields(
                        fields.map((v, j) =>
                          j === i
                            ? {
                                ...v,
                                type: e.target.value as TemplateField["type"],
                              }
                            : v,
                        ),
                      )
                    }
                  >
                    <option value="text">Text</option>
                    <option value="date">Datum</option>
                    <option value="signature">Underskrift</option>
                  </select>
                </label>
                <label>Mottagarroll<input aria-label={'Mottagarroll för fält '+(i+1)} maxLength={120} required value={f.recipientRole} onChange={ev=>setFields(fields.map((v,j)=>j===i?{...v,recipientRole:ev.target.value}:v))}/></label>
                <label className="checkbox"><input type="checkbox" checked={f.required} onChange={ev=>setFields(fields.map((v,j)=>j===i?{...v,required:ev.target.checked}:v))}/>Obligatoriskt fält</label>
                <label>Sida<input type="number" min={1} max={100} step={1} value={f.page+1} onChange={ev=>setFields(fields.map((v,j)=>j===i?{...v,page:Number(ev.target.value)-1}:v))}/></label>
                {(['x','y','width','height'] as const).map(k=><label key={k}>{{x:'Från vänster (%)',y:'Från toppen (%)',width:'Bredd (%)',height:'Höjd (%)'}[k]}<input aria-label={k+' för mallfält '+(i+1)} type="number" min={k==='width'||k==='height'?1:0} max={100} step={1} required value={Math.round(f[k]*100)} onChange={ev=>setFields(fields.map((v,j)=>j===i?{...v,[k]:Number(ev.target.value)/100}:v))}/></label>)}
                <button
                  type="button"
                  className="icon"
                  aria-label="Ta bort fält"
                  onClick={() => setFields(fields.filter((v) => v.id !== f.id))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setFields([
                  ...fields,
                  {
                    id: crypto.randomUUID(),
                    label: "Nytt fält",
                    type: "text",
                    recipientRole: "Kund",
                    required: true,
                    page: 0,
                    x: 0.1,
                    y: 0.1,
                    width: 0.3,
                    height: 0.05,
                  },
                ])
              }
            >
              <Plus size={16} />
              Lägg till fält
            </button>
            <p className="muted">
              Fältmallens version sparas separat. Äldre versioner i skickade
              underlag ska inte ändras.
            </p>
            <button className="primary full" disabled={busy}>
              Spara fältmall
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Developer({
  orgId,
  action,
  busy,
}: {
  orgId: string;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  return <><SecurityKeys key={orgId} orgId={orgId}/><section className="panel detail-panel"><h2>API-dokumentation</h2><p>Använd Bearer-autentisering och en unik Idempotency-Key för skrivande anrop.</p><a href="/openapi.json">Öppna API-specifikationen</a></section></>;
}

function SettingsView({
  org,
  capabilities,
  action,
}: {
  org: Org;
  capabilities: ProviderCapability[];
  action: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [billing, setBilling] = useState<{
    model: string;
    enabled: boolean;
  } | null>(null);
  useEffect(() => {
    action(async () => {
      const { data, error } = await supabase
        .from("al_billing_accounts")
        .select("model,enabled")
        .eq("organization_id", org.id)
        .single();
      if (error) throw error;
      setBilling(data);
    });
  }, [org.id]);
  return (
    <div className="settings-grid">
      <AccountRegistrationSummary/>
      <AccountSecurity/>
      <LegalAccount/>
      <PlanPreference key={"plan-"+org.id} orgId={org.id}/>
      <OperationalStatus key={org.id} orgId={org.id}/>
      <section className="panel detail-panel">
        <h2>{org.kind === 'personal' ? 'Privat arbetsyta' : 'Företag'}</h2>
        <dl>
          <dt>{org.kind === 'personal' ? 'Namn' : 'Företagsnamn'}</dt>
          <dd>{org.name}</dd>
          <dt>{org.kind === 'personal' ? 'Kontotyp' : 'Organisationsnummer'}</dt>
          <dd>{org.kind === 'personal' ? 'Privatperson' : org.registration_number || "Inte angivet"}</dd>
          <dt>Tjänsteleverantör</dt>
          <dd>Trafexa Nordic AB · 556855-4884</dd>
        </dl>
      </section>
      <section className="panel detail-panel">
        <h2>Betalning och förbrukning</h2>
        <span className="badge draft">Ingen betalning aktiverad</span>
        <p>
          Kontot har ingen aktiv betalplan. Ingen debitering startar utan en separat godkänd beställning.
        </p>
        <p className="muted">
          Pris och omfattning framgår av er godkända beställning. Kontakta oss för frågor om betalplanen.{" "}
          {billing?.enabled
            ? "Kontakta administratören för aktuell betalningsstatus."
            : ""}
        </p>
      </section>
      <section className="panel detail-panel full-grid">
        <h2>Signeringsmetoder</h2>
        <p className="muted">
          Välj metod per mottagare. Kontakta support om ni behöver en annan anslutning.
        </p>
        {capabilities.map((c) => (
          <div className="list-row" key={c.method}>
            <ShieldCheck size={20} />
            <span className="grow">
              <strong>{methodLabels[c.method]}</strong>
              <small>{c.enabled ? "Tillgänglig för signering" : "Kontakta oss för att använda metoden"}</small>
            </span>
            <span className={`badge ${c.enabled ? "completed" : "draft"}`}>
              {c.enabled ? "Aktiv" : "Ej aktiverad"}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
function Root(){
  const path=location.pathname.replace(/\/$/,"")||"/";
  if(path!=="/"&&publicPaths.includes(path as typeof publicPaths[number]))return <PublicSite path={path} requestedVersion={new URLSearchParams(location.search).get("version")}/>;
  return <App/>;
}
createRoot(document.getElementById("root")!).render(<Root />);
