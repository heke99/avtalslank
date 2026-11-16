-- Avtalslank / Trafexa Nordic AB. Fresh-install migration; never edits donor databases.
create schema if not exists al_private;
revoke all on schema al_private from public, anon, authenticated;

create table public.al_organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 registration_number text, created_at timestamptz not null default now()
);
create table public.al_memberships (
 organization_id uuid not null references public.al_organizations(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','admin','sender','reader')), active boolean not null default true,
 primary key(organization_id,user_id)
);
create table public.al_envelopes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 title text not null check(length(trim(title)) between 2 and 160), message text not null default '' check(length(message)<=2000),
 sequential boolean not null default false, expires_days int not null default 14 check(expires_days between 1 and 90),
 status text not null default 'draft' check(status in ('draft','sent','in_progress','finalizing','completed','declined','expired','cancelled')),
 generation int not null default 1 check(generation>0), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create table public.al_recipients (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, envelope_id uuid not null,
 name text not null check(length(trim(name)) between 2 and 120), email text not null check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 method text not null check(method in ('bankid','freja','email_approval','drawn_signature')), position int not null check(position between 1 and 50),
 status text not null default 'pending' check(status in ('pending','signed','declined')),
 foreign key(organization_id,envelope_id) references public.al_envelopes(organization_id,id),
 unique(envelope_id,position), unique(envelope_id,email)
);
create table public.al_documents (
 id uuid primary key, organization_id uuid not null, envelope_id uuid not null, name text not null check(length(name) between 1 and 120),
 storage_path text not null unique, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), byte_size bigint not null check(byte_size between 5 and 10485760),
 status text not null default 'pending_scan' check(status in ('pending_scan','ready','rejected')), scan_report jsonb,
 created_at timestamptz not null default now(), unique(organization_id,id),
 foreign key(organization_id,envelope_id) references public.al_envelopes(organization_id,id)
);
create table public.al_templates (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 name text not null check(length(trim(name)) between 2 and 160), version int not null default 1,
 fields jsonb not null default '[]' check(jsonb_typeof(fields)='array' and jsonb_array_length(fields)<=200),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.al_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 envelope_id uuid, kind text not null, actor_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(organization_id,envelope_id) references public.al_envelopes(organization_id,id)
);
create table public.al_billing_accounts (
 organization_id uuid primary key references public.al_organizations(id),
 model text not null default 'unconfigured' check(model in ('unconfigured','subscription','per_document','hybrid')),
 currency text not null default 'SEK' check(currency='SEK'), provider text, customer_reference text, price_version text,
 enabled boolean not null default false, created_at timestamptz not null default now()
);
create table public.al_usage_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 event_key text not null, kind text not null check(kind in ('envelope_completed','document_completed','recipient_signed')),
 quantity int not null check(quantity>0), envelope_id uuid not null, occurred_at timestamptz not null default now(),
 unique(organization_id,event_key), foreign key(organization_id,envelope_id) references public.al_envelopes(organization_id,id)
);
create table public.al_api_keys (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 name text not null, prefix text not null, token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] not null, created_by uuid not null references auth.users(id), revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.al_webhook_endpoints (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 url text not null check(url ~ '^https://'), active boolean not null default false, created_at timestamptz not null default now()
);
create table al_private.capabilities(method text primary key, enabled boolean not null default false, reason text not null);
insert into al_private.capabilities values
 ('bankid',false,'BankID-anslutning och bevisvalidering återstår.'),('freja',false,'Freja-anslutning och bevisvalidering återstår.'),
 ('email_approval',false,'Signeringsresa och e-posttransport ska verifieras.'),('drawn_signature',false,'Slutdokument och signeringsresa ska verifieras.');
create table al_private.jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, envelope_id uuid not null, document_id uuid not null,
 kind text not null check(kind='scan_document'), status text not null default 'pending' check(status in ('pending','running','completed','failed')),
 attempts int not null default 0, available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 last_error text, unique(document_id,kind), foreign key(organization_id,document_id) references public.al_documents(organization_id,id),
 foreign key(organization_id,envelope_id) references public.al_envelopes(organization_id,id)
);
create index al_memberships_user on public.al_memberships(user_id,organization_id) where active;
create index al_envelopes_org_updated on public.al_envelopes(organization_id,updated_at desc);
create index al_recipients_org_envelope on public.al_recipients(organization_id,envelope_id);
create index al_documents_org_envelope on public.al_documents(organization_id,envelope_id);
create index al_events_org_time on public.al_events(organization_id,created_at desc);
create index al_templates_org on public.al_templates(organization_id);
create index al_jobs_pending on al_private.jobs(available_at) where status in ('pending','running');

