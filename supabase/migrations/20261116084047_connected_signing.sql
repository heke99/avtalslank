-- Connected signing: original bytes remain immutable; service-only orchestration.
alter table public.al_envelopes add column fields jsonb not null default '[]' check(jsonb_typeof(fields)='array' and jsonb_array_length(fields)<=200);
alter table public.al_documents add column page_count int check(page_count between 1 and 100);
create table al_private.signing_cases (
 envelope_id uuid primary key references public.al_envelopes(id), organization_id uuid not null references public.al_organizations(id),
 snapshot jsonb not null, snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'), expires_at timestamptz not null,
 created_at timestamptz not null default now(), finalized_at timestamptz, result jsonb
);
create table al_private.signing_links (
 id uuid primary key, envelope_id uuid not null references al_private.signing_cases(envelope_id), recipient_id uuid not null references public.al_recipients(id),
 token_hash text unique not null check(token_hash~'^[a-f0-9]{64}$'), expires_at timestamptz not null, revoked_at timestamptz, consumed_at timestamptz,
 decision jsonb, unique(envelope_id,recipient_id)
);
create table al_private.signing_outbox (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id), envelope_id uuid not null references al_private.signing_cases(envelope_id),
 kind text not null check(kind in ('invitation','finalize','webhook')), effect_key text unique not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','running','accepted','completed','failed','reconcile','cancelled')),
 attempts int not null default 0, available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), last_error text, provider_reference text
);
create index al_signing_outbox_poll on al_private.signing_outbox(status,available_at);
create index al_signing_links_envelope on al_private.signing_links(envelope_id);
create table al_private.signing_worker (id text primary key check(id='main'), heartbeat_at timestamptz not null, ready boolean not null, key_fingerprint text);
-- Private resources have no client grants. Service functions below own each transition.
revoke all on al_private.signing_cases,al_private.signing_links,al_private.signing_outbox,al_private.signing_worker from public,anon,authenticated;
alter table al_private.signing_cases enable row level security;
alter table al_private.signing_links enable row level security;
alter table al_private.signing_outbox enable row level security;
alter table al_private.signing_worker enable row level security;

create function al_private.flow_context(p_actor uuid,p_key_hash text,p_org uuid,p_write boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare k public.al_api_keys; o uuid;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 if p_key_hash is not null then
  select * into k from public.al_api_keys where token_hash=p_key_hash and revoked_at is null;
  if not found then raise exception 'INVALID_API_KEY';end if;
  if not (case when p_write then 'envelopes:write' else 'envelopes:read' end)=any(k.scopes) then raise exception 'SCOPE_DENIED';end if;
  o:=k.organization_id;perform set_config('al.actor',k.created_by::text,true);
 else
  if p_actor is null or p_org is null then raise exception 'AUTH_REQUIRED';end if;
  o:=p_org;perform set_config('al.actor',p_actor::text,true);
 end if;
 perform set_config('al.organization',o::text,true);
 if not public.al_can_access(o,p_write) then raise exception 'ACCESS_DENIED';end if;return o;
end $$;
create function al_private.flow_snapshot(p_org uuid,p_envelope uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('envelope',jsonb_build_object('id',e.id,'title',e.title,'message',e.message,'sequential',e.sequential,'generation',e.generation,'fields',e.fields),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.al_documents d where d.organization_id=p_org and d.envelope_id=e.id),'[]'),
 'recipients',coalesce((select jsonb_agg(to_jsonb(r) order by r.position) from public.al_recipients r where r.organization_id=p_org and r.envelope_id=e.id),'[]'))
 from public.al_envelopes e where e.organization_id=p_org and e.id=p_envelope
