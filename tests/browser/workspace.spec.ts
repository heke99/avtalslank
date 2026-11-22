import { test, expect, type Page } from "@playwright/test";
const ref = "ykddnagtuacflilbchwx",
  org = "11111111-1111-4111-8111-111111111111";
async function workspace(page: Page, initialEnvelopes:Array<Record<string,unknown>>=[], initialRecipients:Array<Record<string,unknown>>=[], initialTemplates:Array<Record<string,unknown>>=[], initialDocuments:Array<Record<string,unknown>>=[]) {
  let envelopes: Array<Record<string, unknown>> = initialEnvelopes;
  let recipients: Array<Record<string, unknown>> = initialRecipients;
  let templates: Array<Record<string, unknown>> = initialTemplates;
  let contacts: Array<Record<string, unknown>> = [];
  let contactImports:any[]=[];
  let keys:any[]=[];let legalAccepted=false;let planState={plan:null as string|null,revision:0,canManage:true,updatedAt:null as string|null};
  let invitations: Array<Record<string, unknown>> = [];
  await page.addInitScript(
    ({ ref }) => {
      if (sessionStorage.getItem("al.ui.seeded")) return;
      sessionStorage.setItem("al.ui.seeded", "1");
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
    if(path.endsWith('/account/registration')) value={data:{profile:{kind:'company',fullName:'Testperson',organizationId:org,email:'test@example.invalid'},hasDraft:false,emailVerified:true}};
    else if(path.endsWith('/contacts/imports')){
      if(req.method()==='POST'){const b=req.postDataJSON();let receipt=contactImports.find(i=>i.requestId===b.requestId);if(!receipt){let created=0,skipped=0;for(const row of b.rows){if(contacts.some(c=>c.email===row.email))skipped++;else{contacts.push({...row,id:crypto.randomUUID(),version:1,archived:false});created++;}}receipt={requestId:b.requestId,createdAt:new Date().toISOString(),result:{requestId:b.requestId,total:b.rows.length,created,skipped,archivedSkipped:0}};contactImports.unshift(receipt);}value={data:receipt.result};}else value={data:contactImports};
    }else if(path.endsWith('/security/keys')){
      if(req.method()==='POST'){const b=req.postDataJSON();if(b.action==='revoke_all'){keys=keys.map(k=>({...k,revoked_at:new Date().toISOString()}));value={data:{count:keys.length}};}else{const old=keys.find(k=>k.id===b.id);if(old)old.revoked_at=new Date().toISOString();const k={id:crypto.randomUUID(),name:old?.name??b.name,prefix:'al_live_0123abcd',scopes:old?.scopes??b.scopes,expires_at:old?.expires_at??new Date(Date.now()+b.expiryDays*86400000).toISOString(),last_used_at:null,revoked_at:null,created_at:new Date().toISOString()};keys=[k,...keys];value={data:{...k,key:'al_live_ui-only-test-key'}};}}else value={data:keys};
    }else if(path.endsWith('/account/legal')){if(req.method()==='POST')legalAccepted=true;value={data:{document:{version:'2026-11-17',sha256:'a'.repeat(64),url:'/legal/2026-11-17/villkor.html'},accepted:legalAccepted,acceptedAt:legalAccepted?'2026-11-16T12:00:00Z':null,history:legalAccepted?[{version:'2026-11-17',sha256:'a'.repeat(64),acceptedAt:'2026-11-16T12:00:00Z'}]:[]}};
    }else if(path.endsWith('/plan-preference')){if(req.method()==='POST'){const b=req.postDataJSON();planState={...planState,plan:b.plan,revision:planState.revision+1,updatedAt:new Date().toISOString()};}value={data:planState};
    }else if(path.endsWith('/team/invitations')){
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
    } else if (path.endsWith("/al_usage_by_month"))
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
    else if (path.endsWith("/al_documents")) value = initialDocuments;
    else if (
      path.endsWith("/al_events") ||
      path.endsWith("/al_documents") ||
      path.endsWith("/al_api_keys")
    )
      value = [];
    else if (path.endsWith("/al_my_payment_status"))
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
        title: String(b.p_title).trim(),
        message: b.p_message ?? "",
        sequential: b.p_sequential ?? false,
        expires_days: b.p_expires_days ?? 14,
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
test("review saves a typed recipient and skips confirmation for free signing", async ({page})=>{
 await workspace(page);
 await page.route('**/rest/v1/rpc/al_capabilities',r=>r.fulfill({json:[{method:'email_approval',enabled:true}]}));
 await page.route('**/rest/v1/al_documents*',r=>r.fulfill({json:[{id:'doc',status:'ready',page_count:1,name:'test.pdf'}]}));
 await page.route('**/v1/envelopes/**/quote*',r=>r.fulfill({json:{data:{hash:'free',complimentary:true,totalOre:0}}}));
 await page.reload();
 await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();
 await page.getByLabel('Avtalets namn').fill('Direkt till granskning');
 await page.getByRole('button',{name:'Skapa avtal',exact:true}).click();
 await page.getByRole('button',{name:'Till mottagare'}).click();
 await page.getByLabel('Namn',{exact:true}).fill('Testmottagare');
 await page.getByLabel('E-post',{exact:true}).fill('signer@example.invalid');
 await page.getByRole('button',{name:'Gå till granskning'}).click();
 await expect(page.getByText('signer@example.invalid',{exact:true})).toBeVisible();
 await expect(page.getByText('Signering ingår utan kostnad.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Skicka för signering',exact:true})).toBeEnabled();
 await expect(page.getByLabel('Jag godkänner priset för detta utskick')).toHaveCount(0);
});

test("desktop workspace: draft, Freja selection, readiness block, fields, billing remains unconfigured", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("button", { name: "Nytt avtal", exact: true }).click();
  await page.getByLabel("Avtalets namn").fill("Samarbetsavtal");
  await page.getByRole("button", { name: "Skapa avtal" }).click();
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
    page.getByText("Freja eID är inte tillgängligt för ditt företag."),
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
      "Debitering startar efter en separat godkänd beställning.",
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
test("login actions work at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto("/login");
  const password = page.getByLabel("Lösenord", { exact: true });
  await password.fill("synthetic-password");
  await page.getByRole("button", { name: "Visa lösenord" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Dölj lösenord" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Glömt lösenordet?" }).click();
  await expect(page).toHaveURL(/\/login\?mode=reset$/);
  await expect(page.getByRole("heading", { name: "Återställ lösenord" })).toBeVisible();
  await page.getByRole("button", { name: "Tillbaka till inloggning" }).click();
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Skapa konto" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
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
      "Försök öppna sidan igen. Kontakta avsändaren om länken fortfarande inte fungerar.",
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
  await page.getByRole("button", { name: "Skapa avtal" }).click();
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
        expect(body.decision.identity).toEqual({name:"Anna Andersson",personalNumber:"199001010017"});
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
            status: approved ? "completed" : "sent",
            snapshotHash: "a".repeat(64),
            expiresAt: "2099-01-01T00:00:00Z",
            waiting: false,
            recipient: {
              id: recipient,
              name: "Anna Andersson",
              method: "email_approval",
              status: approved ? "signed" : "pending",
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
  await page.getByLabel("Fullständigt namn *",{exact:true}).fill("Anna Andersson");
  await page.getByLabel("Personnummer (ÅÅÅÅMMDDNNNN) *",{exact:true}).fill("199001010017");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Godkänn avtal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ditt godkännande är registrerat." }),
  ).toBeVisible();
  expect(approved).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Avtalet är färdigt",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Hämta bevisarkiv",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:"Hämta signerat kundavtal.pdf",exact:true})).toBeEnabled();
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
  await page.route('**/functions/v1/avtalslank-api/v1/envelopes/**/quote*',r=>r.fulfill({json:{data:{hash:'test-price-hash',documents:1,signers:1,unitOre:1000,totalOre:1000}}}));
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
  await page.reload();
  await page.getByRole("button", { name: "Nytt avtal", exact: true }).click();
  await page.getByLabel("Avtalets namn").fill("Återkallat testavtal");
  await page.getByRole("button", { name: "Skapa avtal" }).click();
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
  await expect(page.getByRole('button',{name:'Skicka för signering',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Hämta aktuellt signeringspris'}).click();
  await page.getByLabel('Jag godkänner priset för detta utskick').check();
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
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Logga ut från alla enheter'}).click();await expect(page.getByRole('heading',{name:'Logga in',exact:true})).toBeVisible();expect(global).toBe(true);expect(await page.evaluate(ref=>localStorage.getItem(`sb-${ref}-auth-token`),ref)).toBeNull();
});
test('status filtering and operational health do not claim signing readiness',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();await page.getByLabel('Avtalets namn').fill('Filteravtal');await page.getByRole('button',{name:'Skapa avtal'}).click();await page.getByRole('button',{name:'Avtal',exact:true}).click();
 await expect(page.getByRole('button',{name:'Öppna Filteravtal',exact:true})).toBeVisible();await page.getByLabel('Filtrera avtal efter status',{exact:true}).selectOption('completed');await expect(page.getByRole('button',{name:'Öppna Filteravtal',exact:true})).toHaveCount(0);await page.getByLabel('Filtrera avtal efter status',{exact:true}).selectOption('draft');await expect(page.getByRole('button',{name:'Öppna Filteravtal',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Inställningar',exact:true}).click();await expect(page.getByText('Dokumenthantering: Kontakta support')).toBeVisible();await expect(page.getByText('Signeringsutskick: Kontakta support')).toBeVisible();
});
test('sender reminder shows queue acceptance and cooldown errors',async({page})=>{
 const envelopeId='33333333-3333-4333-8333-333333333333',recipientId='55555555-5555-4555-8555-555555555555';
 await workspace(page,[{id:envelopeId,organization_id:org,title:'Pågående avtal',status:'sent',generation:1,sequential:false,expires_days:14,updated_at:new Date().toISOString()}],[{id:recipientId,name:'Testmottagare',email:'recipient@example.invalid',method:'email_approval',position:1,status:'pending'}]);
 let count=0;await page.route('**/envelopes/'+envelopeId+'/remind',route=>{expect(route.request().postDataJSON()).toMatchObject({organizationId:org,recipientId});count++;return route.fulfill({status:count===1?200:400,contentType:'application/json',body:JSON.stringify(count===1?{data:{queued:true,count:1}}:{error:{code:'REMINDER_COOLDOWN'}})});});
 await page.getByRole('button',{name:'Öppna Pågående avtal',exact:true}).click();await page.getByRole('button',{name:'Till mottagare'}).click();await page.getByRole('button',{name:'Skicka påminnelse'}).click();await expect(page.getByRole('status')).toContainText('utskickskön');await page.getByRole('button',{name:'Skicka påminnelse'}).click();await expect(page.getByRole('status')).toContainText('30 minuter');
});
test('workspace onboarding derives real counts, filters and exports only visible own-company agreements',async({page})=>{
 const rows=[{id:'33333333-3333-4333-8333-333333333331',organization_id:org,title:'Zebra',status:'draft',generation:1,updated_at:'2026-11-15T23:30:00Z'},{id:'33333333-3333-4333-8333-333333333332',organization_id:org,title:'Alfa',status:'completed',generation:1,updated_at:'2026-11-14T10:00:00Z'},{id:'33333333-3333-4333-8333-333333333333',organization_id:'99999999-9999-4999-8999-999999999999',title:'Hemligt',status:'draft',generation:1,updated_at:'2026-11-16T10:00:00Z'}];
 await workspace(page,rows);await expect(page.getByText('1 av 3 förberedelser klara',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Öppna första utkastet',exact:true}).click();await expect(page.getByRole('button',{name:'Öppna Hemligt',exact:true})).toHaveCount(0);await page.getByLabel('Sortera avtal').selectOption('title');await expect(page.locator('tbody .file-title').first()).toContainText('Alfa');await page.getByLabel('Uppdaterad från').fill('2026-11-16');await page.getByLabel('Uppdaterad till').fill('2026-11-16');await expect(page.getByRole('button',{name:'Öppna Alfa',exact:true})).toHaveCount(0);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Exportera visade avtal (CSV)',exact:true}).click();const download=await pending;const path=await download.path();const {readFile}=await import('node:fs/promises');const csv=await readFile(path!,'utf8');expect(csv).toContain('Zebra');expect(csv).not.toContain('Alfa');expect(csv).not.toContain('Hemligt');
 await page.getByLabel('Uppdaterad till').fill('2026-11-14');await expect(page.getByRole('alert')).toContainText('Fråndatum');await expect(page.getByRole('button',{name:'Exportera visade avtal (CSV)',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Rensa filter'}).click();await expect(page.getByRole('button',{name:'Öppna Alfa',exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.verification/mobile-agreements.png',fullPage:true});
});
test('unsaved draft changes block navigation until confirmed and Ctrl+S saves through the existing command',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();await page.getByLabel('Avtalets namn').fill('Skyddat utkast');await page.getByRole('button',{name:'Skapa avtal'}).click();await page.getByRole('button',{name:/Uppgifter/}).click();await page.getByLabel('Avtalets namn').fill('  Ändrat utkast  ');await expect(page.getByRole('status')).toContainText('Osparade ändringar');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Avtal',exact:true}).click();await expect(page.getByRole('heading',{name:'Skyddat utkast',exact:true})).toBeVisible();await page.keyboard.press('Control+s');await expect(page.getByRole('heading',{name:'Ändrat utkast',exact:true})).toBeVisible();await expect(page.getByRole('status')).toContainText('Ändringarna är sparade');await page.getByRole('button',{name:'Avtal',exact:true}).click();await expect(page.getByRole('button',{name:'Öppna Ändrat utkast',exact:true})).toBeVisible();
});
test('activity filtering searches localized and technical event names without claiming a complete archive',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Företag & team',exact:true}).click();await page.getByRole('tab',{name:'Aktivitetslogg',exact:true}).click();await expect(page.getByText('Företag skapat',{exact:true})).toBeVisible();await page.getByLabel('Sök i visade händelser').fill('ingen match');await expect(page.getByRole('status')).toContainText('Inga visade händelser');await page.getByLabel('Sök i visade händelser').fill('organization.created');await expect(page.getByText('Företag skapat',{exact:true})).toBeVisible();
});
test('invalid upload gives a specific PDF error and resets the upload state for retry',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();await page.getByLabel('Avtalets namn').fill('PDF-kontroll');await page.getByRole('button',{name:'Skapa avtal'}).click();await page.getByLabel('Ladda upp PDF').setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a pdf')});await expect(page.getByRole('alert')).toContainText('giltig PDF-fil');await expect(page.getByText('Välj en PDF att ladda upp',{exact:true})).toBeVisible();await expect(page.getByLabel('Ladda upp PDF')).toBeEnabled();
});

test('key creation, filtering, atomic rotation presentation and bulk revocation',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'API & integration',exact:true}).click();
 await expect(page.getByRole('button',{name:'Återkalla alla nycklar',exact:true})).toBeEnabled();
 await page.getByLabel('Nyckelnamn').fill('Lagersystem');await page.getByLabel('Giltighetstid').selectOption('30');await page.getByRole('button',{name:'Skapa API-nyckel',exact:true}).click();
 await expect(page.getByText('al_live_ui-only-test-key',{exact:true})).toBeVisible();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.verification/security-keys-desktop.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.verification/security-keys-mobile.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'Jag har sparat nyckeln'}).click();await expect(page.getByText('al_live_ui-only-test-key',{exact:true})).toHaveCount(0);
 await page.getByLabel('Sök nyckel').fill('saknas');await expect(page.getByRole('button',{name:'Byt nyckel',exact:true})).toHaveCount(0);await page.getByLabel('Sök nyckel').fill('Lager');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Byt nyckel',exact:true}).click();await expect(page.getByText('al_live_ui-only-test-key',{exact:true})).toBeVisible();await page.getByLabel('Nyckelstatus').selectOption('revoked');await expect(page.locator('.list-row small').filter({hasText:'Återkallad'})).toBeVisible();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Återkalla alla nycklar',exact:true}).click();await page.getByLabel('Nyckelstatus').selectOption('active');await expect(page.getByRole('button',{name:'Byt nyckel',exact:true})).toHaveCount(0);
});
test('terms acceptance is explicit, versioned and separate from plan interest and payment',async({page})=>{
 let legalPosts=0,planPosts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/account/legal'))legalPosts++;if(r.method()==='POST'&&r.url().includes('/plan-preference'))planPosts++;});
 await workspace(page);await page.getByRole('button',{name:'Inställningar',exact:true}).click();await expect(page.getByRole('button',{name:'Acceptera kontovillkor'})).toBeDisabled();expect(legalPosts).toBe(0);
 await expect(page.getByRole('link',{name:'Läs kontovillkor, version 2026-11-17'})).toHaveAttribute('href','/legal/2026-11-17/villkor.html');await page.getByLabel('Jag accepterar kontovillkoren för mitt konto.').check();await page.getByRole('button',{name:'Acceptera kontovillkor'}).click();await expect(page.getByText(/^Accepterade /)).toBeVisible();expect(legalPosts).toBe(1);
 await page.getByText('Historik över accepterade villkor',{exact:true}).click();await expect(page.getByText('SHA-256:',{exact:false})).toBeVisible();await page.getByLabel('Upplägg',{exact:true}).selectOption('api');await page.getByRole('button',{name:'Spara planintresse'}).click();await expect(page.getByText('Senast sparat',{exact:false})).toBeVisible();expect(planPosts).toBe(1);await expect(page.getByText('Ingen betalning aktiverad',{exact:true})).toBeVisible();
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.verification/account-controls.png',fullPage:true,animations:'disabled'});
});
test('webhook secret replacement requires disabled connection and remains a one-time display',async({page})=>{
 await workspace(page);let active=true,blocked=true;
 await page.route(`https://${ref}.supabase.co/rest/v1/al_webhook_endpoints*`,r=>r.fulfill({json:[{id:'55555555-5555-4555-8555-555555555555',url:'https://example.com/customer-hook',active}]}));
 await page.route(`https://${ref}.supabase.co/functions/v1/avtalslank-api/v1/webhooks`,r=>{active=r.request().postDataJSON().active;return r.fulfill({json:{data:{id:'55555555-5555-4555-8555-555555555555'}}});});
 await page.route(`https://${ref}.supabase.co/functions/v1/avtalslank-api/v1/security/webhook-rotate`,r=>blocked?r.fulfill({status:400,json:{error:{code:'WEBHOOK_DELIVERIES_PENDING',message:'WEBHOOK_DELIVERIES_PENDING'}}}):r.fulfill({json:{data:{rotated:true,secret:'b'.repeat(64)}}}));
 await page.getByRole('button',{name:'API & integration',exact:true}).click();await expect(page.getByRole('button',{name:'Byt hemlighet',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Stäng av',exact:true}).click();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Byt hemlighet',exact:true}).click();await expect(page.getByRole('alert')).toContainText('pågående eller osäkra leveranser');
 blocked=false;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Byt hemlighet',exact:true}).click();await expect(page.getByText('b'.repeat(64),{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Aktivera',exact:true})).toBeVisible();await page.getByRole('button',{name:'Jag har sparat hemligheten'}).click();await expect(page.getByText('b'.repeat(64),{exact:true})).toHaveCount(0);expect(active).toBe(false);
});

