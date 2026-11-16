import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sha256Hex } from "../packages/crypto/src/hash.ts";

test("real PostgreSQL: isolated organizations, guarded commands, private uploads, scoped keys and durable jobs", async (t) => {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);grant usage on schema auth,storage to anon,authenticated,service_role;
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

  let work:string,r1:string,r2:string,contact:string,template:string;
  await t.test('recipient edits and ordering are atomic; malformed and foreign IDs are rejected',async()=>{
    await actor(a);work=(await one("select public.al_save_draft($1,'Arbetsflöde') data",[oa])).data.id;
    r1=(await one("select public.al_add_recipient($1,$2,'Person Ett','one@example.invalid','bankid',1) data",[oa,work])).data.id;
    r2=(await one("select public.al_add_recipient($1,$2,'Person Två','two@example.invalid','freja',2) data",[oa,work])).data.id;
    const edited=(await one("select public.al_edit_recipient($1,$2,$3,'Uppdaterad Person','NEW@example.invalid','drawn_signature') data",[oa,work,r1])).data;
    assert.equal(edited.email,'new@example.invalid');assert.equal(edited.method,'drawn_signature');
    await db.query('select public.al_reorder_recipients($1,$2,$3)',[oa,work,[r2,r1]]);
    assert.equal((await one('select position from public.al_recipients where id=$1',[r2])).position,1);
    for(const ids of [[r1,r1],[r1],['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',r2]])await assert.rejects(db.query('select public.al_reorder_recipients($1,$2,$3)',[oa,work,ids]),/INVALID_RECIPIENT_ORDER/);
    await actor(b);await assert.rejects(db.query("select public.al_edit_recipient($1,$2,$3,'Intrång','x@example.invalid','bankid')",[oa,work,r1]),/ACCESS_DENIED/);
  });
  await t.test('removing a recipient compacts order without duplicate positions',async()=>{
    await actor(a);await db.query('select public.al_remove_recipient($1,$2,$3)',[oa,work,r2]);
    assert.equal((await one('select position from public.al_recipients where id=$1',[r1])).position,1);
    await assert.rejects(db.query('select public.al_remove_recipient($1,$2,$3)',[oa,work,r2]),/RECIPIENT_NOT_FOUND/);
  });
  await t.test('document detach cancels durable scan jobs but keeps immutable original object',async()=>{
    await actor(a);const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',path=`${oa}/${work}/${id}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name) values('al-documents',$1)",[path]);
    await db.query("select public.al_register_document($1,$2,$3,'remove.pdf',$4,5)",[oa,work,id,'a'.repeat(64)]);
    await db.query('select public.al_remove_document($1,$2,$3)',[oa,work,id]);
    assert.equal((await db.query('select id from public.al_documents where id=$1',[id])).rows.length,0);
    assert.equal((await db.query('select id from storage.objects where name=$1',[path])).rows.length,1);
    await db.exec('reset role');assert.equal((await db.query('select id from al_private.jobs where document_id=$1',[id])).rows.length,0);
  });
  await t.test('copying creates fresh draft and pending recipients, never billing usage or documents',async()=>{
    await actor(a);const copy=(await one("select public.al_duplicate_draft($1,$2,'Kopia') data",[oa,work])).data;
    assert.equal(copy.status,'draft');assert.equal(copy.generation,1);assert.notEqual(copy.id,work);
    assert.equal((await one('select status from public.al_recipients where envelope_id=$1',[copy.id])).status,'pending');
    assert.equal((await db.query('select id from public.al_documents where envelope_id=$1',[copy.id])).rows.length,0);
    assert.equal((await db.query('select id from public.al_usage_events where envelope_id=$1',[copy.id])).rows.length,0);
  });
  await t.test('contacts normalize addresses, reject stale updates and isolate tenant reads',async()=>{
    await actor(a);const c=(await one("select public.al_save_contact($1,'Kontakt','CONTACT@example.invalid','AB') data",[oa])).data;contact=c.id;
    assert.equal(c.email,'contact@example.invalid');
    await db.query("select public.al_save_contact($1,'Kontakt Ny','contact@example.invalid','AB',$2,1,true)",[oa,contact]);
    await assert.rejects(db.query("select public.al_save_contact($1,'Fel','contact@example.invalid','AB',$2,1,false)",[oa,contact]),/VERSION_CONFLICT/);
    await actor(b);assert.equal((await db.query('select id from public.al_contacts where id=$1',[contact])).rows.length,0);
    await assert.rejects(db.query("select public.al_save_contact($1,'Intrång','x@example.invalid')",[oa]),/ACCESS_DENIED/);
  });
  await t.test('organization profile is admin-only and reader cannot change contacts',async()=>{
    await actor('33333333-3333-4333-8333-333333333333');
    await assert.rejects(db.query("select public.al_update_organization($1,'Intrång','123')",[oa]),/ACCESS_DENIED/);
    await assert.rejects(db.query("select public.al_save_contact($1,'Intrång','x@example.invalid')",[oa]),/ACCESS_DENIED/);
    await actor(a);assert.equal((await one("select public.al_update_organization($1,'Företag Nytt','556855-4884') data",[oa])).data.name,'Företag Nytt');
  });
  await t.test('membership commands preserve last owner and prevent administrator escalation',async()=>{
    await actor(a);await assert.rejects(db.query("select public.al_set_member_role($1,$2,'reader',true)",[oa,a]),/LAST_OWNER/);
    await db.query("select public.al_set_member_role($1,'33333333-3333-4333-8333-333333333333','admin',true)",[oa]);
    await actor('33333333-3333-4333-8333-333333333333');
    await assert.rejects(db.query("select public.al_set_member_role($1,$2,'reader',true)",[oa,a]),/OWNER_REQUIRED/);
    await assert.rejects(db.query("select public.al_set_member_role($1,'33333333-3333-4333-8333-333333333333','owner',true)",[oa]),/OWNER_REQUIRED/);
    await actor(a);await db.query("select public.al_set_member_role($1,'33333333-3333-4333-8333-333333333333','reader',true)",[oa]);
  });
  await t.test('template deletion checks version and organization',async()=>{
    await actor(a);template=(await one("select public.al_save_template($1,'Raderbar mall','[]') data",[oa])).data.id;
    await assert.rejects(db.query('select public.al_delete_template($1,$2,2)',[oa,template]),/VERSION_CONFLICT/);
    await actor(b);await assert.rejects(db.query('select public.al_delete_template($1,$2,1)',[oa,template]),/ACCESS_DENIED/);
    await actor(a);await db.query('select public.al_delete_template($1,$2,1)',[oa,template]);
  });
  await t.test('activity keyset pages have no duplicates and never cross tenants',async()=>{
    await actor(a);const first=(await one('select public.al_activity($1,3) data',[oa])).data;
    const last=first.at(-1);const next=(await one('select public.al_activity($1,3,$2,$3) data',[oa,last.created_at,last.id])).data;
    assert.equal(first.length,3);assert.equal(next.length,3);assert.equal(new Set([...first,...next].map(x=>x.id)).size,6);
    assert.ok(first.every((x:any)=>x.organization_id===oa));await actor(b);await assert.rejects(db.query('select public.al_activity($1)',[oa]),/ACCESS_DENIED/);
  });
  await t.test('usage summary is read-only, period bounded, and billing stays undecided',async()=>{
    await actor(a);const u=(await one("select public.al_usage_summary($1,'2026-11-01','2026-12-01') data",[oa])).data;
    assert.equal(u.billing_model,'unconfigured');assert.equal(u.billing_enabled,false);assert.deepEqual(u.counts,{});
    await assert.rejects(db.query("select public.al_usage_summary($1,'2025-01-01','2027-01-01')",[oa]),/INVALID_PERIOD/);
    await actor(b);await assert.rejects(db.query("select public.al_usage_summary($1,'2026-11-01','2026-12-01')",[oa]),/ACCESS_DENIED/);
  });
  await t.test('extension API honors read scope, derives tenant, and deduplicates contact creation',async()=>{
    await actor(a);const writeHash='b'.repeat(64),readHash='c'.repeat(64);
    await db.query("select public.al_issue_api_key($1,'Operations','al_live_bbbbbbbb',$2,ARRAY['envelopes:read','envelopes:write','billing:read'])",[oa,writeHash]);
    await db.query("select public.al_issue_api_key($1,'Read','al_live_cccccccc',$2,ARRAY['envelopes:read'])",[oa,readHash]);
    await actor(a,'service_role');const payload={name:'API Kontakt',email:'api@example.invalid',organizationId:ob};
    const c=(await one("select public.al_api_dispatch($1,'save_contact',$2,'contact-request-001') data",[writeHash,payload])).data;
    assert.equal(c.organization_id,oa);
    assert.equal((await one("select public.al_api_dispatch($1,'save_contact',$2,'contact-request-001') data",[writeHash,payload])).data.id,c.id);
    const contacts=(await one("select public.al_api_dispatch($1,'list_contacts') data",[readHash])).data;assert.ok(contacts.every((c:any)=>c.organization_id===oa));
    await assert.rejects(db.query("select public.al_api_dispatch($1,'save_contact',$2,'contact-request-002')",[readHash,{name:'Forbidden',email:'denied@example.invalid'}]),/SCOPE_DENIED/);
    await assert.rejects(db.query("select public.al_api_dispatch($1,'usage_summary',$2)",[readHash,{from:'2026-11-01',to:'2026-12-01'}]),/SCOPE_DENIED/);
  });
  await t.test('all mutation commands refuse cancelled envelopes',async()=>{
    await actor(a);await db.query('select public.al_cancel_envelope($1,$2)',[oa,work]);
    for(const sql of ["select public.al_edit_recipient($1,$2,$3,'Låst','locked@example.invalid','freja')",'select public.al_remove_recipient($1,$2,$3)','select public.al_remove_document($1,$2,$3)'])await assert.rejects(db.query(sql,[oa,work,r1]),/DOCUMENT_LOCKED/);
    await assert.rejects(db.query('select public.al_reorder_recipients($1,$2,$3)',[oa,work,[r1]]),/DOCUMENT_LOCKED/);
  });
  await db.close();
});