$$;
create function al_private.validate_envelope_fields(p_org uuid,p_envelope uuid,p_fields jsonb) returns void language plpgsql security definer set search_path='' as $$
declare f jsonb; ids text[]:='{}'; pages int;
begin
 if p_fields is null or jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)>200 then raise exception 'INVALID_FIELDS';end if;
 for f in select value from jsonb_array_elements(p_fields) loop
  if jsonb_typeof(f)<>'object' or not(f ?& array['id','documentId','recipientId','type','label','required','page','x','y','width','height'])
  or coalesce(f->>'type','') not in ('text','date') or coalesce(length(trim(f->>'label')),0) not between 1 and 120 or jsonb_typeof(f->'required')<>'boolean'
  or coalesce(f->>'id','')=any(ids) then raise exception 'INVALID_FIELD';end if;
  perform (f->>'id')::uuid;ids:=array_append(ids,f->>'id');
  if not exists(select 1 from public.al_recipients where id=(f->>'recipientId')::uuid and organization_id=p_org and envelope_id=p_envelope) then raise exception 'INVALID_FIELD_ASSIGNMENT';end if;
  select page_count into pages from public.al_documents where id=(f->>'documentId')::uuid and organization_id=p_org and envelope_id=p_envelope;
  if pages is null or (f->>'page')::numeric<>trunc((f->>'page')::numeric) or (f->>'page')::int not between 0 and pages-1 then raise exception 'INVALID_FIELD_ASSIGNMENT';end if;
  if exists(select 1 from unnest(array['page','x','y','width','height']) a where jsonb_typeof(f->a)<>'number')
   or (f->>'x')::numeric<0 or (f->>'y')::numeric<0 or (f->>'width')::numeric<=0 or (f->>'height')::numeric<=0
   or (f->>'x')::numeric+(f->>'width')::numeric>1 or (f->>'y')::numeric+(f->>'height')::numeric>1 then raise exception 'FIELD_OUTSIDE_PAGE';end if;
 end loop;