const editorEnvelopeId='aaaa1111-1111-4111-8111-111111111111',editorRecipientId='bbbb2222-2222-4222-8222-222222222222',editorDocId='cccc3333-3333-4333-8333-333333333333';
const editorTemplate={id:'dddd4444-4444-4444-8444-444444444444',name:'Kunduppgifter',version:3,fields:[{id:'source-field',label:'Kundnamn',type:'text',recipientRole:'Kund',required:false,page:0,x:0.1,y:0.2,width:0.3,height:0.05}]};
async function editorWorkspace(page:Page){
 const envelope={id:editorEnvelopeId,organization_id:org,title:'Mallavtal',message:'',status:'draft',generation:1,sequential:false,expires_days:14,updated_at:new Date().toISOString()};let saved:any[]=[];let generation=1;
 const doc={id:editorDocId,name:'avtal.pdf',status:'ready',page_count:2,storage_path:org+'/'+editorEnvelopeId+'/'+editorDocId+'/original.pdf',byte_size:100};
 await workspace(page,[envelope],[{id:editorRecipientId,name:'Mottagaren',email:'recipient@example.invalid',method:'email_approval',position:1,status:'pending'}],[editorTemplate],[doc]);
 await page.route('**/v1/envelopes/'+editorEnvelopeId+'/prepare*',r=>r.fulfill({json:{data:{envelope:{...envelope,generation,fields:saved}}}}));
 await page.route('**/v1/envelopes/'+editorEnvelopeId+'/fields*',r=>{const b=r.request().postDataJSON();expect(b.generation).toBe(generation);saved=b.fields;generation++;return r.fulfill({json:{data:{...envelope,generation,fields:saved}}});});
 const {PDFDocument}=await import('pdf-lib');const pdf=await PDFDocument.create();pdf.addPage([600,800]);pdf.addPage([600,800]);const bytes=Buffer.from(await pdf.save());await page.route('**/storage/v1/object/al-documents/**',r=>r.fulfill({contentType:'application/pdf',body:bytes}));
 await page.getByRole('button',{name:'Öppna Mallavtal',exact:true}).click();await page.getByRole('button',{name:/Uppgifter/}).click();return{saved:()=>saved};
}
test("new fields can be placed on the second page of a rendered PDF", async ({ page }) => {
  const state = await editorWorkspace(page);
  await page.getByLabel("PDF-sida", { exact: true }).selectOption("1");
  const canvas = page.getByLabel("PDF-sida 2", { exact: true });
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "Lägg till dokumentfält" }).click();
  await expect(page.getByLabel("Fält att placera")).not.toHaveValue("");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.25, y: box.height * 0.6 } });
  await page.getByRole("button", { name: "Spara dokumentfält", exact: true }).click();
  await expect.poll(() => state.saved().length).toBe(1);
  expect(state.saved()[0]).toMatchObject({ page: 1, documentId: editorDocId, recipientId: editorRecipientId });
  expect(state.saved()[0].x).toBeCloseTo(0.25, 2);
  expect(state.saved()[0].y).toBeCloseTo(0.6, 2);
});

