import { test, expect, type Page } from "@playwright/test";
const ref = "ykddnagtuacflilbchwx",
  org = "11111111-1111-4111-8111-111111111111";
async function workspace(page: Page, initialEnvelopes:Array<Record<string,unknown>>=[], initialRecipients:Array<Record<string,unknown>>=[]) {
  let envelopes: Array<Record<string, unknown>> = initialEnvelopes;
  let recipients: Array<Record<string, unknown>> = initialRecipients;
  let templates: Array<Record<string, unknown>> = [];
  let contacts: Array<Record<string, unknown>> = [];
  let invitations: Array<Record<string, unknown>> = [];
  await page.addInitScript(
    ({ ref }) => {
      localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: "test-ui-token",
          refresh_token: "test-ui-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "test@example.invalid",
            aud: "authenticated",
            app_metadata: { provider: "email" },
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { ref },
  );
  await page.route(`https://${ref}.supabase.co/**`, async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
      "content-type": "application/json",
    };
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    let value: unknown = [];
    if(path.endsWith('/team/invitations')){
      if(req.method()==='POST'){const b=req.postDataJSON();const i={id:'44444444-4444-4444-8444-444444444444',email:b.email,role:b.role,expires_at:new Date(Date.now()+86400000).toISOString()};invitations=[i];value={data:{...i,token:'a'.repeat(64)}};}else value={data:invitations};
    }else if(path.endsWith('/team/revoke')){invitations=invitations.map(i=>({...i,revoked_at:new Date().toISOString()}));value={data:{revoked:true}};}
    else if(path.endsWith('/status'))value={data:{workerFresh:false,signingConfigured:false,deliveries:{pending:2}}};
    else if (path.endsWith("/prepare"))
      value = { data: { envelope: { fields: [] } } };
    else if (path.endsWith("/deliveries")) value = { data: [] };
    else if (path.endsWith("/al_organizations")) {
      const o = {
        id: org,
        name: "Testföretaget",
        registration_number: "000000-0000",
      };
      value = req.headers()["accept"]?.includes("vnd.pgrst.object") ? o : [o];
    } else if (path.endsWith("/al_memberships"))
      value = [
        {
          organization_id: org,
          user_id: "22222222-2222-4222-8222-222222222222",
          role: "owner",
          active: true,
        },
      ];
    else if (path.endsWith("/al_contacts")) value = contacts;
    else if (path.endsWith("/al_save_contact")) {
      const b = req.postDataJSON();
      value = {
        id: b.p_id ?? crypto.randomUUID(),
        name: b.p_name,
        email: b.p_email,
        company: b.p_company,
        version: 1,
        archived: false,
      };
      contacts = [value as Record<string, unknown>];
    } else if (path.endsWith("/al_usage_summary"))
      value = {
        billing_model: "unconfigured",
        billing_enabled: false,
        counts: {},
      };
    else if (path.endsWith("/al_activity"))
      value = [
        {
          id: "event-1",
          kind: "organization.created",
          created_at: new Date().toISOString(),
          actor_id: null,
          metadata: {},
        },
      ];
    else if (path.endsWith("/al_envelopes")) value = envelopes;
    else if (path.endsWith("/al_recipients")) value = recipients;
    else if (path.endsWith("/al_templates")) value = templates;
    else if (
      path.endsWith("/al_events") ||
      path.endsWith("/al_documents") ||
      path.endsWith("/al_api_keys")
    )
      value = [];
    else if (path.endsWith("/al_billing_accounts"))
      value = { model: "unconfigured", enabled: false };
    else if (path.endsWith("/al_capabilities"))
      value = ["bankid", "freja", "email_approval", "drawn_signature"].map(
        (method) => ({
          method,
          enabled: false,
          reason: "Verifiering återstår.",
        }),
      );
    else if (path.endsWith("/al_save_draft")) {
      const b = req.postDataJSON();
      value = {
        id: "33333333-3333-4333-8333-333333333333",
        organization_id: org,
        title: b.p_title,
        message: b.p_message ?? "",
        sequential: false,
        expires_days: 14,
        status: "draft",
        generation: 1,
        updated_at: new Date().toISOString(),
      };
      envelopes = [value as Record<string, unknown>];
    } else if (path.endsWith("/al_add_recipient")) {
      const b = req.postDataJSON();
      value = {
        id: crypto.randomUUID(),
        name: b.p_name,
        email: b.p_email,
        method: b.p_method,
        position: b.p_position,
        status: "pending",
      };
      recipients.push(value as Record<string, unknown>);
    } else if (path.endsWith("/al_edit_recipient")) {
      const b = req.postDataJSON();
      const r = recipients.find((r) => r.id === b.p_id)!;
      Object.assign(r, {
        name: b.p_name,
        email: b.p_email,
        method: b.p_method,
      });
      value = r;
    } else if (path.endsWith("/al_remove_recipient")) {
      const b = req.postDataJSON();
      recipients = recipients.filter((r) => r.id !== b.p_id);
      recipients.forEach((r, i) => (r.position = i + 1));
      value = { removed: b.p_id };
    } else if (path.endsWith("/al_reorder_recipients")) {
      const b = req.postDataJSON();
      recipients = b.p_ids.map((id: string, i: number) => ({
        ...recipients.find((r) => r.id === id),
        position: i + 1,
      }));
      value = b.p_ids;
    } else if (path.endsWith("/al_duplicate_draft")) {
      const b = req.postDataJSON();
      value = { ...envelopes[0], id: crypto.randomUUID(), title: b.p_title };
      envelopes.push(value as Record<string, unknown>);
    } else if (path.endsWith("/al_save_template")) {
      const b = req.postDataJSON();
      value = {
        id: crypto.randomUUID(),
        name: b.p_name,
        fields: b.p_fields,
        version: 1,
      };
      templates.push(value as Record<string, unknown>);
    } else if (path.endsWith("/api-keys"))
      value = {
        data: {
          id: crypto.randomUUID(),
          key: "al_live_ui-only-test-key",
          prefix: "al_live_ui",
        },
      };
    else if (path.includes("/auth/v1/user"))
      value = {
        id: "22222222-2222-4222-8222-222222222222",
        email: "test@example.invalid",
      };
    return route.fulfill({ status: 200, headers, body: JSON.stringify(value) });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Översikt" })).toBeVisible();
}
test("desktop workspace: draft, Freja selection, readiness block, fields, billing remains unconfigured", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("button", { name: "Nytt avtal", exact: true }).click();
  await page.getByLabel("Avtalets namn").fill("Samarbetsavtal");
  await page.getByRole("button", { name: "Skapa utkast" }).click();
  await expect(
    page.getByRole("heading", { name: "Samarbetsavtal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Till mottagare" }).click();
  await page.getByLabel("Namn", { exact: true }).fill("Testperson");
  await page
    .getByLabel("E-post", { exact: true })
    .fill("mottagare@example.invalid");
  await page
    .getByLabel("Signeringsmetod", { exact: true })
    .selectOption("freja");
  await page.getByRole("button", { name: "Lägg till mottagare" }).click();
  await expect(page.locator(".method-label")).toHaveText("Freja eID");
  await page.getByRole("button", { name: /Granska & skicka/ }).click();
  await expect(
    page.getByRole("button", { name: "Skicka för signering" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Freja eID är inte aktiverat för skarpa utskick."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mallar", exact: true }).click();
  await page.getByRole("button", { name: "Ny fältmall" }).click();
  await page.getByLabel("Mallnamn").fill("Kundavtal");
  await page.getByRole("button", { name: "Lägg till fält" }).click();
  await page.getByLabel("Etikett").fill("Kundens namn");
  await page.getByRole("button", { name: "Spara fältmall" }).click();
  await expect(page.getByText("Kundavtal", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Inställningar", exact: true })
    .click();
  await expect(
    page.getByText("Ingen betalning aktiverad", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Betalningsmodell och priser är ännu inte fastställda. Inga köp eller automatiska debiteringar sker.",
    ),
  ).toBeVisible();
});
test("responsive workspace has no horizontal page overflow and menu works", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Öppna meny" }).click();
  await page.getByRole("button", { name: "Avtal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alla avtal" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".verification/mobile-workspace.png",
    fullPage: true,
  });
});
test("login page and invalid signer link never fabricate signed status", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await page.screenshot({ path: ".verification/login.png", fullPage: true });
  await page.goto("/s/invalid-token");
  await expect(
    page.getByRole("heading", { name: "Signeringslänken kan inte öppnas" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Kontakta avsändaren för att kontrollera länken. Ingen underskrift har registrerats här.",
    ),
  ).toBeVisible();
});
test("desktop empty state uses real counts and provides a primary action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace(page);
  await expect(page.getByText("Inga avtal ännu")).toBeVisible();
  await page.screenshot({
    path: ".verification/desktop-workspace.png",
    fullPage: true,
  });
});

test("workspace operations: contacts, team guard and usage without billing", async ({
  page,
}) => {
  await workspace(page);
  await page
    .getByRole("button", { name: "Företag & team", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Företagets arbetsyta" }),
  ).toBeVisible();
  await page.getByLabel("Namn", { exact: true }).fill("Kontakt Anna");
  await page.getByLabel("E-post", { exact: true }).fill("anna@example.invalid");
  await page.getByLabel("Företag", { exact: true }).fill("Annas AB");
  await page.getByRole("button", { name: "Spara kontakt" }).click();
  await expect(page.getByText("Kontakt Anna", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Team", exact: true }).click();
  await expect(page.getByText("Du", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Användning", exact: true }).click();
  await page.getByRole("button", { name: "Visa användning" }).click();
  await expect(page.getByText(/Antalen är inte en faktura/)).toBeVisible();
  await page.getByRole("tab", { name: "Aktivitetslogg", exact: true }).click();
  await expect(
    page.getByText("Företag skapat", { exact: true }),
  ).toBeVisible();
});

test("recipient editing, ordering, removal and draft copying refresh the editor", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("button", { name: "Nytt avtal", exact: true }).click();
  await page.getByLabel("Avtalets namn").fill("Originalavtal");
  await page.getByRole("button", { name: "Skapa utkast" }).click();
  await page.getByRole("button", { name: "Till mottagare" }).click();
  for (const [name, email] of [
    ["Person Ett", "one@example.invalid"],
    ["Person Två", "two@example.invalid"],
  ]) {
    await page.getByLabel("Namn", { exact: true }).fill(name);
    await page.getByLabel("E-post", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Lägg till mottagare", exact: true })
      .click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Flytta upp Person Två", exact: true })
    .click();
  const first = page.locator(".list-row").filter({ hasText: "Person Två" });
  await expect(first.locator(".recipient-number")).toHaveText("1");
  await first.getByRole("button", { name: "Redigera", exact: true }).click();
  await first.getByLabel("Namn", { exact: true }).fill("Redigerad Person");
  await first
    .getByLabel("Signeringsmetod", { exact: true })
    .selectOption("freja");
  await first.getByRole("button", { name: "Spara mottagare" }).click();
  await expect(
    page.getByText("Redigerad Person", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".list-row")
    .filter({ hasText: "Person Ett" })
    .getByRole("button", { name: "Ta bort", exact: true })
    .click();
  await expect(page.getByText("Person Ett", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Kopiera till nytt utkast" }).click();
  await page.getByLabel("Nytt avtalsnamn").fill("Nytt kopierat avtal");
  await page.getByRole("button", { name: "Skapa kopia", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nytt kopierat avtal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Uppgifter/ }).click();
  await expect(page.getByLabel("Avtalets namn")).toHaveValue(
    "Nytt kopierat avtal",
  );
});

test("public recipient: document review and explicit approval, no account required", async ({
  page,
}) => {
  const { PDFDocument } = await import("pdf-lib");
  const { createHash } = await import("node:crypto");
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const bytes = await pdf.save(),
    hash = createHash("sha256").update(bytes).digest("hex");
  let approved = false;
  const recipient = "11111111-1111-4111-8111-111111111111",
    documentId = "22222222-2222-4222-8222-222222222222",
    fieldId = "33333333-3333-4333-8333-333333333333";
  await page.route(
    "**/functions/v1/avtalslank-api/v1/signer/**",
    async (route) => {
      const path = new URL(route.request().url()).pathname,
        body = route.request().postDataJSON();
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
        "content-type": "application/json",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      if (path.endsWith("/document"))
        return route.fulfill({
          status: 200,
          headers: { ...headers, "content-type": "application/pdf" },
          body: Buffer.from(bytes),
        });
      if (path.endsWith("/decide")) {
        expect(body.decision.consent).toBe(true);
        expect(body.decision.values[fieldId]).toBe("Anna Andersson");
        expect(body.decision.documentSetHash).toBe("a".repeat(64));
        approved = true;
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            data: { status: "signed", envelopeStatus: "finalizing" },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          data: {
            title: "Kundavtal",
            message: "Läs igenom avtalet.",
            status: "sent",
            snapshotHash: "a".repeat(64),
            expiresAt: "2099-01-01T00:00:00Z",
            waiting: false,
            recipient: {
              id: recipient,
              name: "Anna Andersson",
              method: "email_approval",
              status: "pending",
            },
            fields: [
              {
                id: fieldId,
                label: "Ditt namn",
                type: "text",
                required: true,
                page: 0,
                documentId,
              },
            ],
            documents: [
              { id: documentId, name: "kundavtal.pdf", sha256: hash },
            ],
          },
        }),
      });
    },
  );
  await page.goto("/s/#token=" + "f".repeat(64));
  await expect(
    page.getByRole("heading", { name: "Kundavtal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Godkänn avtal", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Öppna dokument" }).click();
  await expect(page.getByText("Öppnat", { exact: true })).toBeVisible();
  await page.getByLabel("Ditt namn *", { exact: true }).fill("Anna Andersson");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Godkänn avtal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ditt godkännande är registrerat." }),
  ).toBeVisible();
  expect(approved).toBe(true);
  await page.screenshot({
    path: ".verification/recipient-approved.png",
    fullPage: true,
  });
});
test("recipient cannot approve before predecessor; link errors do not reveal agreement", async ({
  page,
}) => {
  await page.route(
    "**/functions/v1/avtalslank-api/v1/signer/**",
    async (route) => {
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
        "content-type": "application/json",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      return route.fulfill({
        status: 400,
        headers,
        body: JSON.stringify({ error: { code: "INVALID_SIGNING_LINK" } }),
      });
    },
  );
  await page.goto("/s/" + "e".repeat(64));
  await expect(
    page.getByRole("heading", {
      name: "Signeringslänken kan inte öppnas",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Godkänn avtal", exact: true }),
  ).toHaveCount(0);
});

test("sender can recall a sent envelope through the connected API", async ({
  page,
}) => {
  await workspace(page);
  await page.route(
    `https://${ref}.supabase.co/rest/v1/rpc/al_capabilities`,
    (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          ["bankid", "freja", "email_approval", "drawn_signature"].map(
            (method) => ({
              method,
              enabled: method === "email_approval",
              reason: null,
            }),
          ),
        ),
      }),
  );
  await page.route(
    `https://${ref}.supabase.co/rest/v1/al_documents*`,
    (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
          "content-type": "application/json",
        },
        body: JSON.stringify([
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "contract.pdf",
            status: "ready",
            page_count: 1,
            storage_path: "synthetic/path",
            sha256: "a".repeat(64),
            byte_size: 1000,
          },
        ]),
      }),
  );
  let recalled = false;
  await page.route(
    "**/functions/v1/avtalslank-api/v1/envelopes/**/send*",
    (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: { status: "sent" } }),
      }),
  );
  await page.route(
    "**/functions/v1/avtalslank-api/v1/envelopes/**/cancel*",
    (route) => {
      recalled = true;
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type,apikey,x-client-info",
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: { status: "cancelled" } }),
      });
    },
  );
  await page.getByRole("button", { name: "Nytt avtal", exact: true }).click();
  await page.getByLabel("Avtalets namn").fill("Återkallat testavtal");
  await page.getByRole("button", { name: "Skapa utkast" }).click();
  await page.getByRole("button", { name: "Till mottagare" }).click();
  await page.getByLabel("Namn", { exact: true }).fill("Testperson");
  await page
    .getByLabel("E-post", { exact: true })
    .fill("person@example.invalid");
  await page
    .getByLabel("Signeringsmetod", { exact: true })
    .selectOption("email_approval");
  await page
    .getByRole("button", { name: "Lägg till mottagare", exact: true })
    .click();
  await page.getByRole("button", { name: /Granska & skicka/ }).click();
  await expect(
    page.getByRole("button", { name: "Skicka för signering", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Skicka för signering", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Återkalla utskick", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Återkalla utskick", exact: true })
    .click();
  await expect(page.getByText("Avbrutet", { exact: true })).toBeVisible();
  expect(recalled).toBe(true);
});
test('team invitation creates fragment-only link and revokes without email claim',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Företag & team',exact:true}).click();await page.getByRole('tab',{name:'Team',exact:true}).click();
 await page.getByLabel('E-post för inbjudan').fill('new@example.invalid');await page.getByRole('button',{name:'Skapa inbjudningslänk'}).click();
 await expect(page.getByLabel('Inbjudningslänk – visas bara nu')).toHaveValue(/\/join\/#token=a{64}$/);
 await page.getByRole('button',{name:'Återkalla inbjudan'}).click();await expect(page.getByText('Återkallad',{exact:true})).toBeVisible();
});
test('invitation landing keeps token out of request URL and submits only on acceptance',async({page})=>{
 await workspace(page);let accepted=false;
 await page.route('**/functions/v1/avtalslank-api/v1/team/accept',route=>{const b=route.request().postDataJSON();expect(b.token).toBe('b'.repeat(64));accepted=true;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_INVITATION'}})});});
 await page.goto('/join/#token='+'b'.repeat(64));await expect(page.getByRole('heading',{name:'Inbjudan till Avtalslänk'})).toBeVisible();expect(accepted).toBe(false);
 await page.getByRole('button',{name:'Acceptera inbjudan'}).click();await expect(page.getByRole('alert')).toContainText('annan verifierad e-postadress');expect(accepted).toBe(true);
});
test('account reauthentication, password confirmation and global signout use Auth endpoints',async({page})=>{
 await workspace(page);let reauth=false,changed=false,global=false;
 await page.route('**/auth/v1/reauthenticate',route=>{reauth=true;return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 await page.route('**/auth/v1/user',route=>{if(route.request().method()==='PUT'){const b=route.request().postDataJSON();expect(b.nonce).toBe('123456');expect(b.password).toBe('strong-test-password');changed=true;}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'22222222-2222-4222-8222-222222222222',email:'test@example.invalid'})});});
 await page.route('**/auth/v1/logout?scope=global',route=>{global=true;return route.fulfill({status:204});});
 await page.getByRole('button',{name:'Inställningar',exact:true}).click();await page.getByRole('button',{name:'Skicka verifieringskod',exact:true}).click();
 await expect(page.getByLabel('Verifieringskod från e-post')).toBeVisible();expect(reauth).toBe(true);await page.getByLabel('Verifieringskod från e-post').fill('123456');await page.getByLabel('Nytt lösenord',{exact:true}).fill('strong-test-password');await page.getByLabel('Bekräfta nytt lösenord').fill('different-password');await page.getByRole('button',{name:'Spara nytt lösenord'}).click();await expect(page.getByRole('status')).toContainText('stämmer inte');expect(changed).toBe(false);
 await page.getByLabel('Bekräfta nytt lösenord').fill('strong-test-password');await page.getByRole('button',{name:'Spara nytt lösenord'}).click();await expect(page.getByRole('status')).toContainText('Lösenordet är ändrat');expect(changed).toBe(true);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Logga ut från alla enheter'}).click();await expect(page.getByRole('heading',{name:'Logga in',exact:true})).toBeVisible();expect(global).toBe(true);
});
test('MFA enrollment sends challenge and code to Supabase, not application database',async({page})=>{
 await workspace(page);let verified=false;
 const user={id:'22222222-2222-4222-8222-222222222222',email:'test@example.invalid',factors:[{id:'factor-test',factor_type:'totp',status:'verified',friendly_name:'Avtalslänk'}]};
 await page.route('**/auth/v1/factors',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'factor-test',type:'totp',totp:{secret:'SYNTHETIC-SECRET',qr_code:'<svg xmlns="http://www.w3.org/2000/svg"/>'}})}));
 await page.route('**/auth/v1/factors/factor-test/challenge',route=>route.fulfill({status:200,contentType:'application/json',body:'{"id":"challenge-test"}'}));
 await page.route('**/auth/v1/factors/factor-test/verify',route=>{expect(route.request().postDataJSON()).toMatchObject({code:'123456',challenge_id:'challenge-test'});verified=true;const jwt=[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aal:'aal2',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'synthetic'].join('.');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:jwt,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user})});});
 await page.route('**/auth/v1/user',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(verified?user:{...user,factors:[]})}));
 await page.getByRole('button',{name:'Inställningar',exact:true}).click();await page.getByRole('button',{name:'Ställ in autentiseringsapp'}).click();await expect(page.getByLabel('Manuell inställningsnyckel')).toHaveValue('SYNTHETIC-SECRET');await page.getByLabel('Kod från autentiseringsappen').fill('123456');await page.getByRole('button',{name:'Verifiera kod'}).click();await expect(page.getByText('Autentiseringsapp är aktiverad.',{exact:false})).toBeVisible();expect(verified).toBe(true);
});
test('status filtering and operational health do not claim signing readiness',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();await page.getByLabel('Avtalets namn').fill('Filteravtal');await page.getByRole('button',{name:'Skapa utkast'}).click();await page.getByRole('button',{name:'Avtal',exact:true}).click();
 await expect(page.getByRole('button',{name:'Öppna Filteravtal',exact:true})).toBeVisible();await page.getByLabel('Filtrera avtal efter status',{exact:true}).selectOption('completed');await expect(page.getByRole('button',{name:'Öppna Filteravtal',exact:true})).toHaveCount(0);await page.getByLabel('Filtrera avtal efter status',{exact:true}).selectOption('draft');await expect(page.getByRole('button',{name:'Öppna Filteravtal',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Inställningar',exact:true}).click();await expect(page.getByText('Dokumentarbetare: Ingen aktuell beredskapssignal')).toBeVisible();await expect(page.getByText('Signeringsutskick: Inte konfigurerat')).toBeVisible();
});
test('sender reminder shows queue acceptance and cooldown errors',async({page})=>{
 const envelopeId='33333333-3333-4333-8333-333333333333',recipientId='55555555-5555-4555-8555-555555555555';
 await workspace(page,[{id:envelopeId,organization_id:org,title:'Pågående avtal',status:'sent',generation:1,sequential:false,expires_days:14,updated_at:new Date().toISOString()}],[{id:recipientId,name:'Testmottagare',email:'recipient@example.invalid',method:'email_approval',position:1,status:'pending'}]);
 let count=0;await page.route('**/envelopes/'+envelopeId+'/remind',route=>{expect(route.request().postDataJSON()).toMatchObject({organizationId:org,recipientId});count++;return route.fulfill({status:count===1?200:400,contentType:'application/json',body:JSON.stringify(count===1?{data:{queued:true,count:1}}:{error:{code:'REMINDER_COOLDOWN'}})});});
 await page.getByRole('button',{name:'Öppna Pågående avtal',exact:true}).click();await page.getByRole('button',{name:'Till mottagare'}).click();await page.getByRole('button',{name:'Skicka påminnelse'}).click();await expect(page.getByRole('status')).toContainText('utskickskön');await page.getByRole('button',{name:'Skicka påminnelse'}).click();await expect(page.getByRole('status')).toContainText('30 minuter');
});