end $$;
create function public.al_flow_command(p_actor uuid,p_key_hash text,p_org uuid,p_envelope uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid;e public.al_envelopes;s jsonb;h text;i jsonb;r public.al_recipients;c al_private.signing_cases;
begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,p_action not in ('read','download','deliveries'));
 select * into e from public.al_envelopes where organization_id=o and id=p_envelope for update;
 if not found then raise exception 'ENVELOPE_NOT_FOUND';end if;
 if p_action='read' then return al_private.flow_snapshot(o,e.id);end if;
 if p_action='deliveries' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'status',status,'attempts',attempts,'created_at',created_at,'last_error',last_error) order by created_at) from al_private.signing_outbox where envelope_id=e.id),'[]');end if;
 if p_action='download' then
  select * into c from al_private.signing_cases where envelope_id=e.id;
  if e.status<>'completed' or c.result is null then raise exception 'FINAL_DOCUMENT_NOT_READY';end if;return c.result;
 end if;
 if p_action='authorize_upload' then perform al_private.lock_draft(o,e.id);return jsonb_build_object('organizationId',o);end if;
 if p_action in ('fields','register_document') then
  perform al_private.lock_draft(o,e.id);
  if p_action='fields' then
   if (p_payload->>'generation')::int is distinct from e.generation then raise exception 'VERSION_CONFLICT';end if;
   perform al_private.validate_envelope_fields(o,e.id,p_payload->'fields');
   update public.al_envelopes set fields=p_payload->'fields',generation=generation+1,updated_at=now() where id=e.id returning * into e;
   perform al_private.audit(o,e.id,'envelope.fields_saved');return to_jsonb(e);
  else
   select to_jsonb(d) into s from public.al_documents d where id=(p_payload->>'id')::uuid and organization_id=o and envelope_id=e.id;
   if found then
    if s->>'sha256' is distinct from p_payload->>'sha256' or (s->>'byte_size')::bigint is distinct from (p_payload->>'byteSize')::bigint then raise exception 'UPLOAD_CONFLICT';end if;return s;
   end if;
   s:=public.al_register_document(o,e.id,(p_payload->>'id')::uuid,p_payload->>'name',p_payload->>'sha256',(p_payload->>'byteSize')::bigint);
   update public.al_documents set page_count=(p_payload->>'pageCount')::int where id=(s->>'id')::uuid;
   return s;
  end if;
 end if;
 if p_action='send' then
  -- Retry after commit returns the same frozen case, without new sessions or effects.
  select * into c from al_private.signing_cases where envelope_id=e.id;
  if found then return jsonb_build_object('id',e.id,'status',e.status,'snapshotHash',c.snapshot_hash);end if;
  perform al_private.lock_draft(o,e.id);
  if (p_payload->>'generation')::int is distinct from e.generation then raise exception 'VERSION_CONFLICT';end if;
  if not exists(select 1 from al_private.capabilities where method='email_approval' and enabled) then raise exception 'SIGNING_METHOD_NOT_READY';end if;
  if not exists(select 1 from al_private.signing_worker where id='main' and ready and heartbeat_at>now()-interval '2 minutes' and key_fingerprint=p_payload->>'keyFingerprint') then raise exception 'SIGNING_WORKER_NOT_READY';end if;
  if (select coalesce(sum(byte_size),0) from public.al_documents where envelope_id=e.id)>52428800 then raise exception 'DOCUMENT_TOTAL_LIMIT';end if;
  if not exists(select 1 from public.al_documents where envelope_id=e.id) then raise exception 'DOCUMENT_REQUIRED';end if;
  if exists(select 1 from public.al_documents where envelope_id=e.id and (status<>'ready' or page_count is null)) then raise exception 'DOCUMENT_SCAN_REQUIRED';end if;
  if not exists(select 1 from public.al_recipients where envelope_id=e.id) then raise exception 'RECIPIENT_REQUIRED';end if;
  if exists(select 1 from public.al_recipients where envelope_id=e.id and method<>'email_approval') then raise exception 'SIGNING_METHOD_NOT_READY';end if;
  perform al_private.validate_envelope_fields(o,e.id,e.fields);
  s:=al_private.flow_snapshot(o,e.id);
  if p_payload->'snapshot' is distinct from s then raise exception 'VERSION_CONFLICT';end if;
  if jsonb_typeof(p_payload->'links') is distinct from 'array' or jsonb_array_length(p_payload->'links')<>(select count(*) from public.al_recipients where envelope_id=e.id) then raise exception 'INVALID_LINKS';end if;
  h:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
  insert into al_private.signing_cases(envelope_id,organization_id,snapshot,snapshot_hash,expires_at) values(e.id,o,s,h,now()+make_interval(days=>e.expires_days)) returning * into c;
  for r in select * from public.al_recipients where envelope_id=e.id order by position loop
   select value into i from jsonb_array_elements(p_payload->'links') where value->>'recipientId'=r.id::text;
   if i is null then raise exception 'INVALID_LINKS';end if;
   insert into al_private.signing_links(id,envelope_id,recipient_id,token_hash,expires_at) values((i->>'id')::uuid,e.id,r.id,i->>'tokenHash',c.expires_at);
   if not e.sequential or r.position=(select min(position) from public.al_recipients where envelope_id=e.id) then
    insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) values(o,e.id,'invitation','invite:'||r.id,jsonb_build_object('linkId',i->>'id','recipientId',r.id));
   end if;
  end loop;
  update public.al_envelopes set status='sent',updated_at=now() where id=e.id;
  perform al_private.audit(o,e.id,'envelope.sent',jsonb_build_object('snapshot_hash',h));
  return jsonb_build_object('id',e.id,'status','sent','snapshotHash',h);
 end if;
 if p_action='cancel' then
  if e.status not in ('draft','sent','in_progress','cancelled') then raise exception 'CANCELLATION_NOT_SUPPORTED_FOR_STATE';end if;
  update public.al_envelopes set status='cancelled',updated_at=now() where id=e.id;
  update al_private.signing_links set revoked_at=coalesce(revoked_at,now()) where envelope_id=e.id;
  update al_private.signing_outbox set status='cancelled' where envelope_id=e.id and status='pending';
  perform al_private.audit(o,e.id,'envelope.cancelled');return jsonb_build_object('id',e.id,'status','cancelled');
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;