test('template search and editor persist roles, required flags and page geometry',async({page})=>{
 await workspace(page,[],[],[editorTemplate,{...editorTemplate,id:'eeee5555-5555-4555-8555-555555555555',name:'Årsuppgifter',version:1}]);await page.getByRole('button',{name:'Mallar',exact:true}).click();await page.getByLabel('Sök fältmall').fill('finns inte');await expect(page.getByText('Inga fältmallar matchar sökningen.')).toBeVisible();await page.getByLabel('Sök fältmall').fill('Kunduppgifter');await expect(page.locator('.template-row')).toHaveCount(1);await page.getByLabel('Sortera fältmallar').selectOption('version');await page.locator('.template-row').click();
 const dialog=page.getByRole('dialog',{name:'Redigera fältmall'});await dialog.getByLabel('Mottagarroll för fält 1').fill('Firmatecknare');await dialog.getByLabel('Obligatoriskt fält').check();await dialog.getByLabel('Sida',{exact:true}).fill('2');await dialog.getByLabel('x för mallfält 1').fill('25');
 await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:'.verification/template-editor-desktop.png',animations:'disabled'});await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:'.verification/template-editor-mobile.png',animations:'disabled'});
 let payload:any;page.on('request',r=>{if(r.url().endsWith('/al_save_template'))payload=r.postDataJSON();});await dialog.getByRole('button',{name:'Spara fältmall',exact:true}).click();await expect(dialog).toHaveCount(0);expect(payload.p_fields[0]).toMatchObject({recipientRole:'Firmatecknare',required:true,page:1,x:0.25});expect(payload.p_version).toBe(3);
});
test('template application requires role mapping, preserves changes until saved and submits the actual copied fields',async({page})=>{
 const state=await editorWorkspace(page);await page.getByLabel('Fältmall att använda').selectOption(editorTemplate.id);await page.getByLabel('Mallens måldokument').selectOption(editorDocId);await page.getByRole('button',{name:'Lägg in mallens fält'}).click();await expect(page.getByRole('alert')).toContainText('Välj en mottagare för varje roll');await page.getByLabel('Mottagare för Kund').selectOption(editorRecipientId);await page.getByRole('button',{name:'Lägg in mallens fält'}).click();await expect(page.getByRole('button',{name:'Spara och granska'})).toBeDisabled();
 page.once('dialog',d=>d.dismiss());await page.locator('.steps button').nth(0).click();await expect(page.getByRole('button',{name:'Spara dokumentfält',exact:true})).toBeVisible();await page.getByRole('button',{name:'Spara dokumentfält',exact:true}).click();await expect(page.getByRole('button',{name:'Spara och granska'})).toBeEnabled();expect(state.saved()).toHaveLength(1);expect(state.saved()[0]).toMatchObject({documentId:editorDocId,recipientId:editorRecipientId,label:'Kundnamn',required:false});expect(state.saved()[0].id).not.toBe('source-field');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.verification/template-application.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.verification/template-application-mobile.png',fullPage:true,animations:'disabled'});
});
test('selected canvas field supports keyboard placement and copies with new ID while preserving the first field',async({page})=>{
 const state=await editorWorkspace(page);await page.getByLabel('Fältmall att använda').selectOption(editorTemplate.id);await page.getByLabel('Mallens måldokument').selectOption(editorDocId);await page.getByLabel('Mottagare för Kund').selectOption(editorRecipientId);await page.getByRole('button',{name:'Lägg in mallens fält'}).click();await page.getByRole('button',{name:'Kopiera dokumentfält',exact:true}).click();await page.getByLabel('Dokument att förhandsvisa',{exact:false}).selectOption(editorDocId);const select=page.getByLabel('Fält att placera');await expect(select.locator('option')).toHaveCount(3);const second=await select.locator('option').nth(2).getAttribute('value');await select.selectOption(second!);await expect(page.getByLabel('PDF-sida 1',{exact:true})).toBeVisible();await page.getByRole('group',{name:'Positionsyta för valt fält'}).press('ArrowRight');await page.getByRole('button',{name:'Spara dokumentfält',exact:true}).click();expect(state.saved()).toHaveLength(2);expect(state.saved()[0].x).toBe(0.1);expect(state.saved()[1].x).toBe(0.13);expect(state.saved()[0].id).not.toBe(state.saved()[1].id);
});
test('draft validity is editable, bounded and sent through the versioned draft command',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();await page.getByLabel('Avtalets namn').fill('Giltighetsavtal');await page.getByRole('button',{name:'Skapa avtal'}).click();await page.getByRole('button',{name:/Uppgifter/}).click();await page.getByLabel('Giltighetstid efter utskick (dagar)').fill('91');await page.getByRole('button',{name:'Spara och granska'}).click();await expect(page.getByLabel('Giltighetstid efter utskick (dagar)')).toBeVisible();let days:number|undefined;page.on('request',r=>{if(r.url().endsWith('/al_save_draft'))days=r.postDataJSON().p_expires_days;});await page.getByLabel('Giltighetstid efter utskick (dagar)').fill('30');await page.getByRole('button',{name:'Spara och granska'}).click();await expect(page.getByText('30 dagar',{exact:true})).toBeVisible();expect(days).toBe(30);
});
test('CSV mapping, preview, confirmation, filtered export and import history work without emails',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Företag & team',exact:true}).click();let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/contacts/imports'))posts++;});
 await page.getByLabel('CSV-fil med kontakter').setInputFiles({name:'kontakter.csv',mimeType:'text/csv',buffer:Buffer.from('Företag;E-post;Namn\nAcme;anna@example.invalid;Anna\nBeta;bea@example.invalid;Bea')});await expect(page.getByRole('heading',{name:'Förhandsgranskning – 2 kontakter'})).toBeVisible();expect(posts).toBe(0);await page.getByRole('button',{name:'Bekräfta kontaktimport'}).click();await expect(page.getByRole('status')).toContainText('Import klar: 2 nya');expect(posts).toBe(1);await expect(page.getByRole('button',{name:'Bekräfta kontaktimport'})).toBeDisabled();
 await page.getByLabel('Sök kontakt').fill('Anna');await expect(page.getByRole('button',{name:'Exportera visade kontakter (1)'})).toBeEnabled();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportera visade kontakter (1)'}).click();expect((await download).suggestedFilename()).toBe('avtalslank-kontakter.csv');await page.getByRole('button',{name:'Hämta importhistorik'}).click();await expect(page.getByText('2 nya, 0 överhoppade',{exact:false})).toBeVisible();
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.verification/contact-import-desktop.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const preview=page.getByRole('region',{name:'Förhandsgranskning av kontaktimport'});expect(await preview.locator('td').nth(2).evaluate(el=>getComputedStyle(el).display)).toBe('table-cell');await page.screenshot({path:'.verification/contact-import-mobile.png',fullPage:true,animations:'disabled'});
});
test('invalid CSV and duplicate email keep import disabled and oversized selection clears old preview',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Företag & team',exact:true}).click();await page.getByLabel('CSV-fil med kontakter').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('Namn;E-post\nAnna;a@example.invalid\nBea;A@example.invalid')});await expect(page.getByText('Dubblett av e-post i filen.')).toBeVisible();await expect(page.getByRole('button',{name:'Bekräfta kontaktimport'})).toBeDisabled();
 await page.getByLabel('CSV-fil med kontakter').setInputFiles({name:'large.csv',mimeType:'text/csv',buffer:Buffer.alloc(262145,65)});await expect(page.getByRole('alert')).toContainText('högst 256 KB');await expect(page.getByRole('button',{name:'Bekräfta kontaktimport'})).toHaveCount(0);
});
test('unknown import response retains the same request reference for manual retry',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Företag & team',exact:true}).click();const ids:string[]=[];await page.route('**/v1/contacts/imports',route=>{if(route.request().method()!=='POST')return route.fallback();ids.push(route.request().postDataJSON().requestId);if(ids.length===1)return route.abort('failed');return route.fulfill({json:{data:{requestId:ids[0],created:1,skipped:0,archivedSkipped:0}}});});await page.getByLabel('CSV-fil med kontakter').setInputFiles({name:'retry.csv',mimeType:'text/csv',buffer:Buffer.from('Namn;E-post\nAnna;retry@example.invalid')});await page.getByRole('button',{name:'Bekräfta kontaktimport'}).click();await expect(page.getByRole('alert')).toContainText('Anslutningen avbröts');expect(ids).toHaveLength(1);await page.getByRole('button',{name:'Bekräfta kontaktimport'}).click();await expect(page.getByRole('status')).toContainText('Import klar: 1 nya');expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
});
test('verified signup completes its private server draft once and selects the returned workspace',async({page})=>{
 await workspace(page);let complete=0;
 await page.route('**/functions/v1/avtalslank-api/v1/account/registration',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type,apikey,x-client-info','content-type':'application/json'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const profile={kind:'company',fullName:'Testperson',organizationId:org,email:'test@example.invalid'};
  if(route.request().method()==='POST'){complete++;expect(route.request().postDataJSON()).toEqual({organizationId:null});return route.fulfill({status:200,headers,body:JSON.stringify({data:profile})});}
  return route.fulfill({status:200,headers,body:JSON.stringify({data:{profile:complete?profile:null,hasDraft:!complete,emailVerified:true}})});
 });
 await page.goto('/app');await expect(page.getByRole('button',{name:'Översikt',exact:true})).toBeVisible();expect(complete).toBe(1);
 await page.reload();await expect(page.getByRole('button',{name:'Översikt',exact:true})).toBeVisible();expect(complete).toBe(1);
});

