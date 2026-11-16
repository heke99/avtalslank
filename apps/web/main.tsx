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
import { configured, supabase, rpc, friendlyError, apiUrl } from "./client";
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
type Org = { id: string; name: string; registration_number: string | null };
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
    [query, setQuery] = useState(""),
    [mobileMenu, setMobileMenu] = useState(false);
  const org = orgs.find((o) => o.id === orgId);
  const scope = useRef("");
  scope.current = `${session?.user.id ?? ""}:${orgId}`;
  function notify(error: unknown) {
    setNotice(friendlyError((error as { message?: string }).message ?? ""));
  }
  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  async function loadOrgs() {
    const { data, error } = await supabase
      .from("al_organizations")
      .select("id,name,registration_number")
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
  }, [session?.user.id]);
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
    ["workspace", "Företag & team", Users],
  ] as const;
  if (loading)
    return (
      <div className="center-screen">
        <Brand />
        <p>Öppnar din arbetsyta…</p>
      </div>
    );
  if (location.pathname.startsWith("/s/")) return <Signer />;
  if (location.pathname === "/reset-password")
    return <PasswordReset session={session} onError={notify} notice={notice} />;
  if (!session) return <Auth onError={notify} notice={notice} />;
  return (
    <div className="shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <Brand />
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
            onChange={(e) => setOrgId(e.target.value)}
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
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
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
          <button className="profile" onClick={() => supabase.auth.signOut()}>
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
              back={() => {
                setSelected(null);
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
                <section className="panel">
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
                      <label className="search">
                        <Search size={17} />
                        <input
                          aria-label="Sök avtal"
                          placeholder="Sök avtal…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
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
                          {envelopes
                            .filter((e) =>
                              e.title
                                .toLocaleLowerCase("sv")
                                .includes(query.toLocaleLowerCase("sv")),
                            )
                            .slice(0, view === "overview" ? 5 : 100)
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
              {view === "workspace" && (
                <WorkspaceOperations
                  key={orgId}
                  orgId={orgId}
                  action={action}
                  busy={busy}
                  reload={reload}
                />
              )}
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
    </div>
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
  const [mode, setMode] = useState<"login" | "register" | "reset">("login"),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState("");
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
                ? "Registrera ett konto för att hantera företagets avtal."
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
                          options: { emailRedirectTo: location.origin },
                        })
                      : await supabase.auth.resetPasswordForEmail(email, {
                          redirectTo: location.origin + "/reset-password",
                        });
                if (result.error) throw result.error;
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
            <label>
              E-postadress
              <div className="input-icon">
                <Mail size={17} />
                <input
                  name="email"
                  type="email"
                  placeholder="du@foretag.se"
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
  onSaved,
}: {
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
    [sequential, setSequential] = useState(e.sequential);
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
        busy={busy}
        onSaved={onSaved}
      />
      <div className="steps">
        {["Dokument", "Mottagare & metod", "Uppgifter", "Granska & skicka"].map(
          (s, i) => (
            <button
              key={s}
              className={step === i ? "selected" : ""}
              onClick={() => setStep(i)}
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
                  {busy ? "Laddar upp…" : "Välj en PDF att ladda upp"}
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
                      const name = safePdfFilename(file.name);
                      if (file.size > 10485760)
                        throw new Error("DOCUMENT_TOO_LARGE");
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      if (!isPdf(bytes)) throw new Error("INVALID_PDF");
                      const id = crypto.randomUUID();
                      const hash = await sha256Hex(bytes);
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
                      const { error } = await supabase.storage
                        .from("al-documents")
                        .upload(path, file, {
                          contentType: "application/pdf",
                          upsert: false,
                        });
                      if (error) throw error;
                      await rpc("al_register_document", {
                        p_org: orgId,
                        p_envelope: e.id,
                        p_id: id,
                        p_name: name,
                        p_sha256: hash,
                        p_byte_size: file.size,
                      });
                      await load();
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
            <button className="primary next" onClick={() => setStep(1)}>
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
                          ? " · förberedd, ej aktiverad"
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
            <button className="primary next" onClick={() => setStep(2)}>
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
              onSaved={onSaved}
            />
            <h2>Uppgifter och meddelande</h2>
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                action(async () => {
                  const v = await rpc<Envelope>("al_save_draft", {
                    p_org: orgId,
                    p_id: e.id,
                    p_generation: e.generation,
                    p_title: title,
                    p_message: message,
                    p_sequential: sequential,
                    p_expires_days: e.expires_days,
                  });
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
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={sequential}
                  onChange={(ev) => setSequential(ev.target.checked)}
                  disabled={locked}
                />
                Signera i angiven turordning
              </label>
              <button className="primary" disabled={busy || locked}>
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
                disabled={busy || locked}
                onClick={() => {
                  if (window.confirm("Vill du avbryta det här utkastet?"))
                    action(async () => {
                      onSaved({
                        ...e,
                        ...(await envelopeApi(orgId, e.id, "cancel", {})),
                      });
                    });
                }}
              >
                Avbryt utkast
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
                {(
                  {
                    "envelope.draft_saved": "Utkast sparat",
                    "recipient.added": "Mottagare tillagd",
                    "document.uploaded": "Dokument uppladdat",
                    "document.scanned": "Dokumentkontroll utförd",
                    "envelope.cancelled": "Utkast avbrutet",
                  } as Record<string, string>
                )[v.kind] ?? "Avtalshändelse"}
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
    [open, setOpen] = useState(false);
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
      <section className="panel">
        {!templates.length ? (
          <Empty
            icon={<Layers size={27} />}
            title="Börja med en återanvändbar fältmall."
            description="Spara fält och mottagarroller. Koppling av mall-PDF och visuell placering byggs vidare på denna modell."
            action={
              <button className="secondary" onClick={() => begin()}>
                Skapa fältmall
              </button>
            }
          />
        ) : (
          templates.map((t) => (
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
          ))
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
                validateFields(fields);
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
                minLength={2}
              />
            </label>
            {fields.map((f, i) => (
              <div className="field-row" key={f.id}>
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
  const [keys, setKeys] = useState<
      Array<{
        id: string;
        name: string;
        prefix: string;
        revoked_at: string | null;
      }>
    >([]),
    [secret, setSecret] = useState(""),
    [name, setName] = useState("");
  async function load() {
    const { data, error } = await supabase
      .from("al_api_keys")
      .select("id,name,prefix,revoked_at,scopes,created_at")
      .eq("organization_id", orgId);
    if (error) throw error;
    setKeys(data ?? []);
  }
  useEffect(() => {
    action(load);
    setSecret("");
  }, [orgId]);
  return (
    <>
      <section className="developer-banner">
        <Code2 size={30} />
        <div>
          <h2>Samma avtal. Ditt eget flöde.</h2>
          <p>
            Skapa utkast och hantera mottagare via ett organisationsbundet API.
          </p>
        </div>
        <span className="badge draft">API v1</span>
      </section>
      <section className="panel detail-panel">
        <h2>API-nycklar</h2>
        <p className="muted">
          Endast ägare och administratörer kan skapa nycklar. Hemligheten visas
          en gång.
        </p>
        {secret && (
          <div className="secret-box" role="status">
            <strong>Spara din nya nyckel säkert.</strong>
            <code>{secret}</code>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => navigator.clipboard.writeText(secret)}
              >
                <Copy size={15} />
                Kopiera
              </button>
              <button className="text-button" onClick={() => setSecret("")}>
                Jag har sparat den
              </button>
            </div>
          </div>
        )}
        <form
          className="inline-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            action(async () => {
              const { data } = await supabase.auth.getSession();
              const response = await fetch(`${apiUrl}/v1/api-keys`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${data.session?.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  organizationId: orgId,
                  name,
                  scopes: ["envelopes:read", "envelopes:write", "billing:read"],
                }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error?.code);
              setSecret(result.data.key);
              setName("");
              await load();
            });
          }}
        >
          <label>
            Nyckelns namn
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              required
              placeholder="Till exempel företagets integration"
            />
          </label>
          <button className="primary" disabled={busy}>
            <Plus size={16} />
            Skapa nyckel
          </button>
        </form>
        {keys.map((k) => (
          <div className="list-row" key={k.id}>
            <Code2 size={19} />
            <span className="grow">
              <strong>{k.name}</strong>
              <small>
                {k.prefix}… · {k.revoked_at ? "Återkallad" : "Aktiv"}
              </small>
            </span>
            <button
              className="secondary"
              disabled={!!k.revoked_at || busy}
              onClick={() =>
                action(async () => {
                  await rpc("al_revoke_api_key", { p_org: orgId, p_id: k.id });
                  await load();
                })
              }
            >
              Återkalla
            </button>
          </div>
        ))}
      </section>
      <section className="panel detail-panel">
        <h2>Kom igång</h2>
        <p className="muted">
          Använd Bearer-autentisering och en unik Idempotency-Key för skrivande
          anrop.
        </p>
        <pre>{`POST ${apiUrl}/v1/envelopes\nAuthorization: Bearer <din-api-nyckel>\nIdempotency-Key: <unik-referens>\nContent-Type: application/json\n\n{"draft":{"title":"Samarbetsavtal"}}`}</pre>
        <p className="muted">
          Nyckeln ger aldrig rätt att sätta signeringsstatus eller kringgå
          dokumentkontrollen. Skarp signering aktiveras efter verifiering.
        </p>
      </section>
    </>
  );
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
      <section className="panel detail-panel">
        <h2>Företag</h2>
        <dl>
          <dt>Företagsnamn</dt>
          <dd>{org.name}</dd>
          <dt>Organisationsnummer</dt>
          <dd>{org.registration_number || "Inte angivet"}</dd>
          <dt>Tjänsteleverantör</dt>
          <dd>Trafexa Nordic AB · 556855-4884</dd>
        </dl>
      </section>
      <section className="panel detail-panel">
        <h2>Betalning och förbrukning</h2>
        <span className="badge draft">Ingen betalning aktiverad</span>
        <p>
          Betalningsmodell och priser är ännu inte fastställda. Inga köp eller
          automatiska debiteringar sker.
        </p>
        <p className="muted">
          Tjänsten förbereds för abonnemang, per dokument eller en kombination.{" "}
          {billing?.enabled
            ? "Kontakta administratören för aktuell betalningsstatus."
            : ""}
        </p>
      </section>
      <section className="panel detail-panel full-grid">
        <h2>Signeringsmetoder</h2>
        <p className="muted">
          Du kan förbereda metodval i utkast. Skarpa utskick kräver aktiverad
          anslutning.
        </p>
        {capabilities.map((c) => (
          <div className="list-row" key={c.method}>
            <ShieldCheck size={20} />
            <span className="grow">
              <strong>{methodLabels[c.method]}</strong>
              <small>{c.reason ?? "Tillgänglig för signering"}</small>
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
createRoot(document.getElementById("root")!).render(<App />);