create function public.al_signer_command(p_hash text,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare l al_private.signing_links;e public.al_envelopes;c al_private.signing_cases;r public.al_recipients; f jsonb;k text;v text;n public.al_recipients;own_fields jsonb;view jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 -- Resolve only the resource ID first, then lock envelope before link for a consistent lock order.
 select * into l from al_private.signing_links where token_hash=p_hash;
 if not found then raise exception 'INVALID_SIGNING_LINK';end if;
 select * into e from public.al_envelopes where id=l.envelope_id for update;
 select * into l from al_private.signing_links where token_hash=p_hash for update;
 select * into c from al_private.signing_cases where envelope_id=e.id;
 select * into r from public.al_recipients where id=l.recipient_id and envelope_id=e.id;
 if l.revoked_at is not null or l.expires_at<=now() or e.status not in ('sent','in_progress','finalizing','completed','declined') then raise exception 'INVALID_SIGNING_LINK';end if;
 if l.consumed_at is not null then
  if p_action='decide' and p_payload is not distinct from l.decision then return jsonb_build_object('status',r.status,'envelopeStatus',e.status);end if;
  if p_action<>'view' then raise exception 'LINK_ALREADY_USED';end if;
 end if;
 own_fields:=coalesce((select jsonb_agg(value) from jsonb_array_elements(c.snapshot->'envelope'->'fields') where value->>'recipientId'=r.id::text),'[]');
 view:=jsonb_build_object('title',c.snapshot->'envelope'->>'title','message',c.snapshot->'envelope'->>'message','recipient',jsonb_build_object('id',r.id,'name',r.name,'method',r.method,'status',r.status),'status',e.status,'snapshotHash',c.snapshot_hash,'expiresAt',l.expires_at,'fields',own_fields,'documents',coalesce((select jsonb_agg(jsonb_build_object('id',value->>'id','name',value->>'name','sha256',value->>'sha256','byte_size',value->'byte_size','page_count',value->'page_count')) from jsonb_array_elements(c.snapshot->'documents')),'[]'),'waiting',e.sequential and exists(select 1 from public.al_recipients where envelope_id=e.id and position<r.position and status<>'signed'));
 if p_action='view' then return view;end if;
 if e.status not in ('sent','in_progress') then raise exception 'DOCUMENT_LOCKED';end if;
 if e.sequential and exists(select 1 from public.al_recipients where envelope_id=e.id and position<r.position and status<>'signed') then raise exception 'WAITING_FOR_PREVIOUS_RECIPIENT';end if;
 if p_action='document' then
  select value into f from jsonb_array_elements(c.snapshot->'documents') where value->>'id'=p_payload->>'documentId';
  if f is null then raise exception 'DOCUMENT_NOT_FOUND';end if;return f;
 end if;
 if p_action<>'decide' then raise exception 'UNKNOWN_ACTION';end if;
 if p_payload->>'documentSetHash' is distinct from c.snapshot_hash then raise exception 'DOCUMENT_SET_CHANGED';end if;
 if p_payload->>'intent'='decline' then
  if length(coalesce(p_payload->>'reason',''))>500 then raise exception 'INVALID_DECISION';end if;
  update public.al_recipients set status='declined' where id=r.id;
  update public.al_envelopes set status='declined',updated_at=now() where id=e.id;
  update al_private.signing_links set consumed_at=now(),decision=p_payload where id=l.id;
  update al_private.signing_links set revoked_at=now() where envelope_id=e.id and id<>l.id;
  update al_private.signing_outbox set status='cancelled' where envelope_id=e.id and status='pending';
  insert into public.al_events(organization_id,envelope_id,kind,metadata) values(e.organization_id,e.id,'recipient.declined',jsonb_build_object('recipient_id',r.id)),(e.organization_id,e.id,'envelope.declined','{}');
  return jsonb_build_object('status','declined','envelopeStatus','declined');
 end if;
 if p_payload->>'intent' is distinct from 'approve' or p_payload->'consent' is distinct from 'true'::jsonb or p_payload->>'consentVersion' is distinct from 'email-approval-v1' or jsonb_typeof(p_payload->'values') is distinct from 'object' or r.method<>'email_approval' then raise exception 'INVALID_DECISION';end if;
 for k,v in select key,value from jsonb_each_text(p_payload->'values') loop
  if not exists(select 1 from jsonb_array_elements(own_fields) x where x->>'id'=k) or length(v)>2000 or jsonb_typeof(p_payload->'values'->k)<>'string' then raise exception 'UNASSIGNED_FIELD';end if;
 end loop;
 for f in select value from jsonb_array_elements(own_fields) loop
  v:=p_payload->'values'->>(f->>'id');
  if (f->>'required')::boolean and coalesce(trim(v),'')='' then raise exception 'REQUIRED_FIELD';end if;
  if f->>'type'='date' and coalesce(v,'')<>'' then
   if v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'INVALID_DATE';end if;
  end if;
 end loop;
 update al_private.signing_links set consumed_at=now(),decision=p_payload where id=l.id;
 update public.al_recipients set status='signed' where id=r.id;
 insert into public.al_events(organization_id,envelope_id,kind,metadata) values(e.organization_id,e.id,'recipient.signed',jsonb_build_object('recipient_id',r.id,'snapshot_hash',c.snapshot_hash,'consent_version','email-approval-v1'));
 insert into public.al_usage_events(organization_id,event_key,kind,quantity,envelope_id) values(e.organization_id,'signed:'||r.id,'recipient_signed',1,e.id) on conflict do nothing;
 if not exists(select 1 from public.al_recipients where envelope_id=e.id and status<>'signed') then
  update public.al_envelopes set status='finalizing',updated_at=now() where id=e.id;
  insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) values(e.organization_id,e.id,'finalize','finalize:'||e.id,'{}') on conflict do nothing;
 else
  update public.al_envelopes set status='in_progress',updated_at=now() where id=e.id;
  if e.sequential then
   select * into n from public.al_recipients where envelope_id=e.id and status='pending' order by position limit 1;
   insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) select e.organization_id,e.id,'invitation','invite:'||n.id,jsonb_build_object('linkId',id,'recipientId',n.id) from al_private.signing_links where recipient_id=n.id and envelope_id=e.id on conflict do nothing;
  end if;
 end if;
 return jsonb_build_object('status','signed','envelopeStatus',(select status from public.al_envelopes where id=e.id));