test('platform admin lists companies, audits API suspension and denies ordinary accounts',async({page})=>{
 await workspace(page);let allowed=true;const commands:any[]=[];
 await page.route('**/rest/v1/rpc/al_platform',route=>{const p=route.request().postDataJSON();commands.push(p);if(p.p_action==='status')return route.fulfill({json:{admin:allowed,mfa:false}});if(p.p_action==='list')return route.fulfill({json:[{id:org,name:'Bolag A',kind:'company',registration_number:'5568554884',members:1}]});if(p.p_action==='detail')return route.fulfill({json:{organization:{id:org,name:'Bolag A'},members:[],agreements:[],entitlement:null,audit:[]}});return route.fulfill({json:{ok:true}});});
 await page.goto('/admin');await expect(page.getByRole('heading',{name:'Plattformsadministration'})).toBeVisible();await page.screenshot({path:'.verification/platform-admin-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect(page.getByRole('link',{name:'Till arbetsytan'})).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Öppna Bolag A'}).click();await page.screenshot({path:'.verification/platform-admin-mobile.png',fullPage:true});await page.getByLabel('Anledning till ändring').fill('Supportärende om API-spärr');await page.getByRole('button',{name:'Spärra API',exact:true}).click();await expect.poll(()=>commands.some(p=>p.p_action==='suspend_api'&&p.p_org===org&&p.p_payload.suspended===true)).toBe(true);
 allowed=false;await page.reload();await expect(page.getByText('Du saknar plattformsbehörighet.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Spärra API',exact:true})).toHaveCount(0);
});

