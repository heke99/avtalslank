import {requestJson} from "../../packages/http/src/index";
import React, { useEffect, useState } from "react";
import { apiUrl, supabase, friendlyError,displayError } from "./client";
export default function Webhooks({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [secret, setSecret] = useState("");
  async function load() {
    const { data, error } = await supabase
      .from("al_webhook_endpoints")
      .select("id,url,active")
      .eq("organization_id", orgId)
      .order("created_at");
    if (error) throw error;
    setItems(data ?? []);
  }
  useEffect(() => {
    setSecret("");
    setItems([]);
    load().catch((e) => setError(displayError(e)));
  }, [orgId]);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const result = await requestJson(apiUrl + "/v1/webhooks", {
        method: "POST",
        headers: {
          authorization: `Bearer ${data.session?.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...(body as object), organizationId: orgId }),
      });
      if (result.data.secret) setSecret(result.data.secret);
      await load();
    } catch (e) {
      setError(displayError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="operation-form">
      <h2>Webhooks</h2>
      <p>
        Händelser skickas till din HTTPS-adress. Verifiera signaturen och
        ignorera redan behandlade händelse-ID:n i ditt system. Endast ägare och
        administratörer kan ändra anslutningen.
      </p>
      {error && <p role="alert">{error}</p>}
      {items.map((w) => (
        <div className="list-row" key={w.id}>
          <span className="grow">
            <strong style={{ overflowWrap: "anywhere" }}>{w.url}</strong>
            <small>{w.active ? "Aktiv" : "Avstängd"}</small>
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => save({ id: w.id, url: w.url, active: !w.active })}
          >
            {w.active ? "Stäng av" : "Aktivera"}
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({ url: f.get("url") });
        }}
      >
        <label>
          Mottagaradress (HTTPS)
          <input
            type="url"
            name="url"
            required
            maxLength={2048}
            placeholder="https://ditt-system.se/webhooks/avtalslank"
          />
        </label>
        <button className="secondary" disabled={busy}>
          Lägg till webhook
        </button>
      </form>
      {secret && (
        <div role="status">
          <strong>Spara signeringshemligheten. Den visas bara nu.</strong>
          <code
            style={{
              display: "block",
              overflowWrap: "anywhere",
              margin: "12px 0",
            }}
          >
            {secret}
          </code>
          <button className="secondary" onClick={() => setSecret("")}>
            Jag har sparat hemligheten
          </button>
        </div>
      )}
    </section>
  );
}