end $$;

create function public.al_signing_worker(p_action text,p_id uuid default null,p_lease uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j al_private.signing_outbox;e public.al_envelopes;c al_private.signing_cases;item jsonb;path text;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 if p_action='heartbeat' then
  insert into al_private.signing_worker values('main',now(),coalesce((p_payload->>'ready')::boolean,false),p_payload->>'keyFingerprint') on conflict(id) do update set heartbeat_at=now(),ready=excluded.ready,key_fingerprint=excluded.key_fingerprint;return '{}';
 end if;
 if p_action='claim' then
  -- Uncertain external email outcomes are reconciled, never blindly resent after a lost lease.
  update al_private.signing_outbox set status='reconcile',last_error='LEASE_EXPIRED_UNKNOWN_OUTCOME' where status='running' and lease_until<now() and kind in ('invitation','webhook');
  select * into j from al_private.signing_outbox where attempts<5 and ((status='pending' and available_at<=now()) or (kind='finalize' and status='running' and lease_until<now())) order by available_at for update skip locked limit 1;
  if not found then return null;end if;
  select * into e from public.al_envelopes where id=j.envelope_id;
  if (j.kind='invitation' and e.status not in ('sent','in_progress')) or (j.kind='finalize' and e.status<>'finalizing') then update al_private.signing_outbox set status='cancelled' where id=j.id;return null;end if;
  update al_private.signing_outbox set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
  select * into c from al_private.signing_cases where envelope_id=e.id;
  return jsonb_build_object('job',to_jsonb(j),'snapshot',c.snapshot,'snapshotHash',c.snapshot_hash,'expiresAt',c.expires_at,'decisions',coalesce((select jsonb_agg(jsonb_build_object('recipientId',recipient_id,'decision',decision,'consumedAt',consumed_at)) from al_private.signing_links where envelope_id=e.id and consumed_at is not null),'[]'));
 end if;
 select * into j from al_private.signing_outbox where id=p_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_lease or j.lease_until<=now() then raise exception 'LEASE_LOST';end if;
 if p_action='finish' then
  if p_payload->>'status' not in ('accepted','completed','pending','failed','reconcile') then raise exception 'INVALID_JOB_RESULT';end if;
  if j.kind='finalize' and p_payload->>'status'='completed' then
   select * into e from public.al_envelopes where id=j.envelope_id for update;
   select * into c from al_private.signing_cases where envelope_id=e.id;
   if e.status<>'finalizing' then raise exception 'DOCUMENT_LOCKED';end if;
   if jsonb_typeof(p_payload->'result'->'files') is distinct from 'array' or jsonb_array_length(p_payload->'result'->'files')<>jsonb_array_length(c.snapshot->'documents')+1 then raise exception 'INVALID_FINAL_RESULT';end if;
   if (select count(distinct value->>'documentId') from jsonb_array_elements(p_payload->'result'->'files'))<>jsonb_array_length(c.snapshot->'documents')+1 or exists(select 1 from jsonb_array_elements(p_payload->'result'->'files') x where coalesce(x->>'documentId','')<>'evidence' and not exists(select 1 from jsonb_array_elements(c.snapshot->'documents') d where d->>'id'=x->>'documentId')) or not exists(select 1 from jsonb_array_elements(p_payload->'result'->'files') x where x->>'documentId'='evidence') then raise exception 'INVALID_FINAL_RESULT';end if;
   for item in select value from jsonb_array_elements(p_payload->'result'->'files') loop
    path:=item->>'path';
    if path is null or path not like e.organization_id::text||'/'||e.id::text||'/'||j.lease_token::text||'/%' or coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$' or not exists(select 1 from storage.objects where bucket_id='al-final-documents' and name=path) then raise exception 'INVALID_FINAL_RESULT';end if;
   end loop;
   update al_private.signing_cases set result=p_payload->'result',finalized_at=now() where envelope_id=e.id;
   update public.al_envelopes set status='completed',updated_at=now() where id=e.id;
   insert into public.al_usage_events(organization_id,event_key,kind,quantity,envelope_id) values(e.organization_id,'completed:'||e.id,'envelope_completed',1,e.id),(e.organization_id,'documents:'||e.id,'document_completed',jsonb_array_length(c.snapshot->'documents'),e.id) on conflict do nothing;
   insert into public.al_events(organization_id,envelope_id,kind,metadata) values(e.organization_id,e.id,'envelope.completed',jsonb_build_object('snapshot_hash',c.snapshot_hash));
  elsif j.kind='finalize' and p_payload->>'status'='accepted' then raise exception 'INVALID_JOB_RESULT';end if;
  update al_private.signing_outbox set status=case when p_payload->>'status'='pending' and attempts>=5 then 'failed' else p_payload->>'status' end,
   available_at=coalesce((p_payload->>'retryAt')::timestamptz,now()),last_error=left(p_payload->>'error',80),provider_reference=left(p_payload->>'reference',160),lease_token=null,lease_until=null where id=j.id;
  return '{}';
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('al-final-documents','al-final-documents',false,262144000,array['application/pdf','application/zip']) on conflict(id) do nothing;
-- No client Storage policies: final documents require an authorized API projection.
do $$declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('al_flow_command','al_signer_command','al_signing_worker')) or (n.nspname='al_private' and p.proname in ('flow_context','flow_snapshot','validate_envelope_fields')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
-- Server scanner, rather than the browser, supplies authoritative page counts.
alter function public.al_finish_document_job(uuid,uuid,jsonb,text) rename to al_finish_document_job_base;
create function public.al_finish_document_job(p_id uuid,p_lease uuid,p_report jsonb,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare d uuid;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select document_id into d from al_private.jobs where id=p_id;
 perform public.al_finish_document_job_base(p_id,p_lease,p_report,p_error);
 if p_error is null and p_report->>'pdf'='PASS' and p_report ? 'pageCount' then
  if (p_report->>'pageCount')::int not between 1 and 100 then raise exception 'PAGE_LIMIT';end if;
  update public.al_documents set page_count=(p_report->>'pageCount')::int where id=d;
 end if;
end $$;
revoke all on function public.al_finish_document_job(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.al_finish_document_job(uuid,uuid,jsonb,text) to service_role;

create table al_private.webhook_secrets(endpoint_id uuid primary key references public.al_webhook_endpoints(id),secret text not null check(length(secret)>=64));
alter table al_private.webhook_secrets enable row level security;
revoke all on al_private.webhook_secrets from public,anon,authenticated;
create function public.al_configure_webhook(p_actor uuid,p_org uuid,p_url text,p_secret text,p_id uuid default null,p_active boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;w public.al_webhook_endpoints;
begin
 o:=al_private.flow_context(p_actor,null,p_org,true);perform al_private.require_access(o,true);
 if p_url !~ '^https://' or length(p_url)>2048 or length(p_secret)<64 then raise exception 'INVALID_WEBHOOK_CONFIGURATION';end if;
 if p_id is null then
  insert into public.al_webhook_endpoints(organization_id,url,active) values(o,p_url,p_active) returning * into w;
  insert into al_private.webhook_secrets values(w.id,p_secret);
 else
  update public.al_webhook_endpoints set active=p_active where organization_id=o and id=p_id returning * into w;
  if not found then raise exception 'WEBHOOK_NOT_FOUND';end if;
 end if;
 perform al_private.audit(o,null,'webhook.configured',jsonb_build_object('endpoint_id',w.id,'active',w.active));return to_jsonb(w);
end $$;
revoke all on function public.al_configure_webhook(uuid,uuid,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.al_configure_webhook(uuid,uuid,text,text,uuid,boolean) to service_role;
-- Capture non-PII integration events in the same transaction as domain events.
create function al_private.queue_signing_webhooks() returns trigger language plpgsql security definer set search_path='' as $$
declare w public.al_webhook_endpoints;g int;
begin
 if new.kind not in ('envelope.sent','recipient.signed','envelope.declined','envelope.completed','envelope.expired') or not exists(select 1 from al_private.signing_cases where envelope_id=new.envelope_id) then return new;end if;
 select generation into g from public.al_envelopes where id=new.envelope_id;
 for w in select * from public.al_webhook_endpoints where organization_id=new.organization_id and active loop
  insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) values(new.organization_id,new.envelope_id,'webhook','webhook:'||w.id||':'||new.id,jsonb_build_object('endpointId',w.id,'event',jsonb_build_object('id',new.id,'organizationId',new.organization_id,'envelopeId',new.envelope_id,'type',new.kind,'occurredAt',to_char(new.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'generation',g))) on conflict do nothing;
 end loop;return new;
end $$;
revoke all on function al_private.queue_signing_webhooks() from public,anon,authenticated;
create trigger al_queue_signing_webhooks after insert on public.al_events for each row execute function al_private.queue_signing_webhooks();
create function public.al_webhook_delivery_context(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j al_private.signing_outbox;w public.al_webhook_endpoints;s text;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select * into j from al_private.signing_outbox where id=p_id and kind='webhook' and status='running' and lease_token=p_lease and lease_until>now();
 if not found then raise exception 'LEASE_LOST';end if;
 select * into w from public.al_webhook_endpoints where id=(j.payload->>'endpointId')::uuid and organization_id=j.organization_id and active;
 if not found then raise exception 'WEBHOOK_DISABLED';end if;
 select secret into s from al_private.webhook_secrets where endpoint_id=w.id;
 return jsonb_build_object('url',w.url,'secret',s);
end $$;
revoke all on function public.al_webhook_delivery_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.al_webhook_delivery_context(uuid,uuid) to service_role;
create function public.al_expire_signing() returns int language plpgsql security definer set search_path='' as $$
declare e public.al_envelopes; n int:=0;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 for e in select x.* from public.al_envelopes x join al_private.signing_cases c on c.envelope_id=x.id where x.status in ('sent','in_progress') and c.expires_at<=now() for update of x skip locked limit 100 loop
  update public.al_envelopes set status='expired',updated_at=now() where id=e.id;
  update al_private.signing_links set revoked_at=coalesce(revoked_at,now()) where envelope_id=e.id;
  update al_private.signing_outbox set status='cancelled' where envelope_id=e.id and status='pending';
  insert into public.al_events(organization_id,envelope_id,kind) values(e.organization_id,e.id,'envelope.expired');n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.al_expire_signing() from public,anon,authenticated;
grant execute on function public.al_expire_signing() to service_role;