test('superadmin saves integer-ore price version and publishes separately',async({page})=>{
 await workspace(page);let items:any[]=[];const changes:any[]=[];
 await page.route('**/rest/v1/rpc/al_platform',r=>{const p=r.request().postDataJSON();return r.fulfill({json:p.p_action==='status'?{admin:true,mfa:true}:[]});});
 await page.route('**/rest/v1/rpc/al_platform_commercial',r=>{const p=r.request().postDataJSON();if(p.p_action==='catalog')return r.fulfill({json:items});if(p.p_action==='overview')return r.fulfill({json:{organizations:2,users:3,agreements:4,completed:1,paidApi:0,failedJobs:0}});changes.push(p);if(p.p_action==='save_price')items=[{code:p.p_payload.code,revision:1,latest:1,published:null,active:true,id:'price-test',terms:p.p_payload.terms}];if(p.p_action==='publish_price')items=[{...items[0],published:1,revision:2}];return r.fulfill({json:{ok:true}});});
 await page.goto('/admin');await page.getByText('Priser och paket',{exact:true}).click();await page.getByLabel('Paketkod',{exact:true}).fill('api');await page.getByLabel('Paketnamn',{exact:true}).fill('API Test');await page.getByLabel('Fast pris, kr',{exact:true}).fill('199,50');await page.getByLabel('Anledning till prisändring',{exact:true}).fill('Nytt paket för kontroll');await page.getByRole('button',{name:'Spara prisversion',exact:true}).click();await expect(page.getByRole('status')).toContainText('Ny prisversion sparad');expect(changes[0].p_payload.terms.baseOre).toBe(19950);expect(changes.some(c=>c.p_action==='publish_price')).toBe(false);
 page.once('dialog',d=>d.accept('Publicera kontrollerat paket'));await page.getByRole('button',{name:'Publicera API Test',exact:true}).click();await expect(page.getByRole('status')).toContainText('Prisversionen är publicerad');expect(changes.at(-1).p_payload.revision).toBe(1);
});