create function al_private.actor() returns uuid language sql stable set search_path='' as $$
 select case when auth.role()='service_role' then nullif(current_setting('al.actor',true),'')::uuid else auth.uid() end
$$;
create function public.al_can_access(p_org uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.al_memberships m where m.organization_id=p_org and m.user_id=al_private.actor() and m.active
 and (not p_write or m.role in ('owner','admin','sender'))
 and (auth.role()<>'service_role' or nullif(current_setting('al.organization',true),'')::uuid=p_org))
$$;
create function al_private.require_access(p_org uuid,p_admin boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.al_can_access(p_org,true) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 if p_admin and not exists(select 1 from public.al_memberships where organization_id=p_org and user_id=al_private.actor() and active and role in ('owner','admin')) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
end $$;
create function al_private.audit(p_org uuid,p_envelope uuid,p_kind text,p_meta jsonb default '{}') returns void
language sql security definer set search_path='' as $$
 insert into public.al_events(organization_id,envelope_id,kind,actor_id,metadata) values(p_org,p_envelope,p_kind,al_private.actor(),p_meta)
$$;

create function public.al_create_organization(p_name text,p_registration_number text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or auth.role()<>'authenticated' then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 insert into public.al_organizations(name,registration_number) values(trim(p_name),p_registration_number) returning id into v_id;
 insert into public.al_memberships values(v_id,auth.uid(),'owner',true);
 insert into public.al_billing_accounts(organization_id) values(v_id);
 perform al_private.audit(v_id,null,'organization.created'); return v_id;
end $$;
create function public.al_save_draft(p_org uuid,p_title text,p_message text default '',p_sequential boolean default false,p_expires_days int default 14,p_id uuid default null,p_generation int default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.al_envelopes;
begin
 perform al_private.require_access(p_org);
 if p_id is null then
  insert into public.al_envelopes(organization_id,title,message,sequential,expires_days,created_by) values(p_org,trim(p_title),p_message,p_sequential,p_expires_days,al_private.actor()) returning * into v;
 else
  select * into v from public.al_envelopes where id=p_id and organization_id=p_org for update;
  if not found then raise exception 'ENVELOPE_NOT_FOUND'; end if;
  if v.status<>'draft' then raise exception 'DOCUMENT_LOCKED'; end if;
  if p_generation is distinct from v.generation then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update public.al_envelopes set title=trim(p_title),message=p_message,sequential=p_sequential,expires_days=p_expires_days,generation=generation+1,updated_at=now() where id=p_id returning * into v;
 end if;
 perform al_private.audit(p_org,v.id,'envelope.draft_saved',jsonb_build_object('generation',v.generation)); return to_jsonb(v);
end $$;
create function al_private.lock_draft(p_org uuid,p_id uuid) returns public.al_envelopes
language plpgsql security definer set search_path='' as $$
declare v public.al_envelopes;
begin
 perform al_private.require_access(p_org);
 select * into v from public.al_envelopes where id=p_id and organization_id=p_org for update;
 if not found then raise exception 'ENVELOPE_NOT_FOUND'; end if;
 if v.status<>'draft' then raise exception 'DOCUMENT_LOCKED'; end if;return v;
end $$;
create function public.al_add_recipient(p_org uuid,p_envelope uuid,p_name text,p_email text,p_method text,p_position int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.al_recipients;
begin
 perform al_private.lock_draft(p_org,p_envelope);
 insert into public.al_recipients(organization_id,envelope_id,name,email,method,position) values(p_org,p_envelope,trim(p_name),lower(trim(p_email)),p_method,p_position) returning * into v;
 perform al_private.audit(p_org,p_envelope,'recipient.added',jsonb_build_object('recipient_id',v.id,'method',v.method)); return to_jsonb(v);
end $$;
create function public.al_register_document(p_org uuid,p_envelope uuid,p_id uuid,p_name text,p_sha256 text,p_byte_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.al_documents; v_path text:=p_org::text||'/'||p_envelope::text||'/'||p_id::text||'.pdf';
begin
 perform al_private.lock_draft(p_org,p_envelope);
 if not exists(select 1 from storage.objects where bucket_id='al-documents' and name=v_path) then raise exception 'UPLOAD_NOT_FOUND';end if;
 if (select count(*) from public.al_documents where envelope_id=p_envelope)>=20 then raise exception 'DOCUMENT_LIMIT';end if;
 insert into public.al_documents(id,organization_id,envelope_id,name,storage_path,sha256,byte_size) values(p_id,p_org,p_envelope,p_name,v_path,p_sha256,p_byte_size) returning * into v;
 insert into al_private.jobs(organization_id,envelope_id,document_id,kind) values(p_org,p_envelope,p_id,'scan_document');
 perform al_private.audit(p_org,p_envelope,'document.uploaded',jsonb_build_object('document_id',v.id));return to_jsonb(v);
end $$;
create function public.al_save_template(p_org uuid,p_name text,p_fields jsonb,p_id uuid default null,p_version int default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.al_templates;f jsonb; ids text[]:='{}';
begin
 perform al_private.require_access(p_org);
 if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)>200 then raise exception 'INVALID_FIELDS';end if;
 for f in select value from jsonb_array_elements(p_fields) loop
  if coalesce(f->>'id','')='' or (f->>'id')=any(ids) or coalesce(trim(f->>'label'),'')='' or coalesce(trim(f->>'recipientRole'),'')='' or (f->>'type') not in ('text','date','signature') then raise exception 'INVALID_FIELD';end if;
  ids:=array_append(ids,f->>'id');
  if not (f ?& array['x','y','width','height','page','type','id','label','recipientRole','required']) or (f->>'page')::int not between 0 and 99
    or (f->>'x')::numeric<0 or (f->>'y')::numeric<0 or (f->>'width')::numeric<=0 or (f->>'height')::numeric<=0
    or (f->>'x')::numeric+(f->>'width')::numeric>1 or (f->>'y')::numeric+(f->>'height')::numeric>1 then raise exception 'FIELD_OUTSIDE_PAGE';end if;
 end loop;
 if p_id is null then insert into public.al_templates(organization_id,name,fields) values(p_org,trim(p_name),p_fields) returning * into v;
 else
  update public.al_templates set name=trim(p_name),fields=p_fields,version=version+1,updated_at=now() where id=p_id and organization_id=p_org and version=p_version returning * into v;
  if not found then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 end if;
 perform al_private.audit(p_org,null,'template.saved',jsonb_build_object('template_id',v.id,'version',v.version));return to_jsonb(v);
end $$;
create function public.al_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('method',method,'enabled',enabled,'reason',reason) order by method),'[]') from al_private.capabilities
$$;
create function public.al_send_envelope(p_org uuid,p_envelope uuid,p_generation int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.al_envelopes;
begin
 v:=al_private.lock_draft(p_org,p_envelope);
 if v.generation<>p_generation then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 if not exists(select 1 from public.al_documents where envelope_id=p_envelope) then raise exception 'DOCUMENT_REQUIRED';end if;
 if exists(select 1 from public.al_documents where envelope_id=p_envelope and status<>'ready') then raise exception 'DOCUMENT_SCAN_REQUIRED';end if;
 if not exists(select 1 from public.al_recipients where envelope_id=p_envelope) then raise exception 'RECIPIENT_REQUIRED';end if;
 if exists(select 1 from public.al_recipients r left join al_private.capabilities c on c.method=r.method where r.envelope_id=p_envelope and not coalesce(c.enabled,false)) then raise exception 'SIGNING_METHOD_NOT_READY';end if;
 -- Transport and full signing finalization are deliberately not claimed by this foundation.
 raise exception 'SIGNING_DELIVERY_NOT_CONFIGURED';
end $$;
create function public.al_cancel_envelope(p_org uuid,p_envelope uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.al_envelopes;
begin
 perform al_private.require_access(p_org);
 select * into v from public.al_envelopes where id=p_envelope and organization_id=p_org for update;
 if not found then raise exception 'ENVELOPE_NOT_FOUND';end if;
 if v.status='cancelled' then return to_jsonb(v);end if;
 if v.status<>'draft' then raise exception 'CANCELLATION_NOT_SUPPORTED_FOR_STATE';end if;
 update public.al_envelopes set status='cancelled',updated_at=now() where id=v.id returning * into v;
 perform al_private.audit(p_org,p_envelope,'envelope.cancelled');return to_jsonb(v);
end $$;

create function public.al_issue_api_key(p_org uuid,p_name text,p_prefix text,p_hash text,p_scopes text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 perform al_private.require_access(p_org,true);
 if length(trim(p_name)) not between 2 and 80 or p_prefix !~ '^al_live_[a-f0-9]{8}$' or cardinality(p_scopes)<1 or not p_scopes <@ array['envelopes:read','envelopes:write','templates:read','templates:write','billing:read'] then raise exception 'INVALID_KEY';end if;
 insert into public.al_api_keys(organization_id,name,prefix,token_hash,scopes,created_by) values(p_org,trim(p_name),p_prefix,p_hash,p_scopes,al_private.actor()) returning id into v;
 perform al_private.audit(p_org,null,'api_key.created',jsonb_build_object('key_id',v));return v;
end $$;
create function public.al_revoke_api_key(p_org uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin perform al_private.require_access(p_org,true);
 update public.al_api_keys set revoked_at=coalesce(revoked_at,now()) where id=p_id and organization_id=p_org;
 if not found then raise exception 'KEY_NOT_FOUND';end if;
 perform al_private.audit(p_org,null,'api_key.revoked',jsonb_build_object('key_id',p_id));end $$;

-- API clients enter only here. Organization and actor are resolved from the hash, not the payload.
create function al_private.api_execute(p_hash text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.al_api_keys; needed text;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 select * into k from public.al_api_keys where token_hash=p_hash and revoked_at is null;
 if not found then raise exception 'INVALID_API_KEY' using errcode='42501';end if;
 needed:=case p_action when 'list_envelopes' then 'envelopes:read' when 'get_envelope' then 'envelopes:read' when 'save_draft' then 'envelopes:write' when 'add_recipient' then 'envelopes:write' when 'send' then 'envelopes:write' when 'cancel' then 'envelopes:write' when 'billing' then 'billing:read' else null end;
 if needed is null or not needed=any(k.scopes) then raise exception 'SCOPE_DENIED' using errcode='42501';end if;
 perform set_config('al.actor',k.created_by::text,true);perform set_config('al.organization',k.organization_id::text,true);
 if not public.al_can_access(k.organization_id) then raise exception 'MEMBERSHIP_REVOKED' using errcode='42501';end if;
 case p_action
 when 'list_envelopes' then return coalesce((select jsonb_agg(to_jsonb(e)) from (select * from public.al_envelopes where organization_id=k.organization_id order by updated_at desc limit 100) e),'[]');
 when 'get_envelope' then return (select to_jsonb(e) from public.al_envelopes e where id=(p_payload->>'id')::uuid and organization_id=k.organization_id);
 when 'save_draft' then return public.al_save_draft(k.organization_id,p_payload->>'title',coalesce(p_payload->>'message',''),coalesce((p_payload->>'sequential')::boolean,false),coalesce((p_payload->>'expiresDays')::int,14));
 when 'add_recipient' then return public.al_add_recipient(k.organization_id,(p_payload->>'envelopeId')::uuid,p_payload->>'name',p_payload->>'email',p_payload->>'method',(p_payload->>'position')::int);
 when 'send' then return public.al_send_envelope(k.organization_id,(p_payload->>'envelopeId')::uuid,(p_payload->>'generation')::int);
 when 'cancel' then return public.al_cancel_envelope(k.organization_id,(p_payload->>'envelopeId')::uuid);
 when 'billing' then return (select jsonb_build_object('model',model,'currency',currency,'enabled',enabled,'provider',provider,'priceVersion',price_version) from public.al_billing_accounts where organization_id=k.organization_id);
 else raise exception 'UNKNOWN_ACTION';end case;
end $$;

create table al_private.idempotency (
 key_hash text not null, operation text not null, request_key text not null, payload jsonb not null, response jsonb,
 created_at timestamptz not null default now(), primary key(key_hash,operation,request_key)
);
create function public.al_api_dispatch(p_hash text,p_action text,p_payload jsonb default '{}',p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v al_private.idempotency;r jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.al_api_keys k join public.al_memberships m on m.organization_id=k.organization_id and m.user_id=k.created_by where k.token_hash=p_hash and k.revoked_at is null and m.active) then raise exception 'INVALID_API_KEY' using errcode='42501';end if;
 if p_action in ('list_envelopes','get_envelope','billing') then return al_private.api_execute(p_hash,p_action,p_payload);end if;
 if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
 insert into al_private.idempotency(key_hash,operation,request_key,payload) values(p_hash,p_action,p_idempotency_key,p_payload) on conflict do nothing;
 select * into v from al_private.idempotency where key_hash=p_hash and operation=p_action and request_key=p_idempotency_key for update;
 if v.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 if v.response is not null then return v.response;end if;
 r:=al_private.api_execute(p_hash,p_action,p_payload);
 update al_private.idempotency set response=r where key_hash=p_hash and operation=p_action and request_key=p_idempotency_key;
 return r;
end $$;

-- Lease/finish use a per-attempt token: expired workers cannot overwrite newer attempts.
create function public.al_claim_document_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j al_private.jobs;d public.al_documents;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 select * into j from al_private.jobs where attempts<5 and ((status='pending' and available_at<=now()) or (status='running' and lease_until<now())) order by available_at for update skip locked limit 1;
 if not found then return null;end if;
 update al_private.jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 select * into d from public.al_documents where id=j.document_id and organization_id=j.organization_id;
 return jsonb_build_object('id',j.id,'leaseToken',j.lease_token,'document',to_jsonb(d));
end $$;
create function public.al_finish_document_job(p_id uuid,p_lease uuid,p_report jsonb,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j al_private.jobs; d public.al_documents;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 select * into j from al_private.jobs where id=p_id and status='running' and lease_token=p_lease and lease_until>now() for update;
 if not found then raise exception 'LEASE_LOST';end if;
 select * into d from public.al_documents where id=j.document_id and organization_id=j.organization_id for update;
 if p_error is not null then
  update al_private.jobs set status=case when attempts>=5 then 'failed' else 'pending' end,available_at=now()+interval '1 minute'*attempts,last_error=left(p_error,80),lease_token=null,lease_until=null where id=j.id;return;
 end if;
 if p_report->>'sha256' is distinct from d.sha256 or (p_report->>'byteSize')::bigint is distinct from d.byte_size or p_report->>'malware' not in ('CLEAN','INFECTED') or p_report->>'pdf' not in ('PASS','FAIL') then raise exception 'SCAN_REPORT_INVALID';end if;
 update public.al_documents set status=case when p_report->>'malware'='CLEAN' and p_report->>'pdf'='PASS' then 'ready' else 'rejected' end,scan_report=p_report where id=d.id;
 update al_private.jobs set status='completed',lease_token=null,lease_until=null where id=j.id;
 perform al_private.audit(j.organization_id,j.envelope_id,'document.scanned',jsonb_build_object('document_id',d.id));
end $$;

do $$declare t text;begin
 foreach t in array array['al_organizations','al_memberships','al_envelopes','al_recipients','al_documents','al_templates','al_events','al_billing_accounts','al_usage_events','al_api_keys','al_webhook_endpoints'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  if t<>'al_api_keys' then execute format('grant select on public.%I to authenticated',t);end if;
 end loop;
end $$;
create policy org_read on public.al_organizations for select to authenticated using(public.al_can_access(id));
create policy membership_read on public.al_memberships for select to authenticated using(public.al_can_access(organization_id));
do $$declare t text;begin
 foreach t in array array['al_envelopes','al_recipients','al_documents','al_templates','al_events','al_billing_accounts','al_usage_events','al_webhook_endpoints'] loop
 execute format('create policy member_read on public.%I for select to authenticated using(public.al_can_access(organization_id))',t);
 end loop;
end $$;
grant select(id,organization_id,name,prefix,scopes,created_by,revoked_at,created_at) on public.al_api_keys to authenticated;
create policy key_read on public.al_api_keys for select to authenticated using(public.al_can_access(organization_id) and exists(select 1 from public.al_memberships where organization_id=al_api_keys.organization_id and user_id=auth.uid() and role in ('owner','admin') and active));
-- SECURITY DEFINER functions default to PUBLIC EXECUTE: close every entry before granting approved RPCs.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'al_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 if f.signature::text !~ 'al_(api_dispatch|claim_document_job|finish_document_job)\(' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke all on all functions in schema al_private from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('al-documents','al-documents',false,10485760,array['application/pdf']) on conflict(id) do nothing;
create function public.al_storage_access(p_path text,p_write boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare o uuid;e uuid;
begin
 if p_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.pdf$' then return false;end if;
 begin o:=split_part(p_path,'/',1)::uuid;e:=split_part(p_path,'/',2)::uuid;exception when invalid_text_representation then return false;end;
 return public.al_can_access(o,p_write) and exists(select 1 from public.al_envelopes where organization_id=o and id=e and (not p_write or status='draft'));
end $$;
revoke all on function public.al_storage_access(text,boolean) from public,anon;
grant execute on function public.al_storage_access(text,boolean) to authenticated,service_role;
create policy al_document_read on storage.objects for select to authenticated using(bucket_id='al-documents' and public.al_storage_access(name));
create policy al_document_upload on storage.objects for insert to authenticated with check(bucket_id='al-documents' and public.al_storage_access(name,true));
-- No UPDATE policy: an uploaded original cannot be replaced in place.
