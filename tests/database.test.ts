import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sha256Hex } from "../packages/crypto/src/hash.ts";

test("real PostgreSQL: isolated organizations, guarded commands, private uploads, scoped keys and durable jobs", async (t) => {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}');grant usage on schema auth,storage to anon,authenticated,service_role;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 `);
  await db.exec(`create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update on storage.objects to authenticated;
 insert into auth.users values('11111111-1111-4111-8111-111111111111','a@example.invalid'),('22222222-2222-4222-8222-222222222222','b@example.invalid'),('33333333-3333-4333-8333-333333333333','reader@example.invalid');`);
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const actor = async (user: string, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: user, role }),
    ]);
    await db.exec(`set role ${role}`);
  };
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query<Record<string, any>>(sql, params)).rows[0];
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222";
  let oa: string, ob: string, ea: string, eb: string;
  await t.test(
    "owners create independent organizations and draft envelopes",
    async () => {
      await actor(a);
      oa = (await one("select public.al_create_organization('Företag A') id"))
        .id;
      ea = (await one("select public.al_save_draft($1,'Avtal A') data", [oa]))
        .data.id;
      await actor(b);
      ob = (await one("select public.al_create_organization('Företag B') id"))
        .id;
      eb = (await one("select public.al_save_draft($1,'Avtal B') data", [ob]))
        .data.id;
      assert.notEqual(oa, ob);
      assert.notEqual(ea, eb);
    },
  );
  await db.exec('reset role');
  await db.query("insert into al_private.api_entitlements(organization_id,model,paid_until,payment_reference) values($1,'subscription',now()+interval '1 day','fixture-a'),($2,'subscription',now()+interval '1 day','fixture-b')",[oa!,ob!]);
  await db.query("insert into al_private.document_tariffs(organization_id,version,document_ore,included_signers,extra_signer_ore) values($1,1,0,1,0),($2,1,0,1,0)",[oa!,ob!]);
  await db.query("insert into al_private.payment_receipts(reference,organization_id,paid_until,recorded_by) values('fixture-a',$1,now()+interval '2 days',$3),('fixture-b',$2,now()+interval '2 days',$3)",[oa!,ob!,a]);
  await t.test("RLS denies reads/writes across organizations", async () => {
    await actor(a);
    assert.equal(
      (await db.query("select * from public.al_envelopes where id=$1", [eb]))
        .rows.length,
      0,
    );
    await assert.rejects(
      db.query("select public.al_save_draft($1,'Försök')", [ob]),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      db.query(
        "update public.al_envelopes set status='completed' where id=$1",
        [ea],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into public.al_usage_events(organization_id,event_key,kind,quantity,envelope_id) values($1,'fake','envelope_completed',1,$2)",
        [oa, ea],
      ),
      /permission denied/,
    );
  });
  await t.test("reader can read but cannot mutate", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into public.al_memberships values($1,'33333333-3333-4333-8333-333333333333','reader',true)",
      [oa],
    );
    await actor("33333333-3333-4333-8333-333333333333");
    assert.equal(
      (await db.query("select * from public.al_envelopes where id=$1", [ea]))
        .rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "select public.al_add_recipient($1,$2,'Namn','a@b.se','bankid',1)",
        [oa, ea],
      ),
      /ACCESS_DENIED/,
    );
  });
  await t.test(
    "recipient method is persisted; duplicate recipients rejected",
    async () => {
      await actor(a);
      const r = (
        await one(
          "select public.al_add_recipient($1,$2,'Testperson','TEST@EXAMPLE.INVALID','freja',1) data",
          [oa, ea],
        )
      ).data;
      assert.equal(r.method, "freja");
      assert.equal(r.email, "test@example.invalid");
      await assert.rejects(
        db.query(
          "select public.al_add_recipient($1,$2,'Testperson','test@example.invalid','bankid',2)",
          [oa, ea],
        ),
        /duplicate key/,
      );
    },
  );
  await t.test(
    "optimistic version check and missing document block sending",
    async () => {
      await assert.rejects(
        db.query("select public.al_save_draft($1,'Ändrat','',false,14,$2,9)", [
          oa,
          ea,
        ]),
        /VERSION_CONFLICT/,
      );
      await assert.rejects(
        db.query("select public.al_send_envelope($1,$2,1)", [oa, ea]),
        /DOCUMENT_REQUIRED/,
      );
    },
  );
  const doc = "44444444-4444-4444-8444-444444444444";
  let lease: { id: string; leaseToken: string };
  await t.test(
    "private upload path, immutable object and atomic scan job",
    async () => {
      const path = `${oa}/${ea}/${doc}.pdf`;
      await db.query(
        "insert into storage.objects(bucket_id,name) values('al-documents',$1)",
        [path],
      );
      assert.equal(
        (
          await db.query(
            "update storage.objects set name=name where name=$1 returning name",
            [path],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name) values('al-documents',$1)",
          [`${ob}/${eb}/${doc}.pdf`],
        ),
        /row-level security/,
      );
      await db.query("select public.al_register_document($1,$2,$3,$4,$5,100)", [
        oa,
        ea,
        doc,
        "Test.pdf",
        "a".repeat(64),
      ]);
      await assert.rejects(
        db.query("select public.al_send_envelope($1,$2,1)", [oa, ea]),
        /DOCUMENT_SCAN_REQUIRED/,
      );
      await actor(b);
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        0,
      );
    },
  );
  const raw = "al_live_" + "b".repeat(64),
    hash = await sha256Hex(raw);
  await t.test(
    "API secrets hidden from users and scoped issuance guarded",
    async () => {
      await actor(a);
      await db.query(
        "select public.al_issue_api_key($1,'Integration','al_live_bbbbbbbb',$2,array['envelopes:read','envelopes:write','billing:read'])",
        [oa, hash],
      );
      await assert.rejects(
        db.query("select token_hash from public.al_api_keys"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.al_api_dispatch($1,'list_envelopes')", [hash]),
        /permission denied/,
      );
    },
  );
  await t.test(
    "API derives organization, retries exactly once, rejects changed request",
    async () => {
      await actor(a, "service_role");
      const payload = { title: "API-avtal", organizationId: ob };
      const x = (
        await one(
          "select public.al_api_dispatch($1,'save_draft',$2,'request-123') data",
          [hash, JSON.stringify(payload)],
        )
      ).data;
      const y = (
        await one(
          "select public.al_api_dispatch($1,'save_draft',$2,'request-123') data",
          [hash, JSON.stringify(payload)],
        )
      ).data;
      assert.equal(x.id, y.id);
      assert.equal(x.organization_id, oa);
      await assert.rejects(
        db.query(
          "select public.al_api_dispatch($1,'save_draft',$2,'request-123')",
          [hash, JSON.stringify({ title: "Ändrat" })],
        ),
        /IDEMPOTENCY_CONFLICT/,
      );
      const billing = (
        await one("select public.al_api_dispatch($1,'billing') data", [hash])
      ).data;
      assert.equal(billing.model, "unconfigured");
      assert.equal(billing.enabled, false);
      assert.equal(billing.priceVersion, null);
    },
  );
  await t.test(
    "durable job rejects wrong lease and verifies document hash",
    async () => {
      await actor(a, "service_role");
      lease = (await one("select public.al_claim_document_job() data")).data;
      assert.ok(lease.id);
      await assert.rejects(
        db.query("select public.al_finish_document_job($1,$2,$3)", [
          lease.id,
          crypto.randomUUID(),
          JSON.stringify({
            sha256: "a".repeat(64),
            byteSize: 100,
            malware: "CLEAN",
            pdf: "PASS",
          }),
        ]),
        /LEASE_LOST/,
      );
      await assert.rejects(
        db.query("select public.al_finish_document_job($1,$2,$3)", [
          lease.id,
          lease.leaseToken,
          JSON.stringify({
            sha256: "b".repeat(64),
            byteSize: 100,
            malware: "CLEAN",
            pdf: "PASS",
          }),
        ]),
        /SCAN_REPORT_INVALID/,
      );
      await db.query("select public.al_finish_document_job($1,$2,$3)", [
        lease.id,
        lease.leaseToken,
        JSON.stringify({
          sha256: "a".repeat(64),
          byteSize: 100,
          malware: "CLEAN",
          pdf: "PASS",
        }),
      ]);
      await actor(a);
      assert.equal(
        (await one("select status from public.al_documents where id=$1", [doc]))
          .status,
        "ready",
      );
      await assert.rejects(
        db.query("select public.al_send_envelope($1,$2,1)", [oa, ea]),
        /SIGNING_METHOD_NOT_READY/,
      );
    },
  );
  await t.test(
    "field validation; cancellation remains idempotent and locks writes",
    async () => {
      await actor(a);
      await assert.rejects(
        db.query("select public.al_save_template($1,'Ogiltig',$2)", [
          oa,
          JSON.stringify([
            {
              id: "x",
              type: "text",
              label: "Namn",
              recipientRole: "Kund",
              required: true,
              page: 0,
              x: 0.9,
              y: 0,
              width: 0.5,
              height: 0.1,
            },
          ]),
        ]),
        /FIELD_OUTSIDE_PAGE/,
      );
      const c = (
        await one("select public.al_cancel_envelope($1,$2) data", [oa, ea])
      ).data;
      assert.equal(c.status, "cancelled");
      assert.equal(
        (await one("select public.al_cancel_envelope($1,$2) data", [oa, ea]))
          .data.status,
        "cancelled",
      );
      await assert.rejects(
        db.query(
          "select public.al_add_recipient($1,$2,'Person','new@example.invalid','bankid',2)",
          [oa, ea],
        ),
        /DOCUMENT_LOCKED/,
      );
    },
  );
  await t.test(
    "revoked key cannot replay an earlier successful response",
    async () => {
      await actor(a);
      const id = (await one("select id from public.al_api_keys")).id;
      await db.query("select public.al_revoke_api_key($1,$2)", [oa, id]);
      await actor(a, "service_role");
      await assert.rejects(
        db.query(
          "select public.al_api_dispatch($1,'save_draft',$2,'request-123')",
          [hash, JSON.stringify({ title: "API-avtal", organizationId: ob })],
        ),
        /INVALID_API_KEY/,
      );
    },
  );

  let work: string, r1: string, r2: string, contact: string, template: string;
  await t.test(
    "recipient edits and ordering are atomic; malformed and foreign IDs are rejected",
    async () => {
      await actor(a);
      work = (
        await one("select public.al_save_draft($1,'Arbetsflöde') data", [oa])
      ).data.id;
      r1 = (
        await one(
          "select public.al_add_recipient($1,$2,'Person Ett','one@example.invalid','bankid',1) data",
          [oa, work],
        )
      ).data.id;
      r2 = (
        await one(
          "select public.al_add_recipient($1,$2,'Person Två','two@example.invalid','freja',2) data",
          [oa, work],
        )
      ).data.id;
      const edited = (
        await one(
          "select public.al_edit_recipient($1,$2,$3,'Uppdaterad Person','NEW@example.invalid','drawn_signature') data",
          [oa, work, r1],
        )
      ).data;
      assert.equal(edited.email, "new@example.invalid");
      assert.equal(edited.method, "drawn_signature");
      await db.query("select public.al_reorder_recipients($1,$2,$3)", [
        oa,
        work,
        [r2, r1],
      ]);
      assert.equal(
        (
          await one("select position from public.al_recipients where id=$1", [
            r2,
          ])
        ).position,
        1,
      );
      for (const ids of [
        [r1, r1],
        [r1],
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", r2],
      ])
        await assert.rejects(
          db.query("select public.al_reorder_recipients($1,$2,$3)", [
            oa,
            work,
            ids,
          ]),
          /INVALID_RECIPIENT_ORDER/,
        );
      await actor(b);
      await assert.rejects(
        db.query(
          "select public.al_edit_recipient($1,$2,$3,'Intrång','x@example.invalid','bankid')",
          [oa, work, r1],
        ),
        /ACCESS_DENIED/,
      );
    },
  );
  await t.test(
    "removing a recipient compacts order without duplicate positions",
    async () => {
      await actor(a);
      await db.query("select public.al_remove_recipient($1,$2,$3)", [
        oa,
        work,
        r2,
      ]);
      assert.equal(
        (
          await one("select position from public.al_recipients where id=$1", [
            r1,
          ])
        ).position,
        1,
      );
      await assert.rejects(
        db.query("select public.al_remove_recipient($1,$2,$3)", [oa, work, r2]),
        /RECIPIENT_NOT_FOUND/,
      );
    },
  );
  await t.test(
    "document detach cancels durable scan jobs but keeps immutable original object",
    async () => {
      await actor(a);
      const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        path = `${oa}/${work}/${id}.pdf`;
      await db.query(
        "insert into storage.objects(bucket_id,name) values('al-documents',$1)",
        [path],
      );
      await db.query(
        "select public.al_register_document($1,$2,$3,'remove.pdf',$4,5)",
        [oa, work, id, "a".repeat(64)],
      );
      await db.query("select public.al_remove_document($1,$2,$3)", [
        oa,
        work,
        id,
      ]);
      assert.equal(
        (await db.query("select id from public.al_documents where id=$1", [id]))
          .rows.length,
        0,
      );
      assert.equal(
        (await db.query("select id from storage.objects where name=$1", [path]))
          .rows.length,
        1,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await db.query(
            "select id from al_private.jobs where document_id=$1",
            [id],
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "copying creates fresh draft and pending recipients, never billing usage or documents",
    async () => {
      await actor(a);
      const copy = (
        await one("select public.al_duplicate_draft($1,$2,'Kopia') data", [
          oa,
          work,
        ])
      ).data;
      assert.equal(copy.status, "draft");
      assert.equal(copy.generation, 1);
      assert.notEqual(copy.id, work);
      assert.equal(
        (
          await one(
            "select status from public.al_recipients where envelope_id=$1",
            [copy.id],
          )
        ).status,
        "pending",
      );
      assert.equal(
        (
          await db.query(
            "select id from public.al_documents where envelope_id=$1",
            [copy.id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select id from public.al_usage_events where envelope_id=$1",
            [copy.id],
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "contacts normalize addresses, reject stale updates and isolate tenant reads",
    async () => {
      await actor(a);
      const c = (
        await one(
          "select public.al_save_contact($1,'Kontakt','CONTACT@example.invalid','AB') data",
          [oa],
        )
      ).data;
      contact = c.id;
      assert.equal(c.email, "contact@example.invalid");
      await db.query(
        "select public.al_save_contact($1,'Kontakt Ny','contact@example.invalid','AB',$2,1,true)",
        [oa, contact],
      );
      await assert.rejects(
        db.query(
          "select public.al_save_contact($1,'Fel','contact@example.invalid','AB',$2,1,false)",
          [oa, contact],
        ),
        /VERSION_CONFLICT/,
      );
      await actor(b);
      assert.equal(
        (
          await db.query("select id from public.al_contacts where id=$1", [
            contact,
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query(
          "select public.al_save_contact($1,'Intrång','x@example.invalid')",
          [oa],
        ),
        /ACCESS_DENIED/,
      );
    },
  );
  await t.test(
    "organization profile is admin-only and reader cannot change contacts",
    async () => {
      await actor("33333333-3333-4333-8333-333333333333");
      await assert.rejects(
        db.query("select public.al_update_organization($1,'Intrång','123')", [
          oa,
        ]),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        db.query(
          "select public.al_save_contact($1,'Intrång','x@example.invalid')",
          [oa],
        ),
        /ACCESS_DENIED/,
      );
      await actor(a);
      assert.equal(
        (
          await one(
            "select public.al_update_organization($1,'Företag Nytt','556855-4884') data",
            [oa],
          )
        ).data.name,
        "Företag Nytt",
      );
    },
  );
  await t.test(
    "membership commands preserve last owner and prevent administrator escalation",
    async () => {
      await actor(a);
      await assert.rejects(
        db.query("select public.al_set_member_role($1,$2,'reader',true)", [
          oa,
          a,
        ]),
        /LAST_OWNER/,
      );
      await db.query(
        "select public.al_set_member_role($1,'33333333-3333-4333-8333-333333333333','admin',true)",
        [oa],
      );
      await actor("33333333-3333-4333-8333-333333333333");
      await assert.rejects(
        db.query("select public.al_set_member_role($1,$2,'reader',true)", [
          oa,
          a,
        ]),
        /OWNER_REQUIRED/,
      );
      await assert.rejects(
        db.query(
          "select public.al_set_member_role($1,'33333333-3333-4333-8333-333333333333','owner',true)",
          [oa],
        ),
        /OWNER_REQUIRED/,
      );
      await actor(a);
      await db.query(
        "select public.al_set_member_role($1,'33333333-3333-4333-8333-333333333333','reader',true)",
        [oa],
      );
    },
  );
  await t.test(
    "template deletion checks version and organization",
    async () => {
      await actor(a);
      template = (
        await one(
          "select public.al_save_template($1,'Raderbar mall',$2) data",
          [oa,JSON.stringify([{id:"fixture-field",label:"Kund",recipientRole:"Kund",type:"text",required:true,page:0,x:0.1,y:0.1,width:0.4,height:0.1}])],
        )
      ).data.id;
      await assert.rejects(
        db.query("select public.al_delete_template($1,$2,2)", [oa, template]),
        /VERSION_CONFLICT/,
      );
      await actor(b);
      await assert.rejects(
        db.query("select public.al_delete_template($1,$2,1)", [oa, template]),
        /ACCESS_DENIED/,
      );
      await actor(a);
      await db.query("select public.al_delete_template($1,$2,1)", [
        oa,
        template,
      ]);
    },
  );
  await t.test(
    "activity keyset pages have no duplicates and never cross tenants",
    async () => {
      await actor(a);
      const first = (await one("select public.al_activity($1,3) data", [oa]))
        .data;
      const last = first.at(-1);
      const next = (
        await one("select public.al_activity($1,3,$2,$3) data", [
          oa,
          last.created_at,
          last.id,
        ])
      ).data;
      assert.equal(first.length, 3);
      assert.equal(next.length, 3);
      assert.equal(new Set([...first, ...next].map((x) => x.id)).size, 6);
      assert.ok(first.every((x: any) => x.organization_id === oa));
      await actor(b);
      await assert.rejects(
        db.query("select public.al_activity($1)", [oa]),
        /ACCESS_DENIED/,
      );
    },
  );
  await t.test(
    "usage summary is read-only, period bounded, and billing stays undecided",
    async () => {
      await actor(a);
      const u = (
        await one(
          "select public.al_usage_summary($1,'2026-11-01','2026-12-01') data",
          [oa],
        )
      ).data;
      assert.equal(u.billing_model, "unconfigured");
      assert.equal(u.billing_enabled, false);
      assert.deepEqual(u.counts, {});
      await assert.rejects(
        db.query(
          "select public.al_usage_summary($1,'2025-01-01','2027-01-01')",
          [oa],
        ),
        /INVALID_PERIOD/,
      );
      await actor(b);
      await assert.rejects(
        db.query(
          "select public.al_usage_summary($1,'2026-11-01','2026-12-01')",
          [oa],
        ),
        /ACCESS_DENIED/,
      );
    },
  );
  await t.test(
    "extension API honors read scope, derives tenant, and deduplicates contact creation",
    async () => {
      await actor(a);
      const writeHash = "b".repeat(64),
        readHash = "c".repeat(64);
      await db.query(
        "select public.al_issue_api_key($1,'Operations','al_live_bbbbbbbb',$2,ARRAY['envelopes:read','envelopes:write','billing:read'])",
        [oa, writeHash],
      );
      await db.query(
        "select public.al_issue_api_key($1,'Read','al_live_cccccccc',$2,ARRAY['envelopes:read'])",
        [oa, readHash],
      );
      await actor(a, "service_role");
      const payload = {
        name: "API Kontakt",
        email: "api@example.invalid",
        organizationId: ob,
      };
      const c = (
        await one(
          "select public.al_api_dispatch($1,'save_contact',$2,'contact-request-001') data",
          [writeHash, payload],
        )
      ).data;
      assert.equal(c.organization_id, oa);
      assert.equal(
        (
          await one(
            "select public.al_api_dispatch($1,'save_contact',$2,'contact-request-001') data",
            [writeHash, payload],
          )
        ).data.id,
        c.id,
      );
      const contacts = (
        await one("select public.al_api_dispatch($1,'list_contacts') data", [
          readHash,
        ])
      ).data;
      assert.ok(contacts.every((c: any) => c.organization_id === oa));
      await assert.rejects(
        db.query(
          "select public.al_api_dispatch($1,'save_contact',$2,'contact-request-002')",
          [readHash, { name: "Forbidden", email: "denied@example.invalid" }],
        ),
        /SCOPE_DENIED/,
      );
      await assert.rejects(
        db.query("select public.al_api_dispatch($1,'usage_summary',$2)", [
          readHash,
          { from: "2026-11-01", to: "2026-12-01" },
        ]),
        /SCOPE_DENIED/,
      );
    },
  );
  await t.test("all mutation commands refuse cancelled envelopes", async () => {
    await actor(a);
    await db.query("select public.al_cancel_envelope($1,$2)", [oa, work]);
    for (const sql of [
      "select public.al_edit_recipient($1,$2,$3,'Låst','locked@example.invalid','freja')",
      "select public.al_remove_recipient($1,$2,$3)",
      "select public.al_remove_document($1,$2,$3)",
    ])
      await assert.rejects(db.query(sql, [oa, work, r1]), /DOCUMENT_LOCKED/);
    await assert.rejects(
      db.query("select public.al_reorder_recipients($1,$2,$3)", [
        oa,
        work,
        [r1],
      ]),
      /DOCUMENT_LOCKED/,
    );
  });

  const service = async () => actor(a, "service_role");
  const flow = async (
    id: string,
    action: string,
    payload: unknown = {},
    org: string = oa,
  ) => {if(action==='send'){const q=(await one('select public.al_document_quote($1,null,$2,$3) data',[a,org,id])).data;payload={...(payload as object),priceHash:q.hash};}
    return (
      await one("select public.al_flow_command($1,null,$2,$3,$4,$5) data", [
        a,
        org,
        id,
        action,
        payload,
      ])
    ).data;};
  let connected: string,
    first: string,
    second: string,
    firstHash = "d".repeat(64),
    secondHash = "e".repeat(64),
    snapshot: any,
    firstLink: string,
    secondLink: string,
    fieldId: string,
    docId: string,
    webhookId: string;
  await t.test(
    "connected preparation uses membership and only service orchestration",
    async () => {
      await actor(a);
      connected = (
        await one(
          "select public.al_save_draft($1,'Connected signing','',true) data",
          [oa],
        )
      ).data.id;
      first = (
        await one(
          "select public.al_add_recipient($1,$2,'Signer One','first@example.invalid','email_approval',1) data",
          [oa, connected],
        )
      ).data.id;
      second = (
        await one(
          "select public.al_add_recipient($1,$2,'Signer Two','second@example.invalid','email_approval',2) data",
          [oa, connected],
        )
      ).data.id;
      await assert.rejects(
        db.query("select public.al_flow_command($1,null,$2,$3,'read')", [
          a,
          oa,
          connected,
        ]),
        /permission denied/,
      );
      await service();
      await assert.rejects(flow(connected, "read", {}, ob), /ACCESS_DENIED/);
      await assert.rejects(
        db.query("select public.al_flow_command($1,null,$2,$3,'read')", [
          b,
          oa,
          connected,
        ]),
        /ACCESS_DENIED/,
      );
      assert.equal((await flow(connected, "read")).envelope.id, connected);
      const keyRead = "c".repeat(64);
      await assert.rejects(
        db.query(
          "select public.al_flow_command(null,$1,null,$2,'authorize_upload')",
          [keyRead, connected],
        ),
        /SCOPE_DENIED/,
      );
    },
  );
  await t.test(
    "PDF registration through API stays pending scan; repeat ID is idempotent",
    async () => {
      await service();
      docId = crypto.randomUUID();
      const path = `${oa}/${connected}/${docId}.pdf`;
      await db.exec("reset role");
      await db.query(
        "insert into storage.objects(bucket_id,name) values('al-documents',$1)",
        [path],
      );
      await service();
      const payload = {
        id: docId,
        name: "connected.pdf",
        sha256: "a".repeat(64),
        byteSize: 5,
      };
      assert.equal(
        (await flow(connected, "register_document", payload)).status,
        "pending_scan",
      );
      assert.equal(
        (await flow(connected, "register_document", payload)).id,
        docId,
      );
      await assert.rejects(
        flow(connected, "register_document", {
          ...payload,
          sha256: "b".repeat(64),
        }),
        /UPLOAD_CONFLICT/,
      );
      await db.exec("reset role");
      await db.query(
        "update public.al_documents set status='ready',page_count=1 where id=$1",
        [docId],
      );
      await service();
    },
  );
  await t.test(
    "document fields bind real same-envelope recipient and page; stale edits fail",
    async () => {
      await service();
      fieldId = crypto.randomUUID();
      const field = {
        id: fieldId,
        documentId: docId,
        recipientId: first,
        type: "text",
        label: "Kundnamn",
        required: true,
        page: 0,
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.05,
      };
      await assert.rejects(
        flow(connected, "fields", {
          generation: 1,
          fields: [{ ...field, recipientId: b }],
        }),
        /INVALID_FIELD_ASSIGNMENT/,
      );
      await assert.rejects(
        flow(connected, "fields", {
          generation: 1,
          fields: [{ ...field, page: 1 }],
        }),
        /INVALID_FIELD_ASSIGNMENT/,
      );
      assert.equal(
        (await flow(connected, "fields", { generation: 1, fields: [field] }))
          .generation,
        2,
      );
      await assert.rejects(
        flow(connected, "fields", { generation: 1, fields: [] }),
        /VERSION_CONFLICT/,
      );
    },
  );
  await t.test(
    "send fails closed without capability/worker; freezes snapshot and queues one sequential invitation",
    async () => {
      await service();
      snapshot = await flow(connected, "read");
      firstLink = crypto.randomUUID();
      secondLink = crypto.randomUUID();
      const payload = {
        generation: 2,
        snapshot,
        links: [
          { id: firstLink, recipientId: first, tokenHash: firstHash },
          { id: secondLink, recipientId: second, tokenHash: secondHash },
        ],
        keyFingerprint: "f".repeat(64),
      };
      await assert.rejects(
        flow(connected, "send", payload),
        /SIGNING_METHOD_NOT_READY/,
      );
      await db.exec("reset role");
      await db.exec(
        "update al_private.capabilities set enabled=true where method='email_approval'",
      );
      await service();
      await assert.rejects(
        flow(connected, "send", payload),
        /SIGNING_WORKER_NOT_READY/,
      );
      await db.query(
        "select public.al_signing_worker('heartbeat',null,null,$1)",
        [{ ready: true, keyFingerprint: "f".repeat(64) }],
      );
      webhookId = (
        await one(
          "select public.al_configure_webhook($1,$2,'https://example.com/hooks',$3) data",
          [a, oa, "9".repeat(64)],
        )
      ).data.id;
      const result = await flow(connected, "send", payload);
      assert.equal(result.status, "sent");
      assert.equal(
        (await flow(connected, "send", payload)).snapshotHash,
        result.snapshotHash,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await one(
            "select count(*)::int n from al_private.signing_outbox where envelope_id=$1 and kind='invitation'",
            [connected],
          )
        ).n,
        1,
      );
      assert.equal(
        (
          await one(
            "select count(*)::int n from al_private.signing_links where envelope_id=$1",
            [connected],
          )
        ).n,
        2,
      );
      await service();
      await assert.rejects(
        flow(connected, "fields", { generation: 2, fields: [] }),
        /DOCUMENT_LOCKED/,
      );
    },
  );
  await t.test(
    "signer projection hides other recipients, secrets and storage paths; ordering enforced",
    async () => {
      await service();
      const view = (
        await one("select public.al_signer_command($1,'view') data", [
          firstHash,
        ])
      ).data;
      assert.equal(view.recipient.id, first);
      assert.equal(view.fields.length, 1);
      assert.ok(!JSON.stringify(view).includes("second@example.invalid"));
      assert.ok(!JSON.stringify(view).includes("storage_path"));
      assert.ok(!JSON.stringify(view).includes(firstHash));
      await assert.rejects(
        db.query("select public.al_signer_command($1,'document',$2)", [
          secondHash,
          { documentId: docId },
        ]),
        /WAITING_FOR_PREVIOUS_RECIPIENT/,
      );
      await assert.rejects(
        db.query("select public.al_signer_command($1,'view')", [
          "0".repeat(64),
        ]),
        /INVALID_SIGNING_LINK/,
      );
      await assert.rejects(
        db.query("select public.al_signer_command($1,'document',$2)", [
          firstHash,
          { documentId: b },
        ]),
        /DOCUMENT_NOT_FOUND/,
      );
    },
  );
  let firstDecision: any;
  await t.test(
    "approval binds frozen hash, required fields and exact retry; usage recorded once",
    async () => {
      await service();
      const v = (
        await one("select public.al_signer_command($1,'view') data", [
          firstHash,
        ])
      ).data;
      firstDecision = {
        intent: "approve",
        documentSetHash: v.snapshotHash,
        consentVersion: "email-approval-v1",
        consent: true,
        values: { [fieldId]: "Test person" },
      };
      await assert.rejects(
        db.query("select public.al_signer_command($1,'decide',$2)", [
          firstHash,
          { ...firstDecision, documentSetHash: "0".repeat(64) },
        ]),
        /DOCUMENT_SET_CHANGED/,
      );
      await assert.rejects(
        db.query("select public.al_signer_command($1,'decide',$2)", [
          firstHash,
          { ...firstDecision, values: {} },
        ]),
        /REQUIRED_FIELD/,
      );
      await assert.rejects(
        db.query("select public.al_signer_command($1,'decide',$2)", [
          firstHash,
          { ...firstDecision, values: { [b]: "foreign" } },
        ]),
        /UNASSIGNED_FIELD/,
      );
      assert.equal(
        (
          await one("select public.al_signer_command($1,'decide',$2) data", [
            firstHash,
            firstDecision,
          ])
        ).data.status,
        "signed",
      );
      assert.equal(
        (
          await one("select public.al_signer_command($1,'decide',$2) data", [
            firstHash,
            firstDecision,
          ])
        ).data.status,
        "signed",
      );
      await assert.rejects(
        db.query("select public.al_signer_command($1,'decide',$2)", [
          firstHash,
          { ...firstDecision, values: { [fieldId]: "changed" } },
        ]),
        /LINK_ALREADY_USED/,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await one(
            "select count(*)::int n from public.al_usage_events where event_key=$1",
            ["signed:" + first],
          )
        ).n,
        1,
      );
      assert.equal(
        (
          await one(
            "select count(*)::int n from al_private.signing_outbox where effect_key=$1",
            ["invite:" + second],
          )
        ).n,
        1,
      );
      await service();
    },
  );
  await t.test(
    "last approval creates one durable finalization and does not prematurely complete envelope",
    async () => {
      await service();
      const v = (
        await one("select public.al_signer_command($1,'view') data", [
          secondHash,
        ])
      ).data;
      const decision = {
        intent: "approve",
        documentSetHash: v.snapshotHash,
        consentVersion: "email-approval-v1",
        consent: true,
        values: {},
      };
      const r = (
        await one("select public.al_signer_command($1,'decide',$2) data", [
          secondHash,
          decision,
        ])
      ).data;
      assert.equal(r.envelopeStatus, "finalizing");
      await db.exec("reset role");
      assert.equal(
        (
          await one(
            "select count(*)::int n from al_private.signing_outbox where envelope_id=$1 and kind='finalize'",
            [connected],
          )
        ).n,
        1,
      );
      await service();
      await assert.rejects(
        flow(connected, "download"),
        /FINAL_DOCUMENT_NOT_READY/,
      );
    },
  );
  await t.test(
    "worker leases fence late completion and accepted mail is not counted as document completion",
    async () => {
      await db.exec("reset role");
      await db.query(
        "update al_private.signing_outbox set status='cancelled' where envelope_id=$1 and kind<>'finalize'",
        [connected],
      );
      await service();
      const work = (await one("select public.al_signing_worker('claim') data"))
        .data;
      assert.equal(work.job.kind, "finalize");
      await assert.rejects(
        db.query("select public.al_signing_worker('finish',$1,$2,$3)", [
          work.job.id,
          crypto.randomUUID(),
          { status: "completed", result: { files: [] } },
        ]),
        /LEASE_LOST/,
      );
      await assert.rejects(
        db.query("select public.al_signing_worker('finish',$1,$2,$3)", [
          work.job.id,
          work.job.lease_token,
          { status: "accepted" },
        ]),
        /INVALID_JOB_RESULT/,
      );
      await db.exec("reset role");
      await db.query(
        "update al_private.signing_outbox set lease_until=now()-interval '1 second' where id=$1",
        [work.job.id],
      );
      await service();
      const newer = (await one("select public.al_signing_worker('claim') data"))
        .data;
      assert.notEqual(newer.job.lease_token, work.job.lease_token);
      await assert.rejects(
        db.query("select public.al_signing_worker('finish',$1,$2,$3)", [
          work.job.id,
          work.job.lease_token,
          { status: "failed" },
        ]),
        /LEASE_LOST/,
      );
      const files = [docId, "evidence"].map((documentId) => ({
        documentId,
        path: `${oa}/${connected}/${newer.job.lease_token}/${documentId}.${documentId === "evidence" ? "zip" : "pdf"}`,
        sha256: "a".repeat(64),
      }));
      await db.exec("reset role");
      for (const f of files)
        await db.query(
          "insert into storage.objects(bucket_id,name) values('al-final-documents',$1)",
          [f.path],
        );
      await service();
      await db.query("select public.al_signing_worker('finish',$1,$2,$3)", [
        work.job.id,
        newer.job.lease_token,
        { status: "completed", result: { files } },
      ]);
      assert.equal((await flow(connected, "download")).files.length, 2);
      await db.exec("reset role");
      assert.equal(
        (
          await one("select status from public.al_envelopes where id=$1", [
            connected,
          ])
        ).status,
        "completed",
      );
      assert.equal(
        (
          await one(
            "select count(*)::int n from public.al_usage_events where event_key=$1",
            ["completed:" + connected],
          )
        ).n,
        1,
      );
      await service();
    },
  );
  await t.test(
    "private signing tables and RPCs reject ordinary authenticated users",
    async () => {
      await actor(a);
      for (const table of [
        "signing_cases",
        "signing_links",
        "signing_outbox",
        "webhook_secrets",
      ])
        await assert.rejects(
          db.query("select * from al_private." + table),
          /permission denied/,
        );
      for (const sql of [
        "select public.al_signing_worker('claim')",
        "select public.al_signer_command('fake','view')",
      ])
        await assert.rejects(db.query(sql), /permission denied/);
    },
  );

  await t.test(
    "connected HTTP handlers -> real PostgreSQL -> delivery worker -> recipient approval -> PDF evidence -> completed",
    async () => {
      const { connectedRoute, publicSigning } = await import(
        "../supabase/functions/avtalslank-api/connected.ts"
      );
      const { processSigningJob } = await import("../apps/worker/signing.ts");
      const { PDFDocument } = await import("pdf-lib");
      const secret = "8".repeat(64),
        config = {
          secret,
          publicOrigin: "https://avtalslank.test",
          resendKey: "synthetic-key",
          from: "signing@example.invalid",
          domainVerified: true,
        };
      const oldDeno = (globalThis as any).Deno;
      (globalThis as any).Deno = {
        env: {
          get: (name: string) =>
            name === "SIGNING_LINK_SECRET" ? secret : undefined,
        },
      };
      const objects = new Map<string, Uint8Array>();
      let sentToken = "";
      const client: any = {
        rpc: async (name: string, args: Record<string, unknown> = {}) => {
          try {
            await service();
            const keys = Object.keys(args);
            if (
              !/^[a-z_]+$/.test(name) ||
              keys.some((k) => !/^[a-z_]+$/.test(k))
            )
              throw Error("UNSAFE_TEST_RPC");
            const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) data`;
            return {
              data: (await one(sql, Object.values(args))).data,
              error: null,
            };
          } catch (error) {
            return { data: null, error };
          }
        },
        storage: {
          from: (bucket: string) => ({
            upload: async (path: string, bytes: Uint8Array) => {
              if (objects.has(bucket + "/" + path))
                return { error: Error("EXISTS") };
              objects.set(bucket + "/" + path, bytes);
              await db.exec("reset role");
              await db.query(
                "insert into storage.objects(bucket_id,name) values($1,$2)",
                [bucket, path],
              );
              await service();
              return { data: { path }, error: null };
            },
            download: async (path: string) =>
              objects.has(bucket + "/" + path)
                ? {
                    data: new Blob([
                      new Uint8Array(objects.get(bucket + "/" + path)!),
                    ]),
                    error: null,
                  }
                : { data: null, error: Error("NOT_FOUND") },
          }),
        },
      };
      try {
        await actor(a);
        const envelope = (
          await one(
            "select public.al_save_draft($1,'Full connected journey') data",
            [oa],
          )
        ).data;
        const recipient = (
          await one(
            "select public.al_add_recipient($1,$2,'Synthetic Signer','signer@example.invalid','email_approval',1) data",
            [oa, envelope.id],
          )
        ).data;
        const identity = { actor: a, keyHash: null, organizationId: oa };
        const route = (operation: string, body?: any) =>
          connectedRoute(
            new Request(
              `https://api.test/v1/envelopes/${envelope.id}/${operation}?organizationId=${oa}`,
              {
                method: body ? "POST" : "GET",
                headers: { "content-type": "application/json" },
                ...(body ? { body: JSON.stringify(body) } : {}),
              },
            ),
            `/v1/envelopes/${envelope.id}/${operation}`,
            client,
            identity,
            body ?? {},
          );
        const pdf = await PDFDocument.create();
        pdf.addPage([595, 842]);
        const bytes = await pdf.save(),
          documentId = crypto.randomUUID();
        const uploaded: any = await connectedRoute(
          new Request(
            `https://api.test/v1/envelopes/${envelope.id}/documents?organizationId=${oa}&documentId=${documentId}&name=contract.pdf`,
            {
              method: "POST",
              headers: { "content-type": "application/pdf" },
              body: new Uint8Array(bytes),
            },
          ),
          `/v1/envelopes/${envelope.id}/documents`,
          client,
          identity,
          {},
        );
        assert.equal(uploaded.data.status, "pending_scan");
        // Synthetic scanner verdict: scanner process itself is an independently unverified runtime dependency.
        await db.exec("reset role");
        await db.query(
          "update al_private.jobs set status='completed' where document_id<>$1",
          [documentId],
        );
        await service();
        const scan = (await client.rpc("al_claim_document_job")).data;
        assert.equal(scan.document.id, documentId);
        const scanResult = await client.rpc("al_finish_document_job", {
          p_id: scan.id,
          p_lease: scan.leaseToken,
          p_report: {
            sha256: await sha256Hex(bytes),
            byteSize: bytes.length,
            malware: "CLEAN",
            pdf: "PASS",
            pageCount: 1,
          },
        });
        if (scanResult.error) throw scanResult.error;
        const fid = crypto.randomUUID();
        await route("fields", {
          generation: 1,
          fields: [
            {
              id: fid,
              documentId,
              recipientId: recipient.id,
              label: "Name",
              type: "text",
              required: true,
              page: 0,
              x: 0.1,
              y: 0.1,
              width: 0.5,
              height: 0.05,
            },
          ],
        });
        await client.rpc("al_signing_worker", {
          p_action: "heartbeat",
          p_payload: { ready: true, keyFingerprint: await sha256Hex(secret) },
        });
        await db.exec('reset role');await db.query("insert into al_private.document_tariffs(organization_id,version,document_ore,included_signers,extra_signer_ore) values($1,2,1000,1,250)",[oa]);
        const quote=(await client.rpc('al_document_quote',{p_actor:a,p_key_hash:null,p_org:oa,p_envelope:envelope.id})).data;
        await assert.rejects(route('send',{generation:2,priceHash:'stale'}),/PRICE_CHANGED/);
        const started: any = await route("send", { generation: 2,priceHash:quote.hash });
        assert.equal(started.data.status, "sent");
        await db.exec("reset role");
        await db.query(
          "update al_private.signing_outbox set status='cancelled' where envelope_id<>$1 or kind='webhook'",
          [envelope.id],
        );
        await service();
        const invitation = (
          await client.rpc("al_signing_worker", { p_action: "claim" })
        ).data;
        assert.equal(invitation.job.kind, "invitation");
        await processSigningJob(client, config, invitation, {
          fetch: async (_input: any, init: any) => {
            const mail = JSON.parse(init.body);
            assert.deepEqual(mail.to, ["signer@example.invalid"]);
            assert.equal(
              init.headers["idempotency-key"],
              invitation.job.effect_key,
            );
            sentToken = new URL(
              mail.text.match(/https:\/\/[^\s]+/)[0],
            ).hash.slice("#token=".length);
            return new Response(
              JSON.stringify({ id: "synthetic-provider-id" }),
              { status: 200 },
            );
          },
          postWebhook: async () => 204,
        } as any);
        assert.equal(sentToken.length, 64);
        const signer = (action: string, body: any = {}) =>
          publicSigning(
            new Request("https://api.test/v1/signer/" + action, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token: sentToken, ...body }),
            }),
            "/v1/signer/" + action,
            client,
          );
        const view: any = await signer("view");
        assert.equal(view.data.recipient.id, recipient.id);
        assert.ok(!JSON.stringify(view).includes("storage_path"));
        const file = await signer("document", { documentId });
        assert.ok(file instanceof Response);
        assert.equal(
          await sha256Hex(
            new Uint8Array(await (file as Response).arrayBuffer()),
          ),
          await sha256Hex(bytes),
        );
        const decision = {
          intent: "approve",
          documentSetHash: view.data.snapshotHash,
          consentVersion: "email-approval-v1",
          consent: true,
          values: { [fid]: "Synthetic Signer" },
          identity:{name:"Synthetic Signer",personalNumber:"199001010017"},
        };
        await assert.rejects(()=>signer("decide",{decision:{...decision,identity:{name:"X",personalNumber:"199001010018"}}}),/INVALID_SIGNER_IDENTITY/);
        const approved: any = await signer("decide", { decision });
        assert.equal(approved.data.envelopeStatus, "finalizing");
        let finalize = (
          await client.rpc("al_signing_worker", { p_action: "claim" })
        ).data;
        if (finalize.job.kind === "webhook") {
          await processSigningJob(client, config, finalize, {
            fetch: globalThis.fetch,
            postWebhook: async () => 204,
          });
          finalize = (
            await client.rpc("al_signing_worker", { p_action: "claim" })
          ).data;
        }
        assert.equal(finalize.job.kind, "finalize");
        await processSigningJob(client, config, finalize);
        const result: any = await route("final");
        assert.ok(result instanceof Response);
        const archive = new Uint8Array(await result.arrayBuffer());
        const {verifyEvidenceZip}=await import("../packages/evidence/src/zip.ts");
        assert.equal((await verifyEvidenceZip(archive)).verified,true);
        const signerArchive=await signer("evidence");assert.ok(signerArchive instanceof Response);
        assert.equal(await sha256Hex(new Uint8Array(await (signerArchive as Response).arrayBuffer())),await sha256Hex(archive));
        assert.equal(archive[0], 0x50);
        assert.equal(archive[1], 0x4b);
        const recipientFinal = await signer("final", { documentId });
        assert.ok(recipientFinal instanceof Response);
        assert.equal(
          (
            await PDFDocument.load(
              await (recipientFinal as Response).arrayBuffer(),
            )
          ).getPageCount(),
          2,
        );
        await db.exec("reset role");
        const originalEvidence=(await one("select signer_evidence as ev from al_private.signing_links where envelope_id=$1",[envelope.id])).ev;
        assert.equal(originalEvidence.personalNumber,"199001010017");assert.match(originalEvidence.signingHash,/^[a-f0-9]{64}$/);
        await service();const replay=await signer("decide",{decision});assert.equal((replay as any).data.status,"signed");
        await db.exec("reset role");assert.deepEqual((await one("select signer_evidence as ev from al_private.signing_links where envelope_id=$1",[envelope.id])).ev,originalEvidence);
        const completion=(await one("select count(*)::int n from al_private.signing_outbox where envelope_id=$1 and kind='completion'",[envelope.id])).n;assert.equal(completion,1);
        await db.query("update al_private.signing_outbox set status='cancelled' where status='pending' and (envelope_id<>$1 or kind<>'completion')",[envelope.id]);await service();
        const mailJob=(await client.rpc("al_signing_worker",{p_action:"claim"})).data;assert.equal(mailJob.job.kind,"completion");
        await processSigningJob(client,config,mailJob,{fetch:async(_url:any,init:any)=>{const m=JSON.parse(init.body);assert.match(m.subject,/signerade avtal/);assert.ok(!JSON.stringify(m).includes("199001010017"));return new Response(JSON.stringify({id:"synthetic-completion-reference"}),{status:200});},postWebhook:async()=>204} as any);

        await db.exec("reset role");
        assert.equal(
          (
            await one("select status from public.al_envelopes where id=$1", [
              envelope.id,
            ])
          ).status,
          "completed",
        );
        assert.equal(
          (
            await one(
              "select sum(quantity)::int n from public.al_usage_events where envelope_id=$1 and kind='envelope_completed'",
              [envelope.id],
            )
          ).n,
          1,
        );
        assert.equal(
          (
            await one(
              "select count(*)::int n from al_private.signing_outbox where envelope_id=$1 and kind='invitation' and status='accepted'",
              [envelope.id],
            )
          ).n,
          1,
        );
        assert.equal(
          await sha256Hex(
            objects.get(`al-documents/${oa}/${envelope.id}/${documentId}.pdf`)!,
          ),
          await sha256Hex(bytes),
        );
      } finally {
        (globalThis as any).Deno = oldDeno;
      }
    },
  );

  await t.test(
    "cancellation, decline and expiry revoke future signing and never complete an envelope",
    async () => {
      async function started() {
        await actor(a);
        const e = (
          await one("select public.al_save_draft($1,'Lifecycle test') data", [
            oa,
          ])
        ).data;
        const r = (
          await one(
            "select public.al_add_recipient($1,$2,'Lifecycle Signer','lifecycle@example.invalid','email_approval',1) data",
            [oa, e.id],
          )
        ).data;
        const d = crypto.randomUUID(),
          hash = await sha256Hex(crypto.randomUUID());
        await db.exec("reset role");
        await db.query(
          "insert into storage.objects(bucket_id,name) values('al-documents',$1)",
          [`${oa}/${e.id}/${d}.pdf`],
        );
        await service();
        await flow(e.id, "register_document", {
          id: d,
          name: "lifecycle.pdf",
          sha256: "a".repeat(64),
          byteSize: 5,
        });
        await db.exec("reset role");
        await db.query(
          "update public.al_documents set status='ready',page_count=1 where id=$1",
          [d],
        );
        await service();
        await db.query(
          "select public.al_signing_worker('heartbeat',null,null,$1)",
          [{ ready: true, keyFingerprint: "f".repeat(64) }],
        );
        const result = await flow(e.id, "send", {
          generation: 1,
          snapshot: await flow(e.id, "read"),
          links: [
            { id: crypto.randomUUID(), recipientId: r.id, tokenHash: hash },
          ],
          keyFingerprint: "f".repeat(64),
        });
        return { e, r, hash, result };
      }
      const cancelled = await started();
      assert.equal((await flow(cancelled.e.id, "cancel")).status, "cancelled");
      await assert.rejects(
        db.query("select public.al_signer_command($1,'view')", [
          cancelled.hash,
        ]),
        /INVALID_SIGNING_LINK/,
      );
      const declined = await started();
      const response = (
        await one("select public.al_signer_command($1,'decide',$2) data", [
          declined.hash,
          {
            intent: "decline",
            documentSetHash: declined.result.snapshotHash,
            reason: "Incorrect agreement",
          },
        ])
      ).data;
      assert.equal(response.envelopeStatus, "declined");
      await assert.rejects(
        db.query("select public.al_signer_command($1,'decide',$2)", [
          declined.hash,
          {
            intent: "approve",
            documentSetHash: declined.result.snapshotHash,
            consent: true,
            consentVersion: "email-approval-v1",
            values: {},
          },
        ]),
        /LINK_ALREADY_USED/,
      );
      const expired = await started();
      await db.exec("reset role");
      await db.query(
        "update al_private.signing_cases set expires_at=now()-interval '1 second' where envelope_id=$1",
        [expired.e.id],
      );
      await service();
      assert.equal((await one("select public.al_expire_signing() n")).n, 1);
      await assert.rejects(
        db.query("select public.al_signer_command($1,'view')", [expired.hash]),
        /INVALID_SIGNING_LINK/,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await one("select status from public.al_envelopes where id=$1", [
            expired.e.id,
          ])
        ).status,
        "expired",
      );
      assert.equal(
        (
          await one(
            "select count(*)::int n from public.al_usage_events where envelope_id=any($1::uuid[]) and kind='envelope_completed'",
            [[cancelled.e.id, declined.e.id, expired.e.id]],
          )
        ).n,
        0,
      );
    },
  );
  await t.test('team invitations bind verified email, role and organization; retries cannot restore access',async()=>{
    const reader='33333333-3333-4333-8333-333333333333';
    const team=async(user:string,org:string|null,action:string,payload:unknown={})=>(await one('select public.al_team_command($1,$2,$3,$4) data',[user,org,action,payload])).data;
    await actor(a);
    await assert.rejects(team(a,oa,'list'),/permission denied/);
    await service();
    await assert.rejects(team(b,oa,'list'),/ACCESS_DENIED/);
    const hash='9'.repeat(64);
    const inv=await team(a,oa,'create',{email:' B@example.invalid ',role:'sender',tokenHash:hash});
    assert.ok(inv.id);
    await assert.rejects(team(a,oa,'create',{email:'b@example.invalid',role:'reader',tokenHash:'8'.repeat(64)}),/duplicate key/);
    await assert.rejects(team(a,null,'accept',{tokenHash:hash}),/INVALID_INVITATION/);
    await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[b]);await service();
    await assert.rejects(team(b,null,'accept',{tokenHash:hash}),/INVALID_INVITATION/);
    await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[b]);await service();
    assert.equal((await team(b,null,'accept',{tokenHash:hash})).organizationId,oa);
    assert.equal((await team(b,null,'accept',{tokenHash:hash})).accepted,true);
    await assert.rejects(team(b,oa,'create',{email:'new@example.invalid',role:'sender',tokenHash:'7'.repeat(64)}),/ADMIN_REQUIRED/);
    await assert.rejects(team(a,oa,'create',{email:'b@example.invalid',role:'admin',tokenHash:'8'.repeat(64)}),/ALREADY_MEMBER/);
    const listed=await team(a,oa,'list');assert.equal(JSON.stringify(listed).includes(hash),false);
    await assert.rejects(team(a,oa,'leave'),/LAST_OWNER/);
    assert.equal((await team(b,oa,'leave')).left,true);
    assert.equal((await team(b,null,'accept',{tokenHash:hash})).accepted,true);
    await assert.rejects(team(b,oa,'list'),/ACCESS_DENIED/);
    const revoked=await team(a,oa,'create',{email:'b@example.invalid',role:'reader',tokenHash:'8'.repeat(64)});
    await assert.rejects(team(b,ob,'revoke',{id:revoked.id}),/INVITATION_NOT_FOUND/);
    await team(a,oa,'revoke',{id:revoked.id});
    await assert.rejects(team(b,null,'accept',{tokenHash:'8'.repeat(64)}),/INVALID_INVITATION/);
    await db.exec('reset role');await db.query("update public.al_memberships set active=true,role='admin' where organization_id=$1 and user_id=$2",[oa,b]);await service();
    await assert.rejects(team(b,oa,'create',{email:'new@example.invalid',role:'admin',tokenHash:'7'.repeat(64)}),/OWNER_REQUIRED/);
    await db.exec('reset role');await db.query('update public.al_memberships set active=false where organization_id=$1 and user_id=$2',[oa,b]);
    await actor(reader);await assert.rejects(db.query('select * from al_private.team_invitations'),/permission denied/);
  });
  await t.test('password sessions with enrolled MFA are still scoped to their organization',async()=>{
    await db.exec('reset role');await db.query("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[a]);
    await actor(a);
    assert.equal((await db.query('select id from public.al_organizations where id=$1',[oa])).rows.length,1);
    assert.equal((await db.query('select id from public.al_organizations where id=$1',[ob])).rows.length,0);
    await assert.rejects(db.query("select public.al_save_draft($1,'Outside organization')",[ob]),/ACCESS_DENIED/);
    await db.exec('reset role');await db.query('delete from auth.mfa_factors where user_id=$1',[a]);
  });
  await t.test('reminders preserve link, fence repeated requests and isolate status projections',async()=>{
    await actor(a);const e=(await one("select public.al_save_draft($1,'Reminder test') data",[oa])).data;
    const r=(await one("select public.al_add_recipient($1,$2,'Reminder','reminder@example.invalid','email_approval',1) data",[oa,e.id])).data;
    await db.exec('reset role');
    await db.query("update public.al_envelopes set status='sent' where id=$1",[e.id]);
    await db.query("insert into al_private.signing_cases(envelope_id,organization_id,snapshot,snapshot_hash,expires_at) values($1,$2,'{}',$3,now()+interval '1 day')",[e.id,oa,'a'.repeat(64)]);
    const link=crypto.randomUUID();await db.query("insert into al_private.signing_links(id,envelope_id,recipient_id,token_hash,expires_at) values($1,$2,$3,$4,now()+interval '1 day')",[link,e.id,r.id,'b'.repeat(64)]);
    await db.query("insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload,status,created_at) values($1,$2,'invitation',$3,$4,'accepted',now()-interval '31 minutes')",[oa,e.id,crypto.randomUUID(),{recipientId:r.id,linkId:link}]);
    const remind=async(user=a,org=oa)=>(await one('select public.al_remind_signer($1,null,$2,$3,$4) data',[user,org,e.id,r.id])).data;
    await service();await assert.rejects(remind(b,ob),/ENVELOPE_NOT_FOUND/);
    assert.equal((await remind()).count,1);await assert.rejects(remind(),/DELIVERY_PENDING/);
    await db.exec('reset role');await db.query("update al_private.signing_outbox set status='accepted' where envelope_id=$1",[e.id]);await service();await assert.rejects(remind(),/REMINDER_COOLDOWN/);
    for(let i=2;i<=3;i++){
      await db.exec('reset role');await db.query("update al_private.signing_outbox set status='accepted',created_at=now()-interval '31 minutes' where envelope_id=$1",[e.id]);await db.query("update al_private.signing_reminders set last_queued_at=now()-interval '31 minutes' where recipient_id=$1",[r.id]);await service();assert.equal((await remind()).count,i);
    }
    await db.exec('reset role');await db.query("update al_private.signing_outbox set status='reconcile' where envelope_id=$1",[e.id]);await service();await assert.rejects(remind(),/DELIVERY_RECONCILIATION_REQUIRED/);
    await db.exec('reset role');await db.query("update al_private.signing_outbox set status='accepted' where envelope_id=$1",[e.id]);await service();await assert.rejects(remind(),/REMINDER_LIMIT/);
    const own=(await one('select public.al_operational_status($1,null,$2) data',[a,oa])).data;
    assert.ok(own.deliveries.accepted>=4);await assert.rejects(db.query('select public.al_operational_status($1,null,$2)',[b,oa]),/ACCESS_DENIED/);
    await db.exec('reset role');assert.equal((await one('select count(*)::int n from al_private.signing_links where envelope_id=$1',[e.id])).n,1);
    await db.query("update public.al_recipients set status='signed' where id=$1",[r.id]);await service();await assert.rejects(remind(),/RECIPIENT_NOT_PENDING/);
  });
  await t.test('team HTTP adapter hashes opaque tokens before storage and rejects API-key team access',async()=>{
    const {operationsRoute}=await import('../supabase/functions/avtalslank-api/operations.ts');
    const client:any={rpc:async(name:string,args:Record<string,unknown>)=>{try{await service();const keys=Object.keys(args);return{data:(await one(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) data`,Object.values(args))).data,error:null};}catch(error){return{data:null,error};}}};
    const identity={actor:a,keyHash:null,organizationId:oa};
    const request=new Request('https://avtalslank.test/v1/team/invitations',{method:'POST'});
    const v:any=await operationsRoute(request,'/v1/team/invitations',client,identity,{email:'http@example.invalid',role:'reader'});
    assert.match(v.data.token,/^[a-f0-9]{64}$/);
    await db.exec('reset role');const stored=await one('select token_hash from al_private.team_invitations where id=$1',[v.data.id]);assert.equal(stored.token_hash,await sha256Hex(v.data.token));assert.notEqual(stored.token_hash,v.data.token);
    await assert.rejects(operationsRoute(request,'/v1/team/invitations',client,{actor:null,keyHash:'a'.repeat(64),organizationId:null},{email:'http@example.invalid',role:'owner'}),/AUTH_REQUIRED/);
    await assert.rejects(operationsRoute(request,'/v1/team/invitations',client,identity,{email:'http@example.invalid',role:'owner'}),/INVALID_INVITATION/);
  });
  await t.test('cursor API listing enforces roles and tenant scope, intersects filters and does not skip tied timestamps',async()=>{
    await actor(a);await assert.rejects(db.query('select public.al_query_envelopes($1,null,$2)',[a,oa]),/permission denied/);
    await db.exec('reset role');
    const ids=['cc000001-0000-4000-8000-000000000001','cc000001-0000-4000-8000-000000000002','cc000001-0000-4000-8000-000000000003'];
    for(const id of ids)await db.query("insert into public.al_envelopes(id,organization_id,title,status,created_by,updated_at) values($1,$2,'Cursor literal %_','draft',$3,'2026-11-16T10:00:00Z')",[id,oa,a]);
    await service();
    const list=async(actor:string,org:string,filters:any)=>(await one('select public.al_query_envelopes($1,null,$2,$3) data',[actor,org,filters])).data;
    await assert.rejects(list(b,oa,{}),/ACCESS_DENIED/);
    const first=await list(a,oa,{limit:2,query:'literal %_',status:'draft',from:'2026-11-16T00:00:00Z',to:'2026-11-16T23:59:59Z'});assert.equal(first.items.length,2);assert.ok(first.nextCursor);
    const second=await list(a,oa,{limit:2,query:'literal %_',cursor:first.nextCursor});assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);assert.deepEqual([...first.items,...second.items].map((r:any)=>r.id),ids.toReversed());
    assert.equal((await list(a,oa,{query:'nonexistent %_'})).items.length,0);
    for(const filters of [{limit:101},{status:'signed'},{from:'2026-11-17T00:00:00Z',to:'2026-11-16T00:00:00Z'}])await assert.rejects(list(a,oa,filters),/INVALID_QUERY/);
    await assert.rejects(list(a,oa,{cursor:{id:ids[0]}}),/INVALID_CURSOR/);
    await assert.rejects(db.query('select public.al_query_envelopes(null,$1,null,$2)',['not-a-real-key',{}]),/INVALID_API_KEY/);
    const readHash=await sha256Hex('query-synthetic-read-key'),writeHash=await sha256Hex('query-synthetic-write-key');
    await actor(a);const readId=(await one("select public.al_issue_api_key($1,'Query read','al_live_0123abcd',$2,array['envelopes:read']) id",[oa,readHash])).id;
    await db.query("select public.al_issue_api_key($1,'Query write','al_live_0123abce',$2,array['envelopes:write'])",[oa,writeHash]);
    await service();const keyed=(await one('select public.al_query_envelopes(null,$1,$2,$3) data',[readHash,ob,{query:'literal %_'}])).data;assert.equal(keyed.items.length,3);assert.ok(keyed.items.every((e:any)=>e.organization_id===oa));await assert.rejects(db.query('select public.al_query_envelopes(null,$1,null)',[writeHash]),/SCOPE_DENIED/);
    await actor(a);await db.query('select public.al_revoke_api_key($1,$2)',[oa,readId]);await service();await assert.rejects(db.query('select public.al_query_envelopes(null,$1,null)',[readHash]),/INVALID_API_KEY/);
    const {queryRoute}=await import('../supabase/functions/avtalslank-api/query.ts');
    const client:any={rpc:async(_name:string,args:any)=>({data:(await one('select public.al_query_envelopes($1,$2,$3,$4) data',[args.p_actor,args.p_key_hash,args.p_org,args.p_filters])).data,error:null})};
    const response=await queryRoute(new Request('https://avtalslank.test/v1/envelopes?query=literal&limit=2'),'/v1/envelopes',client,{actor:a,keyHash:null,organizationId:oa});assert.ok(response);assert.equal(response.data.length,2);assert.ok(response.page!.nextCursor);
  });
  await t.test('key lifecycle preserves permissions and expiry, rejects expired keys, and rolls back failed rotation',async()=>{
    await service();const manage=async(action:string,payload:any={},who=a,org=oa)=>(await one('select public.al_manage_keys($1,$2,$3,$4) data',[who,org,action,payload])).data;
    const h=await sha256Hex('security-test-key'),h2=await sha256Hex('security-test-rotated');const expiry=new Date(Date.now()+86400000).toISOString();
    const k=await manage('create',{name:'Security integration',prefix:'al_live_99887766',tokenHash:h,scopes:['envelopes:read'],expiresAt:expiry});
    await assert.rejects(manage('list',{},b,oa),/ACCESS_DENIED/);await assert.rejects(manage('list',{},'33333333-3333-4333-8333-333333333333',oa),/ACCESS_DENIED|ADMIN_REQUIRED/);
    const listed=await manage('list');assert.ok(listed.some((x:any)=>x.id===k.id));assert.ok(listed.every((x:any)=>!('token_hash' in x)));
    await one('select public.al_query_envelopes(null,$1,null) data',[h]);await db.exec('reset role');assert.ok((await one('select last_used_at from public.al_api_keys where id=$1',[k.id])).last_used_at);await service();
    await assert.rejects(manage('rotate',{id:k.id,prefix:'al_live_99887767',tokenHash:h}),/duplicate key/);
    await one('select public.al_query_envelopes(null,$1,null) data',[h]);
    const rotated=await manage('rotate',{id:k.id,prefix:'al_live_99887768',tokenHash:h2,scopes:['envelopes:write'],expiresAt:null});
    await assert.rejects(one('select public.al_query_envelopes(null,$1,null) data',[h]),/INVALID_API_KEY/);await one('select public.al_query_envelopes(null,$1,null) data',[h2]);
    await assert.rejects(manage('rotate',{id:k.id,prefix:'al_live_99887769',tokenHash:await sha256Hex('third')}),/KEY_NOT_ACTIVE/);
    await db.exec('reset role');const row=await one('select scopes,expires_at from public.al_api_keys where id=$1',[rotated.id]);assert.deepEqual(row.scopes,['envelopes:read']);assert.equal(new Date(row.expires_at).toISOString(),expiry);
    await db.query("update public.al_api_keys set expires_at=now()-interval '1 second' where id=$1",[rotated.id]);await service();
    for(const sql of ['select public.al_query_envelopes(null,$1,null)','select public.al_api_dispatch($1,\'envelopes.list\',\'{}\',null)','select al_private.api_execute($1,\'envelopes.list\',\'{}\')'])await assert.rejects(db.query(sql,[h2]),/INVALID_API_KEY/);
    await assert.rejects(manage('create',{name:'Expired',prefix:'al_live_99887770',tokenHash:await sha256Hex('expired'),scopes:['envelopes:read'],expiresAt:'2020-01-01T00:00:00Z'}),/INVALID_KEY_EXPIRY/);
    const cacheHash=await sha256Hex('cached-security-key');const cacheKey=await manage('create',{name:'Cached mutation',prefix:'al_live_99887772',tokenHash:cacheHash,scopes:['envelopes:write']});
    await assert.rejects(one('select public.al_query_envelopes(null,$1,null) data',[cacheHash]),/SCOPE_DENIED/);await db.exec('reset role');assert.equal((await one('select last_used_at from public.al_api_keys where id=$1',[cacheKey.id])).last_used_at,null);await service();
    const cached=await one("select public.al_api_dispatch($1,'save_draft',$2,'security-cache-001') data",[cacheHash,{title:'Security cached mutation'}]);assert.deepEqual((await one("select public.al_api_dispatch($1,'save_draft',$2,'security-cache-001') data",[cacheHash,{title:'Security cached mutation'}])).data,cached.data);
    await db.exec('reset role');await db.query("update public.al_api_keys set expires_at=now()-interval '1 second' where id=$1",[cacheKey.id]);await service();await assert.rejects(one("select public.al_api_dispatch($1,'save_draft',$2,'security-cache-001') data",[cacheHash,{title:'Security cached mutation'}]),/INVALID_API_KEY/);
    const foreign=await manage('create',{name:'Other tenant',prefix:'al_live_99887771',tokenHash:await sha256Hex('foreign-security'),scopes:['envelopes:read']},b,ob);
    assert.ok((await manage('revoke_all')).count>0);await db.exec('reset role');assert.equal((await one('select revoked_at from public.al_api_keys where id=$1',[foreign.id])).revoked_at,null);
  });
  await t.test('legal evidence matches the published snapshot, requires explicit verified acceptance and is immutable',async()=>{
    await service();const legal=async(who:string,action='read',payload={})=>(await one('select public.al_legal_account($1,$2,$3) data',[who,action,payload])).data;
    const before=await legal(a);assert.equal(before.accepted,false);assert.deepEqual(before.history,[]);
    const html=await readFile(new URL('../public'+before.document.url,import.meta.url),'utf8');assert.equal(await sha256Hex(html),before.document.sha256);
    await assert.rejects(legal(a,'accept',{...before.document,accepted:false}),/TERMS_REQUIRED/);
    await assert.rejects(legal(a,'accept',{...before.document,accepted:true,sha256:'0'.repeat(64)}),/LEGAL_VERSION_CHANGED/);
    const accepted=await legal(a,'accept',{...before.document,accepted:true});assert.equal(accepted.accepted,true);assert.ok(accepted.acceptedAt);assert.equal(accepted.history.length,1);
    assert.equal((await legal(a,'accept',{...before.document,accepted:true})).acceptedAt,accepted.acceptedAt);assert.equal((await legal(b)).history.length,0);
    await db.exec('reset role');await assert.rejects(db.query('update al_private.legal_acceptances set accepted_at=now() where user_id=$1',[a]),/IMMUTABLE_LEGAL_EVIDENCE/);await assert.rejects(db.query('delete from al_private.legal_documents'),/IMMUTABLE_LEGAL_EVIDENCE/);
    await db.query('update auth.users set email_confirmed_at=null where id=$1',[b]);await service();await assert.rejects(legal(b,'accept',{...before.document,accepted:true}),/EMAIL_VERIFICATION_REQUIRED/);
    await actor(a);await assert.rejects(db.query('select * from al_private.legal_acceptances'),/permission denied/);await assert.rejects(db.query("select public.al_legal_account($1,'read')",[b]),/permission denied/);
  });
  await t.test('plan interest uses optimistic revisions and never activates billing',async()=>{
    await service();const pref=async(who:string,save=false,plan:string|null=null,revision:number|null=null)=>(await one('select public.al_plan_preference($1,$2,$3,$4,$5) data',[who,oa,save,plan,revision])).data;
    const old=await pref(a);assert.equal(old.revision,0);assert.equal(old.canManage,true);assert.equal((await pref('33333333-3333-4333-8333-333333333333')).canManage,false);
    await assert.rejects(pref(b),/ACCESS_DENIED/);await assert.rejects(pref('33333333-3333-4333-8333-333333333333',true,'team',0),/ACCESS_DENIED|ADMIN_REQUIRED/);
    assert.equal((await pref(a,true,'team',0)).revision,1);await assert.rejects(pref(a,true,'api',0),/VERSION_CONFLICT/);await assert.rejects(pref(a,true,'invented',1),/INVALID_PLAN/);
    assert.equal((await pref(a,true,null,1)).plan,null);await db.exec('reset role');assert.equal((await one('select enabled from public.al_billing_accounts where organization_id=$1',[oa])).enabled,false);
  });
  await t.test('webhook rotation requires a disabled tenant-owned endpoint and blocks uncertain delivery',async()=>{
    await service();const w=(await one("select public.al_configure_webhook($1,$2,'https://example.com/security-webhook',$3) data",[a,oa,'a'.repeat(64)])).data;
    const rotate=async(who=a,org=oa)=>(await one('select public.al_rotate_webhook($1,$2,$3,$4) data',[who,org,w.id,'b'.repeat(64)])).data;
    await assert.rejects(rotate(),/WEBHOOK_MUST_BE_DISABLED/);await assert.rejects(rotate(b,ob),/WEBHOOK_NOT_FOUND/);
    await db.exec('reset role');await db.query('update public.al_webhook_endpoints set active=false where id=$1',[w.id]);await db.query("insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload,status) values($1,$2,'webhook',$3,$4,'reconcile')",[oa,(await one('select envelope_id from al_private.signing_cases where organization_id=$1 limit 1',[oa])).envelope_id,crypto.randomUUID(),{endpointId:w.id}]);await service();await assert.rejects(rotate(),/WEBHOOK_DELIVERIES_PENDING/);
    await db.exec('reset role');await db.query("update al_private.signing_outbox set status='accepted' where payload->>'endpointId'=$1",[w.id]);await service();assert.equal((await rotate()).rotated,true);await db.exec('reset role');assert.equal((await one('select secret from al_private.webhook_secrets where endpoint_id=$1',[w.id])).secret,'b'.repeat(64));
  });
  await t.test('security HTTP boundary uses verified identity and stores a hash instead of the raw API credential',async()=>{
    const {securityRoute}=await import('../supabase/functions/avtalslank-api/security.ts');const client:any={rpc:async(name:string,args:Record<string,unknown>)=>{try{await service();const ks=Object.keys(args);return{data:(await one(`select public.${name}(${ks.map((k,i)=>`${k} => $${i+1}`).join(',')}) data`,Object.values(args))).data,error:null};}catch(error){return{data:null,error};}}};
    const req=new Request('https://avtalslank.test/v1/security/keys',{method:'POST'}),identity={actor:a,keyHash:null,organizationId:oa};
    const v:any=await securityRoute(req,'/v1/security/keys',client,identity,{action:'create',name:'HTTP integration',scopes:['envelopes:read'],expiryDays:30});assert.match(v.data.key,/^al_live_[a-f0-9]{64}$/);
    await db.exec('reset role');const stored=await one('select token_hash,expires_at from public.al_api_keys where id=$1',[v.data.id]);assert.equal(stored.token_hash,await sha256Hex(v.data.key));assert.ok(stored.expires_at);
    await assert.rejects(securityRoute(req,'/v1/security/keys',client,{...identity,keyHash:'x'},{action:'revoke_all'}),/AUTH_REQUIRED/);
    await assert.rejects(securityRoute(req,'/v1/security/keys',client,identity,{action:'create',name:'Bad',scopes:['owner'],expiryDays:30}),/INVALID_KEY/);
  });
  await t.test('copied template fields persist independently with version fencing, tenant checks and bounded draft expiry',async()=>{
    const {applyTemplate}=await import('../packages/editor/src/index.ts');
    await actor(a);const e=(await one("select public.al_save_draft($1,'Template editor contract') data",[oa])).data;
    const recipient=(await one("select public.al_add_recipient($1,$2,'Mapped signer','mapped@example.invalid','email_approval',1) data",[oa,e.id])).data;
    const source=[{id:crypto.randomUUID(),label:'Kundnamn',type:'text',recipientRole:'Kund',required:false,page:1,x:0.1,y:0.2,width:0.4,height:0.05}];
    const template=(await one("select public.al_save_template($1,'Editor template',$2) data",[oa,source])).data;
    const doc={id:crypto.randomUUID(),status:'ready',page_count:2};await db.exec('reset role');await db.query("insert into public.al_documents(id,organization_id,envelope_id,name,storage_path,sha256,byte_size,status,page_count) values($1,$2,$3,'editor.pdf',$4,$5,5,'ready',2)",[doc.id,oa,e.id,oa+'/'+e.id+'/'+doc.id+'/original.pdf','a'.repeat(64)]);
    const copied=applyTemplate(template,doc,{Kund:recipient.id},[recipient],[]);await service();let current=(await flow(e.id,'read')).envelope;
    const saved=await flow(e.id,'fields',{generation:current.generation,fields:copied});assert.equal(saved.fields[0].required,false);assert.equal(saved.fields[0].page,1);assert.notEqual(saved.fields[0].id,source[0].id);
    await assert.rejects(flow(e.id,'fields',{generation:current.generation,fields:copied}),/VERSION_CONFLICT/);
    await assert.rejects(flow(e.id,'fields',{generation:saved.generation,fields:[{...copied[0],recipientId:b}]}),/INVALID_FIELD_ASSIGNMENT/);
    await assert.rejects(db.query("select public.al_flow_command($1,null,$2,$3,'fields',$4)",[b,ob,e.id,{generation:saved.generation,fields:copied}]),/ENVELOPE_NOT_FOUND/);
    await actor(a);await one('select public.al_save_template($1,$2,$3,$4,$5) data',[oa,'Changed editor template',[{...source[0],label:'Changed role text'}],template.id,template.version]);
    assert.equal((await one('select fields from public.al_envelopes where id=$1',[e.id])).fields[0].label,'Kundnamn');
    const updated=(await one("select public.al_save_draft($1,'Template editor contract','',false,30,$2,$3) data",[oa,e.id,saved.generation])).data;assert.equal(updated.expires_days,30);
    for(const days of [0,91])await assert.rejects(db.query("select public.al_save_draft($1,'Invalid expiry','',false,$2,$3,$4)",[oa,days,e.id,updated.generation]),/al_envelopes_expires_days_check/);
    await db.query('select public.al_cancel_envelope($1,$2)',[oa,e.id]);await service();await assert.rejects(flow(e.id,'fields',{generation:updated.generation,fields:copied}),/DOCUMENT_LOCKED/);
  });
  await t.test('contact import validates the entire batch, normalizes identity, skips existing and replays safely',async()=>{
    await service();const request=crypto.randomUUID();const run=async(rows:any,id=request,who=a,org=oa)=>(await one('select public.al_contact_import($1,null,$2,$3,$4) data',[who,org,id,rows])).data;
    await assert.rejects(run([{name:'Should roll back',email:'rollback-import@example.invalid',company:''},{name:'X',email:'bad'}]),/INVALID_CONTACT_IMPORT/);
    await db.exec('reset role');assert.equal((await one("select count(*)::int n from public.al_contacts where email='rollback-import@example.invalid'")).n,0);await service();
    await assert.rejects(run([{name:'First',email:'Dupe@example.invalid'},{name:'Second',email:'dupe@example.invalid'}]),/DUPLICATE_IMPORT_EMAIL/);
    const first=await run([{name:' Import Contact ',email:' IMPORT@EXAMPLE.INVALID ',company:' Co '}]);assert.equal(first.created,1);assert.equal(first.total,1);
    assert.deepEqual(await run([{name:'Import Contact',email:'import@example.invalid',company:'Co'}]),first);
    await assert.rejects(run([{name:'Different',email:'other-import@example.invalid'}]),/IDEMPOTENCY_CONFLICT/);
    await db.exec('reset role');const row=await one("select * from public.al_contacts where organization_id=$1 and email='import@example.invalid'",[oa]);await db.query('update public.al_contacts set archived=true where id=$1',[row.id]);await service();
    const skipped=await run([{name:'Do not overwrite',email:'import@example.invalid',company:'Changed'}],crypto.randomUUID());assert.equal(skipped.skipped,1);assert.equal(skipped.archivedSkipped,1);
    await db.exec('reset role');const preserved=await one('select * from public.al_contacts where id=$1',[row.id]);assert.equal(preserved.name,'Import Contact');assert.equal(preserved.version,row.version);assert.equal(preserved.archived,true);await service();
    await assert.rejects(run([{name:'Foreign',email:'foreign-import@example.invalid'}],crypto.randomUUID(),b,oa),/ACCESS_DENIED/);
    await assert.rejects(run([{name:'Reader',email:'reader-import@example.invalid'}],crypto.randomUUID(),'33333333-3333-4333-8333-333333333333',oa),/ACCESS_DENIED/);
    const history=(await one('select public.al_contact_import($1,null,$2) data',[a,oa])).data;assert.ok(history.some((h:any)=>h.requestId===request));assert.ok(!JSON.stringify(history).includes('import@example.invalid'));
    await actor(a);await assert.rejects(db.query('select * from al_private.contact_imports'),/permission denied/);await assert.rejects(db.query('select public.al_contact_import($1,null,$2)',[a,oa]),/permission denied/);
  });
  await t.test('contact import HTTP adapter and API-key scope reject unauthorized replay and metadata injection',async()=>{
    await service();const {contactsRoute}=await import('../supabase/functions/avtalslank-api/contacts.ts');const client:any={rpc:async(name:string,args:any)=>{try{await service();const ks=Object.keys(args);return{data:(await one(`select public.${name}(${ks.map((k,i)=>`${k} => $${i+1}`).join(',')}) data`,Object.values(args))).data,error:null};}catch(error){return{data:null,error};}}};
    const req=new Request('https://avtalslank.test/v1/contacts/imports',{method:'POST'});const body={requestId:crypto.randomUUID(),rows:[{name:'API import',email:'api-import@example.invalid'}]};
    const hash=await sha256Hex('contact-import-api-key');await actor(a);const key=(await one("select public.al_issue_api_key($1,'Contact import','al_live_87654321',$2,array['envelopes:write']) id",[oa,hash])).id;
    const identity={actor:null,keyHash:hash,organizationId:ob};const v:any=await contactsRoute(req,'/v1/contacts/imports',client,identity,body);assert.equal(v.data.created,1);
    await assert.rejects(contactsRoute(new Request('https://avtalslank.test/v1/contacts/imports'),'/v1/contacts/imports',client,identity,{}),/SCOPE_DENIED/);
    await assert.rejects(contactsRoute(req,'/v1/contacts/imports',client,{actor:a,keyHash:null,organizationId:oa},{...body,requestId:crypto.randomUUID(),rows:[{name:'Injected',email:'inject@example.invalid',organizationId:ob}]}),/INVALID_CONTACT_IMPORT/);
    await actor(a);await db.query('select public.al_revoke_api_key($1,$2)',[oa,key]);await assert.rejects(contactsRoute(req,'/v1/contacts/imports',client,identity,body),/INVALID_API_KEY/);
  });
  await t.test('registration intent stays private until verified email and company provisioning is idempotent',async()=>{
    await db.exec('reset role');const user=crypto.randomUUID();const payload={kind:'company',fullName:'Test Contact',companyName:'Registration Test AB',registrationNumber:'559999-9991',companyEmail:'office@example.invalid',phone:'010000000',role:'owner',organizationId:ob};
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'registration-company@example.invalid',null,$2)",[user,{registration:payload,plan_interest:'api'}]);
    const stored=await one('select raw_user_meta_data from auth.users where id=$1',[user]);assert.ok(!stored.raw_user_meta_data.registration);assert.equal(stored.raw_user_meta_data.plan_interest,'api');
    assert.equal((await one('select count(*)::int n from public.al_memberships where user_id=$1',[user])).n,0);
    await service();const reg=async(action='read',data={})=>(await one('select public.al_registration($1,$2,$3) data',[user,action,data])).data;
    assert.equal((await reg()).hasDraft,true);await assert.rejects(reg('complete'),/EMAIL_VERIFICATION_REQUIRED/);
    await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[user]);await service();
    const first=await reg('complete');assert.equal(first.kind,'company');assert.equal(first.email,'registration-company@example.invalid');assert.notEqual(first.organizationId,ob);assert.deepEqual(await reg('complete',{kind:'personal'}),first);
    await db.exec('reset role');const org=await one('select * from public.al_organizations where id=$1',[first.organizationId]);assert.equal(org.name,'Registration Test AB');assert.equal(org.registration_number,'5599999991');assert.equal(org.kind,'company');
    assert.equal((await one('select count(*)::int n from public.al_memberships where user_id=$1',[user])).n,1);assert.equal((await one('select enabled from public.al_billing_accounts where organization_id=$1',[first.organizationId])).enabled,false);assert.equal((await one('select count(*)::int n from al_private.registration_drafts where user_id=$1',[user])).n,0);
    const other=crypto.randomUUID();await db.query("insert into auth.users(id,email) values($1,'registration-other@example.invalid')",[other]);await service();
    await assert.rejects(db.query("select public.al_registration($1,'complete',$2)",[other,{...payload,existingOrganizationId:first.organizationId}]),/ACCESS_DENIED/);
    await assert.rejects(db.query("select public.al_registration($1,'complete',$2)",[other,payload]),/COMPANY_ALREADY_REGISTERED/);
    await actor(other);assert.equal((await db.query('select id from public.al_organizations where id=$1',[first.organizationId])).rows.length,0);
    await db.exec('reset role');await db.query("insert into public.al_memberships(organization_id,user_id,role,active) values($1,$2,'reader',true)",[first.organizationId,other]);await service();const joined=(await one("select public.al_registration($1,'complete',$2) data",[other,payload])).data;assert.equal(joined.organizationId,first.organizationId);await db.exec('reset role');assert.equal((await one('select role from public.al_memberships where user_id=$1 and organization_id=$2',[other,first.organizationId])).role,'reader');await actor(other);await assert.rejects(db.query('select * from al_private.account_profiles'),/permission denied/);await assert.rejects(db.query("select public.al_registration($1,'read')",[user]),/permission denied/);
  });
  await t.test('private signup creates only its own workspace and keeps personal number out of memberships and JWT metadata',async()=>{
    await db.exec('reset role');const user=crypto.randomUUID();const payload={kind:'personal',fullName:'Private Test',personalNumber:'199001010017',phone:'010000001',companyName:'Ignored',registrationNumber:'5568554884'};
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'registration-private@example.invalid',$2)",[user,{registration:payload}]);
    assert.ok(!JSON.stringify((await one('select raw_user_meta_data from auth.users where id=$1',[user])).raw_user_meta_data).includes('199001010017'));
    await service();const result=(await one("select public.al_registration($1,'complete') data",[user])).data;assert.equal(result.kind,'personal');assert.ok(!JSON.stringify(result).includes('199001010017'));
    await assert.rejects(db.query("select public.al_team_command($1,$2,'create',$3)",[user,result.organizationId,{email:'not-invited@example.invalid',role:'reader',tokenHash:'f'.repeat(64)}]),/COMPANY_ACCOUNT_REQUIRED/);
    await db.exec('reset role');const org=await one('select * from public.al_organizations where id=$1',[result.organizationId]);assert.equal(org.kind,'personal');assert.equal(org.registration_number,null);assert.ok(!JSON.stringify(org).includes('199001010017'));assert.equal((await one('select personal_number from al_private.account_profiles where user_id=$1',[user])).personal_number,'199001010017');
    await assert.rejects(db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'invalid-registration@example.invalid',$2)",[crypto.randomUUID(),{registration:{...payload,personalNumber:'199001010018'}}]),/INVALID_REGISTRATION/);
  });

  await t.test('platform requires an explicit admin grant; payments gate every key and cached replay',async()=>{
    await actor(a);await assert.rejects(db.query("select public.al_platform('list')"),/PLATFORM_ADMIN_REQUIRED/);
    await db.exec('reset role');await db.query('insert into al_private.platform_admins(user_id) values($1)',[a]);
    await actor(a);
    assert.ok(Array.isArray((await one("select public.al_platform('list') data")).data));
    await assert.rejects(db.query("select public.al_platform('member',$1,$2)",[oa,{userId:a,role:'reader',active:true,reason:'Test last owner protection'}]),/LAST_OWNER/);
    await assert.rejects(db.query("select public.al_platform('record_payment',$1,$2)",[oa,{model:'per_document',reference:'not-paid',paidUntil:new Date(Date.now()+86400000).toISOString(),reason:'Test unsupported billing model'}]),/INVALID_PAYMENT/);
    await one("select public.al_platform('suspend_api',$1,$2)",[oa,{suspended:true,reason:'Test payment enforcement'}]);
    await db.exec('reset role');const hash='f'.repeat(64);await db.query("insert into public.al_api_keys(organization_id,name,prefix,token_hash,scopes,created_by) values($1,'payment-test','al_test',$2,array['envelopes:read'],$3)",[oa,hash,a]);
    await actor(a,'service_role');await assert.rejects(db.query('select public.al_api_payment_guard($1)',[hash]),/PAYMENT_REQUIRED/);
    await assert.rejects(db.query("select public.al_api_dispatch($1,'list_envelopes','{}',null)",[hash]),/PAYMENT_REQUIRED/);
    await db.exec('reset role');await db.query('update al_private.api_entitlements set suspended=false where organization_id=$1',[oa]);
    await actor(a,'service_role');await db.query('select public.al_api_payment_guard($1)',[hash]);
    await db.exec('reset role');await db.query("update al_private.api_entitlements set paid_until=now()-interval '1 second' where organization_id=$1",[oa]);await actor(a,'service_role');await assert.rejects(db.query('select public.al_api_payment_guard($1)',[hash]),/PAYMENT_REQUIRED/);
  });


  await t.test('commercial prices preserve versions and company snapshots; paid API cannot be granted by price edits',async()=>{
    await actor(b);await assert.rejects(db.query("select public.al_platform_commercial('catalog')"),/PLATFORM_ADMIN_REQUIRED/);
    await actor(a);assert.ok((await one("select public.al_platform_commercial('catalog') data")).data);
    const admin=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');};
    await admin();const call=async(action:string,payload:any={},org:string|null=null)=>(await one('select public.al_platform_commercial($1,$2,$3) data',[action,org,payload])).data;
    const terms={name:'API Test',description:'Synthetic only',model:'subscription',interval:'month',baseOre:19900,documentOre:0,includedDocuments:100,userLimit:5,bindingMonths:2,noticeMonths:1,apiIncluded:true};
    await assert.rejects(call('save_price',{code:'api',revision:0,reason:'Testing invalid money',terms:{...terms,baseOre:-1}}),/INVALID_PRICE/);
    await call('save_price',{code:'api',revision:0,reason:'Initial synthetic catalog',terms});
    let catalog=await call('catalog');assert.equal(catalog[0].revision,1);const priceId=catalog[0].id;
    assert.deepEqual((await one('select public.al_public_prices() data')).data,[]);
    await call('publish_price',{code:'api',revision:1,reason:'Publishing test catalog'});
    await call('assign_offer',{priceId,revision:0,reference:'private-offer-a',baseOre:15000,reason:'Customer specific test offer'},oa);
    await assert.rejects(call('assign_offer',{priceId,revision:0,reference:'duplicate',reason:'Reject stale assignment'},oa),/VERSION_CONFLICT/);
    await call('save_price',{code:'api',revision:2,reason:'Update list price only',terms:{...terms,baseOre:29900}});
    assert.equal((await one('select public.al_public_prices() data')).data[0].terms.baseOre,19900);
    let company=await call('company',{},oa);assert.equal(company.offer.snapshot.baseOre,15000);
    await call('publish_price',{code:'api',revision:3,reason:'Publish revised list price'});
    assert.equal((await one('select public.al_public_prices() data')).data[0].terms.baseOre,29900);
    await db.exec('reset role');await assert.rejects(db.query('update al_private.catalog_versions set terms=$1 where id=$2',[terms,priceId]),/IMMUTABLE_AUDIT/);
    await actor(b);await assert.rejects(db.query('select public.al_my_commercial($1)',[oa]),/ACCESS_DENIED/);await assert.rejects(db.query('select * from al_private.commercial_offers'),/permission denied/);
    await actor(a,'service_role');await assert.rejects(db.query('select public.al_api_payment_guard($1)',['f'.repeat(64)]),/PAYMENT_REQUIRED/);
    await admin();await call('save_price',{code:'noapi',revision:0,reason:'Non API price test',terms:{...terms,apiIncluded:false}});catalog=await call('catalog');const noapi=catalog.find((c:any)=>c.code==='noapi');
    await call('assign_offer',{priceId:noapi.id,revision:1,reference:'no-api-offer',reason:'Remove API from price scope'},oa);
    await db.exec('reset role');await db.query("update al_private.api_entitlements set paid_until=now()+interval '1 day' where organization_id=$1",[oa]);await actor(a,'service_role');await assert.rejects(db.query('select public.al_api_payment_guard($1)',['f'.repeat(64)]),/PAYMENT_REQUIRED/);
    await admin();await call('note',{body:'Synthetic support note',reason:'Record support context'},oa);company=await call('company',{},oa);assert.equal(company.history.length,2);assert.equal(company.notes[0].body,'Synthetic support note');
    const billing=(await one('select public.al_platform_billing_status() data')).data;assert.equal(Number(billing.sync.find((j:any)=>j.status==='blocked').count),4);
    await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'anon'})]);await db.exec('set role anon');const pub=await one('select public.al_public_prices() data');assert.ok(!JSON.stringify(pub).includes('private-offer-a'));await assert.rejects(db.query("select public.al_platform_commercial('catalog')"),/permission denied/);
  });

  await t.test('signed search isolates tenants and final document charges are unique frozen records',async()=>{
    await db.exec('reset role');const row=await one("select e.id,c.price_quote from public.al_envelopes e join al_private.signing_cases c on c.envelope_id=e.id where e.organization_id=$1 and e.status='completed' and c.price_quote is not null limit 1",[oa]);assert.ok(row);
    await db.exec('reset role');const count=await one('select count(*)::int n from al_private.document_charges where envelope_id=$1',[row.id]);assert.equal(count.n,row.price_quote.documents);
    const r=await one('select name,email from public.al_recipients where envelope_id=$1 limit 1',[row.id]);
    await actor(a,'service_role');const search=(await one('select public.al_search_signed($1,null,$2,$3,null,100) data',[a,oa,r.email])).data;assert.ok(search.items.some((x:any)=>x.id===row.id));assert.ok(!JSON.stringify(search).includes('personalNumber'));
    await assert.rejects(db.query('select public.al_search_signed($1,null,$2,$3,null,100)',[b,oa,r.email]),/ACCESS_DENIED/);
    await db.exec('reset role');await db.query('update al_private.signing_cases set finalized_at=finalized_at where envelope_id=$1',[row.id]);assert.equal((await one('select count(*)::int n from al_private.document_charges where envelope_id=$1',[row.id])).n,count.n);
    await assert.rejects(db.query("update al_private.signing_cases set price_quote='{}' where envelope_id=$1",[row.id]),/IMMUTABLE_PRICE_QUOTE/);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');const tariff=(await one('select public.al_admin_document_tariff($1) data',[oa])).data;assert.equal(tariff.tariff.document_ore,1000);
    await one('select public.al_admin_document_tariff($1,$2) data',[oa,{version:tariff.tariff.version,documentOre:10000,includedSigners:1,extraSignerOre:2500,reason:'Verify future tariff isolation'}]);
    await db.exec('reset role');const fixture=crypto.randomUUID(),recipient=crypto.randomUUID();
    await db.query("insert into public.al_envelopes(id,organization_id,title,status,created_by) values($1,$2,'Signed party search fixture','completed',$3)",[fixture,oa,a]);
    await db.query("insert into public.al_recipients(id,organization_id,envelope_id,name,email,method,position,status,company_name,registration_number) values($1,$2,$3,'Search Signer','signed-party@example.invalid','email_approval',1,'signed','Kundbolag Sök AB','5568554884')",[recipient,oa,fixture]);
    await db.query("insert into al_private.signing_cases(envelope_id,organization_id,snapshot,snapshot_hash,expires_at,finalized_at) values($1,$2,'{}',$3,now()+interval '1 day',now())",[fixture,oa,'a'.repeat(64)]);
    await actor(a,'service_role');for(const term of ['Kundbolag Sök','556855-4884','signed-party@example.invalid','Search Signer']){const found=(await one('select public.al_search_signed($1,null,$2,$3,null,100) data',[a,oa,term])).data;assert.ok(found.items.some((x:any)=>x.id===fixture));}
    const firstPage=(await one("select public.al_search_signed($1,null,$2,'',null,1) data",[a,oa])).data;assert.equal(firstPage.items.length,1);assert.ok(firstPage.nextCursor);const nextPage=(await one("select public.al_search_signed($1,null,$2,'',$3,1) data",[a,oa,firstPage.nextCursor])).data;assert.notEqual(nextPage.items[0].id,firstPage.items[0].id);
    await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');assert.ok((await one("select public.al_admin_search_signed('Kundbolag Sök') data")).data.items.some((x:any)=>x.id===fixture));
    await db.exec('reset role');const saved=await one('select price_quote from al_private.signing_cases where envelope_id=$1',[row.id]);assert.deepEqual(saved.price_quote,row.price_quote);
  });

  await t.test('global document price is public and versioned while company overrides win',async()=>{
    await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');
    await one('select public.al_admin_document_tariff(null,$1) data',[{version:0,documentOre:2000,includedSigners:1,extraSignerOre:500,reason:'Publish general document price'}]);
    const pub=(await one('select public.al_public_document_price() data')).data;assert.equal(pub.documentOre,2000);assert.equal(pub.organization_id,undefined);
    await assert.rejects(db.query('select public.al_admin_document_tariff(null,$1)',[{version:0,documentOre:3000,includedSigners:1,extraSignerOre:500,reason:'Stale general price update'}]),/VERSION_CONFLICT/);
    await db.exec('reset role');const globalOrg=crypto.randomUUID();await db.query("insert into public.al_organizations(id,name) values($1,'Default price fixture')",[globalOrg]);await db.query("insert into public.al_memberships(organization_id,user_id,role) values($1,$2,'owner')",[globalOrg,a]);
    await db.query('update al_private.platform_admins set active=false where user_id=$1',[a]);
    for(const [org,expected] of [[globalOrg,2500],[oa,12500]] as const){const env=crypto.randomUUID(),doc=crypto.randomUUID();await db.query("insert into public.al_envelopes(id,organization_id,title,created_by) values($1,$2,'Price inheritance test',$3)",[env,org,a]);await db.query("insert into public.al_documents(id,organization_id,envelope_id,name,storage_path,sha256,byte_size) values($1,$2,$3,'test.pdf',$4,$5,5)",[doc,org,env,doc+'.pdf','a'.repeat(64)]);for(let i=1;i<=2;i++)await db.query("insert into public.al_recipients(organization_id,envelope_id,name,email,method,position) values($1,$2,'Test signer',$3,'email_approval',$4)",[org,env,'default'+i+'@example.invalid',i]);await actor(a,'service_role');assert.equal((await one('select public.al_document_quote($1,null,$2,$3) data',[a,org,env])).data.unitOre,expected);await db.exec('reset role');}
    await db.query('update al_private.platform_admins set active=true where user_id=$1',[a]);
    await actor(b);await assert.rejects(db.query('select public.al_admin_document_tariff(null,$1)',[{version:1,documentOre:10,includedSigners:1,extraSignerOre:0,reason:'Unauthorized price change'}]),/PLATFORM_ADMIN_REQUIRED/);
  });

  await t.test('catalog document offers feed signing tariff and changed recipients invalidate accepted price',async()=>{
    const admin=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');};await admin();
    const terms={name:'Signer plan',description:'Test tariff',model:'per_document',interval:'month',baseOre:0,documentOre:1000,includedDocuments:0,userLimit:0,bindingMonths:0,noticeMonths:0,apiIncluded:true,includedSigners:2,extraSignerOre:300};
    await one("select public.al_platform_commercial('save_price',null,$1) data",[{code:'signerplan',revision:0,reason:'Create integrated signer pricing',terms}]);
    const catalog=(await one("select public.al_platform_commercial('catalog') data")).data;const plan=catalog.find((x:any)=>x.code==='signerplan');assert.equal(plan.terms.extraSignerOre,300);
    const company=(await one("select public.al_platform_commercial('company',$1) data",[oa])).data;
    await one("select public.al_platform_commercial('assign_offer',$1,$2) data",[oa,{priceId:plan.id,revision:company.offer.revision,reference:'integrated-signer-plan',reason:'Use package price for signing'}]);
    await db.exec('reset role');await db.query("insert into public.al_memberships(organization_id,user_id,role,active) values($1,$2,'sender',true) on conflict(organization_id,user_id) do update set role='sender',active=true",[oa,b]);const e=await one("select id,generation from public.al_envelopes where organization_id=$1 and title='Price inheritance test' limit 1",[oa]);await service();const q=(await one('select public.al_document_quote($1,null,$2,$3) data',[b,oa,e.id])).data;assert.equal(q.unitOre,1000);
    await admin();await db.query("select public.al_add_recipient($1,$2,'Extra signer','extra-signer@example.invalid','email_approval',3)",[oa,e.id]);
    await service();const next=(await one('select public.al_document_quote($1,null,$2,$3) data',[b,oa,e.id])).data;assert.equal(next.unitOre,1300);assert.notEqual(next.hash,q.hash);
    const snap=await flow(e.id,'read');const payload={generation:e.generation,snapshot:snap,keyFingerprint:'f'.repeat(64),priceHash:q.hash,links:await Promise.all(snap.recipients.map(async(r:any)=>({id:crypto.randomUUID(),recipientId:r.id,tokenHash:await sha256Hex(crypto.randomUUID())})))};
    await db.exec('reset role');await db.query("update public.al_documents set status='ready',page_count=1 where envelope_id=$1",[e.id]);await service();await db.query("select public.al_signing_worker('heartbeat',null,null,$1)",[{ready:true,keyFingerprint:'f'.repeat(64)}]);payload.snapshot=await flow(e.id,'read');
    await assert.rejects(db.query("select public.al_flow_command($1,null,$2,$3,'send',$4)",[b,oa,e.id,payload]),/PRICE_CHANGED/);
    await db.exec('reset role');assert.equal((await one('select count(*)::int n from al_private.signing_cases where envelope_id=$1',[e.id])).n,0);
    await admin();
    assert.equal((await one('select public.al_admin_complimentary_signing($1,true,$2) data',[oa,'Grant free signing for test company'])).data,true);
    await actor(b);
    await assert.rejects(db.query('select public.al_admin_complimentary_signing($1,false,$2)',[oa,'User cannot revoke assigned access']),/PLATFORM_ADMIN_REQUIRED/);
    await service();const free=(await one('select public.al_document_quote($1,null,$2,$3) data',[b,oa,e.id])).data;
    assert.equal(free.complimentary,true);assert.equal(free.totalOre,0);
    await admin();
    assert.equal((await one('select public.al_admin_complimentary_signing($1,false,$2) data',[oa,'Revoke free signing for test company'])).data,false);
    await service();assert.equal((await one('select public.al_document_quote($1,null,$2,$3) data',[a,oa,e.id])).data.complimentary,true);
    assert.equal((await one('select public.al_document_quote($1,null,$2,$3) data',[b,oa,e.id])).data.totalOre,1300);
    await db.exec('reset role');
    await db.query("update public.al_memberships set role='admin',active=false where organization_id=$1 and user_id=$2",[oa,b]);

  });
  await t.test('PDF templates bind a private existing source and reject foreign organization access',async()=>{
    const path=oa+'/templates/'+crypto.randomUUID()+'.pdf';
    const fields=[{id:crypto.randomUUID(),label:'Förnamn',recipientRole:'Avsändare',type:'text',required:true,page:0,x:0.1,y:0.2,width:0.4,height:0.05}];
    await actor(a);
    await assert.rejects(db.query('select public.al_save_pdf_template($1,$2,$3,$4)',[oa,'Test PDF',fields,path]),/UPLOAD_NOT_FOUND/);
    await db.query("insert into storage.objects(bucket_id,name) values('al-documents',$1)",[path]);
    const saved=(await one('select public.al_save_pdf_template($1,$2,$3,$4) data',[oa,'Test PDF',fields,path])).data;
    assert.equal(saved.pdf_path,path);
    assert.equal((await one("select count(*)::int n from storage.objects where name=$1",[path])).n,1);
    await actor(b);
    assert.equal((await one("select count(*)::int n from storage.objects where name=$1",[path])).n,0);
    await assert.rejects(db.query('select public.al_save_pdf_template($1,$2,$3,$4)',[ob,'Foreign template',fields,path]),/ACCESS_DENIED/);
  });

  await t.test('payment replay never rolls back later access; reversal blocks the exact receipt immediately',async()=>{
    await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');
    const first={model:'subscription',reference:'integrity-payment-1',paidUntil:new Date(Date.now()+2*86400000).toISOString(),reason:'Record first verified payment'};const second={...first,reference:'integrity-payment-2',paidUntil:new Date(Date.now()+3*86400000).toISOString()};
    await one("select public.al_platform('record_payment',$1,$2) data",[oa,first]);await one("select public.al_platform('record_payment',$1,$2) data",[oa,second]);assert.equal((await one("select public.al_platform('record_payment',$1,$2) data",[oa,first])).data.replay,true);
    await one("select public.al_platform('record_payment',$1,$2) data",[oa,{...first,reference:'integrity-late-short-period'}]);
    const detail=(await one("select public.al_platform('detail',$1) data",[oa])).data;assert.equal(detail.entitlement.payment_reference,second.reference);
    await one('select public.al_reverse_recorded_payment($1,$2) data',[first.reference,'Earlier receipt was reversed']);await service();await db.query('select public.al_api_payment_guard($1)',['f'.repeat(64)]);
    await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:a,role:'authenticated',aal:'aal2'})]);await db.exec('set role authenticated');await one('select public.al_reverse_recorded_payment($1,$2) data',[second.reference,'Current receipt was reversed']);
    await assert.rejects(db.query("select public.al_platform('record_payment',$1,$2)",[oa,second]),/PAYMENT_REVERSED/);await service();await assert.rejects(db.query('select public.al_api_payment_guard($1)',['f'.repeat(64)]),/PAYMENT_REQUIRED/);
    await actor(b);await assert.rejects(db.query('select public.al_reverse_recorded_payment($1,$2)',[second.reference,'Unauthorized reversal attempt']),/PLATFORM_ADMIN_REQUIRED/);
  });
  await t.test("audit recovery closes exhausted leases and allows only tenant admins to restart finalization",async()=>{
    await db.exec("reset role");
    await db.exec("begin");
    try {
      const envelope=await one("select envelope_id from al_private.signing_outbox where organization_id=$1 and kind='finalize' limit 1",[oa]);
      await db.query("update public.al_envelopes set status='finalizing' where id=$1",[envelope.envelope_id]);
      await db.query("update al_private.signing_outbox set attempts=5,status='running',lease_until=now()-interval '1 second',lease_token=gen_random_uuid() where envelope_id=$1 and kind='finalize'",[envelope.envelope_id]);
      await service();
      await one("select public.al_signing_worker('claim') data");
      await db.exec("reset role");
      const state=await one("select status,last_error from al_private.signing_outbox where envelope_id=$1 and kind='finalize'",[envelope.envelope_id]);
      assert.deepEqual(state,{status:"failed",last_error:"FINALIZATION_ATTEMPTS_EXHAUSTED"});
      await service();
      assert.deepEqual((await one("select public.al_retry_signing_finalize($1,$2,$3) data",[a,oa,envelope.envelope_id])).data,{queued:true});
      await db.exec("reset role");
      assert.deepEqual(await one("select status,attempts from al_private.signing_outbox where envelope_id=$1 and kind='finalize'",[envelope.envelope_id]),{status:"pending",attempts:0});
      await service();
      await assert.rejects(db.query("select public.al_retry_signing_finalize($1,$2,$3)",[b,oa,envelope.envelope_id]),/ACCESS_DENIED/);
      // Postgres aborts the transaction after the expected rejection.
    }finally{await db.exec("rollback");}
  });
  await t.test("storage reconciliation reserves abandoned artifacts and preserves published references",async()=>{
    await db.exec("reset role");
    await db.exec("begin");
    try {
      await db.exec("alter table storage.objects add column created_at timestamptz default now()-interval '8 days'");
      const registered=await one("select storage_path from public.al_documents limit 1");
      const published=await one("select f.value->>'path' path from al_private.signing_cases c cross join lateral jsonb_array_elements(c.result->'files') f limit 1");
      const orphanOriginal=`${oa}/${ea}/${crypto.randomUUID()}.pdf`;
      const orphanFinal=`${oa}/${ea}/${crypto.randomUUID()}/evidence.zip`;
      await db.query("insert into storage.objects(bucket_id,name) values('al-documents',$1),('al-final-documents',$2)",[orphanOriginal,orphanFinal]);
      await service();
      const cleanup=(await one("select public.al_storage_cleanup_batch() data")).data;
      assert.ok(cleanup.some((item:any)=>item.path===orphanOriginal));
      assert.ok(cleanup.some((item:any)=>item.path===orphanFinal));
      assert.ok(!cleanup.some((item:any)=>[registered.storage_path,published.path].includes(item.path)));
    }finally{await db.exec("rollback");}
  });
  await db.close();
});