test('signed agreement search uses server cursor and signer metadata',async({page})=>{
 await workspace(page);let queries:string[]=[];
 await page.route('**/functions/v1/avtalslank-api/v1/signed-search**',r=>{const u=new URL(r.request().url());queries.push(u.searchParams.get('query')??'');const next=!!u.searchParams.get('cursor');return r.fulfill({json:{data:{items:[{id:next?'33333333-3333-4333-8333-333333333333':'44444444-4444-4444-8444-444444444444',title:next?'Andra signerade avtalet':'Första signerade avtalet',company:'Kundbolaget',finalized_at:'2026-11-17T08:00:00Z',signers:[{name:'Signerad Person',email:'signed@example.invalid',company:'Kundbolaget',registrationNumber:'5568554884'}]}],nextCursor:next?null:'44444444-4444-4444-8444-444444444444'}}});});
 await page.goto('/');await page.getByRole('button',{name:'Avtal',exact:true}).click();await page.getByLabel('Namn, företag, organisationsnummer eller e-post').fill('signed@example.invalid');await page.getByRole('button',{name:'Sök signerade avtal',exact:true}).click();await expect(page.getByText('Första signerade avtalet',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Visa fler signerade avtal'}).click();await expect(page.getByText('Andra signerade avtalet',{exact:true})).toBeVisible();expect(queries).toEqual(['signed@example.invalid','signed@example.invalid']);
});

test('returning user gets account recovery instead of a permanent registration spinner',async({page})=>{
 await workspace(page);let broken=true;await page.route('**/functions/v1/avtalslank-api/v1/account/registration**',r=>broken?r.fulfill({status:503,json:{error:{code:'REQUEST_FAILED'}}}):r.fulfill({json:{data:{profile:{kind:'company',organizationId:org},hasDraft:false,emailVerified:true}}}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Kontot kunde inte öppnas'})).toBeVisible();await expect(page.getByRole('button',{name:'Spara kontouppgifter'})).toHaveCount(0);broken=false;await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await expect(page.getByRole('button',{name:'Nytt avtal',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Nytt avtal',exact:true})).toBeVisible();
});

test('account loading times out visibly and can recover without registering a second workspace',async({page})=>{
 await workspace(page);await page.clock.install();let requested=false;let hang=true;
 await page.route('**/functions/v1/avtalslank-api/v1/account/registration**',async r=>{requested=true;if(hang)return new Promise<void>(()=>{});return r.fulfill({json:{data:{profile:{kind:'company',organizationId:org},hasDraft:false,emailVerified:true}}});});
 await page.goto('/');await expect.poll(()=>requested).toBe(true);await page.clock.fastForward(21000);await expect(page.getByRole('heading',{name:'Kontot kunde inte öppnas'})).toBeVisible();await expect(page.getByRole('button',{name:'Spara kontouppgifter'})).toHaveCount(0);hang=false;await page.getByRole('button',{name:'Försök igen',exact:true}).click();await expect(page.getByRole('button',{name:'Nytt avtal',exact:true})).toBeVisible();
});

test('registration data conflicts remain editable instead of being treated as network failures',async({page})=>{
 await workspace(page);await page.route('**/functions/v1/avtalslank-api/v1/account/registration**',r=>r.request().method()==='POST'?r.fulfill({status:400,json:{error:{code:'COMPANY_ALREADY_REGISTERED'}}}):r.fulfill({json:{data:{profile:null,hasDraft:true,emailVerified:true}}}));await page.goto('/');await expect(page.getByRole('heading',{name:'Komplettera ditt konto'})).toBeVisible();await expect(page.getByLabel('Bolagsnamn',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Spara kontouppgifter'})).toBeVisible();
});

test("workspace opens for password sessions with a previously enrolled factor", async ({ page }) => {
  await workspace(page);
  await page.evaluate(ref => {
    const key = `sb-${ref}-auth-token`;
    const session = JSON.parse(localStorage.getItem(key)!);
    session.user.factors = [{ id: "factor-previous", status: "verified", factor_type: "totp" }];
    localStorage.setItem(key, JSON.stringify(session));
  }, ref);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Översikt" })).toBeVisible();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kontosäkerhet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tvåstegsverifiering" })).toHaveCount(0);
});

 test('webhook read timeout shows recovery without creating another endpoint',async({page})=>{
 await workspace(page);await page.clock.install();let requested=false,hang=true;
 await page.route('**/rest/v1/al_webhook_endpoints*',r=>{requested=true;if(hang)return new Promise<void>(()=>{});return r.fulfill({json:[{id:'hook',url:'https://example.com/recovered',active:true}]});});
 await page.getByRole('button',{name:'API & integration',exact:true}).click();await expect.poll(()=>requested).toBe(true);await page.clock.fastForward(13000);await expect(page.getByRole('alert')).toContainText('Begäran tog för lång tid');hang=false;await page.getByRole('button',{name:'Hämta webhooklista igen'}).click();await expect(page.getByText('https://example.com/recovered',{exact:true})).toBeVisible();
 });
 test('workspace switch clears a one-time API secret and ignores late key responses',async({page})=>{
 await workspace(page);const second='99999999-9999-4999-8999-999999999999';
 await page.route('**/rest/v1/al_organizations*',r=>r.fulfill({json:[{id:org,name:'Bolag A'},{id:second,name:'Bolag B'}]}));await page.reload();
 await page.getByRole('button',{name:'API & integration',exact:true}).click();await page.getByLabel('Nyckelnamn').fill('Första bolagets nyckel');await page.getByRole('button',{name:'Skapa API-nyckel',exact:true}).click();await expect(page.getByText('al_live_ui-only-test-key',{exact:true})).toBeVisible();
 let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);let pending=false;
 await page.route('**/v1/security/keys**',async r=>{if(r.request().method()!=='GET')return r.fallback();if(new URL(r.request().url()).searchParams.get('organizationId')===second)return r.fulfill({json:{data:[]}});pending=true;await wait;return r.fulfill({json:{data:[{id:'late',name:'Sent svar från Bolag A',prefix:'al_test',scopes:[],expires_at:null,revoked_at:null,last_used_at:null}]}});});
 // Existing key isolation must remain intact while read timeouts change.
 await page.getByRole('button',{name:'Företag & team',exact:true}).click();await page.getByRole('button',{name:'API & integration',exact:true}).click();await expect.poll(()=>pending).toBe(true);await page.getByLabel('Aktivt företag').selectOption(second);release();await expect(page.getByText('al_live_ui-only-test-key',{exact:true})).toHaveCount(0);await expect(page.getByText('Sent svar från Bolag A',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Skapa API-nyckel',exact:true})).toBeEnabled();
 });

test('price offer from the previous workspace disappears while the new offer loads',async({page})=>{
 await workspace(page);const second='99999999-9999-4999-8999-999999999999';
 await page.route('**/rest/v1/al_organizations*',r=>r.fulfill({json:[{id:org,name:'Bolag A'},{id:second,name:'Bolag B'}]}));
 let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);let pending=false;
 await page.route('**/rest/v1/rpc/al_my_commercial',async r=>{const isSecond=r.request().postDataJSON().p_org===second;if(isSecond){pending=true;await wait;}return r.fulfill({json:{reference:'test',snapshot:{name:isSecond?'Bolag B:s pris':'Bolag A:s pris',baseOre:1000,documentOre:0,includedDocuments:0,bindingMonths:0,noticeMonths:0}}});});
 await page.reload();await page.getByRole('button',{name:'Inställningar',exact:true}).click();await expect(page.getByText('Bolag A:s pris',{exact:true})).toBeVisible();await page.getByLabel('Aktivt företag').selectOption(second);await expect.poll(()=>pending).toBe(true);await expect(page.getByText('Bolag A:s pris',{exact:true})).toHaveCount(0);release();await expect(page.getByText('Bolag B:s pris',{exact:true})).toBeVisible();
});

test('unanswered draft mutation releases the form without automatically resubmitting',async({page})=>{
 await workspace(page);await page.clock.install();let submissions=0;
 await page.route('**/rest/v1/rpc/al_save_draft',r=>{submissions++;return new Promise<void>(()=>{});});
 await page.getByRole('button',{name:'Nytt avtal',exact:true}).click();await page.getByLabel('Avtalets namn').fill('Obesvarat utkast');await page.getByRole('button',{name:'Skapa avtal',exact:true}).click();await expect.poll(()=>submissions).toBe(1);await page.clock.fastForward(13000);await expect(page.getByRole('alert')).toContainText('Kontrollera resultatet innan du försöker igen');await expect(page.getByRole('button',{name:'Skapa avtal',exact:true})).toBeEnabled();await page.clock.fastForward(30000);expect(submissions).toBe(1);await expect(page.getByLabel('Avtalets namn')).toHaveValue('Obesvarat utkast');
});

test('contact and team loading timeout releases unrelated workspace controls',async({page})=>{
 await workspace(page);await page.clock.install();let requested=false;
 await page.route('**/rest/v1/al_contacts*',r=>{requested=true;return new Promise<void>(()=>{});});await page.getByRole('button',{name:'Företag & team',exact:true}).click();await expect.poll(()=>requested).toBe(true);await page.clock.fastForward(13000);await expect(page.getByRole('alert')).toContainText('Begäran tog för lång tid');await page.getByRole('button',{name:'Översikt',exact:true}).click();await expect(page.getByRole('button',{name:'Nytt avtal',exact:true})).toBeEnabled();
});

test('returning to the same workspace ignores an older agreement response',async({page})=>{
 await workspace(page);const second='99999999-9999-4999-8999-999999999999';await page.route('**/rest/v1/al_organizations*',r=>r.fulfill({json:[{id:org,name:'Bolag A'},{id:second,name:'Bolag B'}]}));
 let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);let first=true,pending=false;
 await page.route('**/rest/v1/al_envelopes*',async r=>{const old=first;first=false;const requested=new URL(r.request().url()).searchParams.get('organization_id')?.slice(3)??org;if(old){pending=true;await wait;}return r.fulfill({json:requested===org?[{id:'33333333-3333-4333-8333-333333333331',organization_id:org,title:old?'Gammalt avtalssvar':'Aktuellt avtalssvar',status:'draft',generation:1,updated_at:'2026-11-17T10:00:00Z'}]:[]});});
 await page.reload();await expect.poll(()=>pending).toBe(true);await page.getByLabel('Aktivt företag').selectOption(second);await page.getByLabel('Aktivt företag').selectOption(org);await expect(page.getByText('Aktuellt avtalssvar',{exact:true})).toBeVisible();release();await expect(page.getByText('Gammalt avtalssvar',{exact:true})).toHaveCount(0);await expect(page.getByText('Aktuellt avtalssvar',{exact:true})).toBeVisible();
});

test('delivery read errors clear after recovery and never imply no deliveries',async({page})=>{
 await editorWorkspace(page);let broken=true;
 const delivery=page.locator('section').filter({has:page.getByRole('heading',{name:'Leveranser och slutdokument',exact:true})}).filter({has:page.getByRole('button',{name:'Uppdatera leveransstatus',exact:true})}).last();
 await page.route('**/v1/envelopes/'+editorEnvelopeId+'/deliveries*',r=>broken?r.fulfill({status:400,json:{error:{code:'ACCESS_DENIED'}}}):r.fulfill({json:{data:[{id:'delivery',kind:'invitation',status:'completed'}]}}));
 await page.getByRole('button',{name:'Uppdatera leveransstatus'}).click();await expect(delivery.getByRole('alert')).toBeVisible();await expect(page.getByText('Inga utskick registrerade.',{exact:true})).toHaveCount(0);broken=false;await page.getByRole('button',{name:'Uppdatera leveransstatus'}).click();await expect(page.getByText('Signeringsinbjudan',{exact:true})).toBeVisible();await expect(delivery.getByRole('alert')).toHaveCount(0);
});

test('a late signing price from an older generation is discarded',async({page})=>{
 await editorWorkspace(page);let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);let calls=0;
 await page.route('**/v1/envelopes/'+editorEnvelopeId+'/quote*',async r=>{
  if(++calls>1)return r.fulfill({status:409,json:{error:{code:'PRICE_CHANGED'}}});
  await wait;return r.fulfill({json:{data:{documents:1,signers:1,unitOre:1000,totalOre:1000,hash:'a'.repeat(64)}}});
 });
 await page.route('**/v1/envelopes/'+editorEnvelopeId+'/party*',r=>r.fulfill({json:{data:{ok:true}}}));
 await page.getByRole('button',{name:/Granska & skicka/}).click();
 await expect.poll(()=>calls).toBe(1);
 await page.getByText('Företagsuppgifter för Mottagaren',{exact:true}).click();
 await page.getByRole('button',{name:'Spara mottagarens företag'}).click();
 await expect.poll(()=>calls).toBeGreaterThan(1);
 const response=page.waitForResponse(r=>r.url().includes('/'+editorEnvelopeId+'/quote')&&r.ok());
 release();await (await response).finished();
 await expect(page.getByLabel('Jag godkänner priset för detta utskick')).toHaveCount(0);
});

test('document tariff cannot be edited before loading and can recover explicitly',async({page})=>{
 await workspace(page);await page.clock.install();let hang=true,requested=false;
 await page.route('**/rest/v1/rpc/al_platform',r=>r.fulfill({json:r.request().postDataJSON().p_action==='status'?{admin:true,mfa:true}:[]}));
 await page.route('**/rest/v1/rpc/al_admin_document_tariff',r=>{requested=true;if(hang)return new Promise<void>(()=>{});return r.fulfill({json:{tariff:{id:'tariff',version:1,document_ore:1500,included_signers:1,extra_signer_ore:200},charges:[]}});});
 await page.goto('/admin');await expect.poll(()=>requested).toBe(true);await expect(page.getByRole('button',{name:'Spara dokumentpris',exact:true})).toBeDisabled();await page.clock.fastForward(13000);await expect(page.getByRole('alert')).toContainText('Begäran tog för lång tid');hang=false;await page.getByRole('button',{name:'Hämta sparat dokumentpris'}).click();await expect(page.getByLabel('Dokumentpris i kronor')).toHaveValue('15');await expect(page.getByRole('button',{name:'Spara dokumentpris',exact:true})).toBeEnabled();
});


test('field template fetch timeout recovers without applying fields',async({page})=>{
 await editorWorkspace(page);await page.getByRole('button',{name:/Dokument/}).first().click();await page.clock.install();let hang=true,requested=false;
 await page.route('**/rest/v1/al_templates*',r=>{requested=true;if(hang)return new Promise<void>(()=>{});return r.fulfill({json:[editorTemplate]});});
 await page.getByRole('button',{name:/Uppgifter/}).click();await expect.poll(()=>requested).toBe(true);await page.clock.fastForward(13000);await expect(page.getByRole('button',{name:'Hämta fältmallar igen'})).toBeVisible();hang=false;await page.getByRole('button',{name:'Hämta fältmallar igen'}).click();await expect(page.getByLabel('Fältmall att använda')).toBeEnabled();await page.getByLabel('Fältmall att använda').selectOption(editorTemplate.id);await expect(page.getByRole('button',{name:'Lägg in mallens fält'})).toBeDisabled();await expect(page.getByText('Dokumentfälten har osparade ändringar.',{exact:true})).toHaveCount(0);
});

test('a slow older CSV file cannot replace a later file selection',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Företag & team',exact:true}).click();await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='slow.csv')await new Promise<void>(resolve=>(window as any).releaseOldCsv=resolve);return original.call(this);};});
 await page.getByLabel('CSV-fil med kontakter').setInputFiles({name:'slow.csv',mimeType:'text/csv',buffer:Buffer.from('Namn;E-post\nGammal person;old@example.invalid')});await page.getByLabel('CSV-fil med kontakter').setInputFiles({name:'latest.csv',mimeType:'text/csv',buffer:Buffer.from('Namn;E-post\nSenaste personen;latest@example.invalid')});await expect(page.getByRole('cell',{name:'Senaste personen',exact:true})).toBeVisible();await page.evaluate(async()=>{(window as any).releaseOldCsv();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await expect(page.getByRole('cell',{name:'Gammal person',exact:true})).toHaveCount(0);await expect(page.getByRole('cell',{name:'Senaste personen',exact:true})).toBeVisible();
});

test('unanswered envelope detail read releases workspace actions with a visible timeout',async({page})=>{
 await workspace(page,[{id:editorEnvelopeId,organization_id:org,title:'Detaljkontroll',message:'',status:'draft',generation:1,sequential:false,expires_days:14,updated_at:new Date().toISOString()}]);await page.clock.install();let requested=false;await page.route('**/rest/v1/al_documents*',r=>{requested=true;return new Promise<void>(()=>{});});await page.getByRole('button',{name:'Öppna Detaljkontroll',exact:true}).click();await expect.poll(()=>requested).toBe(true);await page.clock.fastForward(13000);await expect(page.getByRole('alert')).toContainText('Begäran tog för lång tid');await page.getByRole('button',{name:'Tillbaka till avtal',exact:true}).click();await expect(page.getByRole('button',{name:'Nytt avtal',exact:true})).toBeEnabled();
});
