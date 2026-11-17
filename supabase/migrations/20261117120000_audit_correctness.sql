-- Apply audited workflow corrections without rewriting sent snapshots or existing charges.
do $migration$
declare src text; before text; signature text;
begin
  foreach signature in array array[
    'public.al_flow_before_document_price(uuid,text,uuid,uuid,text,jsonb)',
    'public.al_signer_command(text,text,jsonb)',
    'public.al_expire_signing()'
  ] loop
    src := pg_get_functiondef(signature::regprocedure); before := src;
    src := replace(src, 'and status=''pending'';', 'and status=''pending'' and kind=''invitation'';');
    if signature like 'public.al_flow_before%' then
      src := replace(src, 'if p_action=''cancel'' then', 'if p_action=''cancel'' then
  if e.status=''cancelled'' then return jsonb_build_object(''id'',e.id,''status'',''cancelled'');end if;');
    end if;
    if signature like 'public.al_signer_command%' then
      src := replace(src, 'l.expires_at<=now()', '(l.expires_at<=now() and not (p_action in (''view'',''final'') and e.status=''completed'' and r.status=''signed'' and c.finalized_at+interval ''14 days''>now()))');
    end if;
    if src=before then raise exception 'WORKFLOW_PATCH_MISSING %',signature;end if;
    execute src;
  end loop;

  src := pg_get_functiondef('al_private.queue_signing_webhooks()'::regprocedure);
  execute replace(src, '''envelope.expired'')', '''envelope.expired'',''envelope.cancelled'')');

  src := pg_get_functiondef('al_private.queue_completion_mail()'::regprocedure);
  execute replace(src, ' and l.expires_at>now()', '');

  src := pg_get_functiondef('public.al_signing_worker(text,uuid,uuid,jsonb)'::regprocedure);
  src := replace(src, 'if p_action=''claim'' then', 'if p_action=''claim'' then
    update al_private.signing_outbox set status=''failed'',last_error=''FINALIZATION_ATTEMPTS_EXHAUSTED'',lease_token=null,lease_until=null
    where kind=''finalize'' and status=''running'' and attempts>=5 and lease_until<=now();');
  src := replace(src, '''expiresAt'',c.expires_at', '''expiresAt'',case when j.kind=''completion'' then greatest(c.expires_at,c.finalized_at+interval ''14 days'') else c.expires_at end');
  execute src;

  src := pg_get_functiondef('public.al_claim_document_job()'::regprocedure);
  src := replace(src, 'select * into j from al_private.jobs', 'with exhausted as (
    update al_private.jobs set status=''failed'',last_error=''DOCUMENT_ATTEMPTS_EXHAUSTED'',lease_token=null,lease_until=null
    where status=''running'' and attempts>=5 and lease_until<=now() returning document_id
  ) update public.al_documents target_doc set status=''rejected'' from exhausted x where x.document_id=target_doc.id and target_doc.status=''pending_scan'';
  select * into j from al_private.jobs');
  execute src;

  src := pg_get_functiondef('public.al_finish_document_job_base(uuid,uuid,jsonb,text)'::regprocedure);
  src := replace(src, 'if p_error is not null then', 'if p_error is not null then
    if j.attempts>=5 then update public.al_documents set status=''rejected'' where id=d.id and status=''pending_scan'';end if;');
  execute src;

  src := pg_get_functiondef('public.al_query_envelopes(uuid,text,uuid,jsonb)'::regprocedure);
  execute replace(src, '''in_progress'',''completed''', '''in_progress'',''finalizing'',''completed''');

  src := pg_get_functiondef('al_private.search_signed(uuid,text,uuid,int)'::regprocedure);
  execute replace(src, 'coalesce(c.search_sender->>''registrationNumber'',o.registration_number,'''')',
    'coalesce(case when c.search_sender is null then o.registration_number else c.search_sender->>''registrationNumber'' end,'''')');

  src := pg_get_functiondef('al_private.al_duplicate_draft(uuid,uuid,text)'::regprocedure);
  execute replace(src, 'email,method,position) select p_org,n,name,email,method,position', 'email,method,position,company_name,registration_number) select p_org,n,name,email,method,position,company_name,registration_number');

  src := pg_get_functiondef('al_private.al_update_organization(uuid,text,text)'::regprocedure);
  execute replace(src, 'if length(coalesce(p_registration_number,''''))>30 then raise exception ''INVALID_REGISTRATION_NUMBER'';end if;',
    'if nullif(trim(p_registration_number),'''') is not null then
      p_registration_number := al_private.validate_registration(jsonb_build_object(''kind'',''company'',''fullName'',''Kontakt'',''companyName'',p_name,''registrationNumber'',p_registration_number))->>''registrationNumber'';
    end if;');

  src := pg_get_functiondef('al_private.al_edit_recipient(uuid,uuid,uuid,text,text,text)'::regprocedure);
  execute replace(src, 'perform al_private.audit', 'update public.al_envelopes set generation=generation+1,updated_at=now() where id=p_envelope;
  perform al_private.audit');

  src := pg_get_functiondef('al_private.al_reorder_recipients(uuid,uuid,uuid[])'::regprocedure);
  execute replace(src, 'perform al_private.audit', 'update public.al_envelopes set generation=generation+1,updated_at=now() where id=p_envelope;
  perform al_private.audit');
end
$migration$;

-- The quote binds recipient identity/order even when the recipient count does not change.
do $migration$
declare src text;
begin
  src := pg_get_functiondef('al_private.document_quote(uuid,uuid)'::regprocedure);
  execute replace(src, '''documentIds'',d', '''documentIds'',d,''recipientIds'',(select jsonb_agg(id order by position) from public.al_recipients where envelope_id=p_envelope)');
end
$migration$;

create function al_private.prune_draft_field_references() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.al_envelopes e set fields=coalesce((
    select jsonb_agg(f.value order by f.ordinality)
    from jsonb_array_elements(e.fields) with ordinality f(value,ordinality)
    where (f.value->>TG_ARGV[0]) is distinct from old.id::text
  ),'[]'),generation=generation+1,updated_at=now()
  where e.id=old.envelope_id and e.status='draft'
    and exists(select 1 from jsonb_array_elements(e.fields) f where f->>TG_ARGV[0]=old.id::text);
  return old;
end $$;
revoke all on function al_private.prune_draft_field_references() from public,anon,authenticated;
create trigger prune_removed_document_fields after delete on public.al_documents
for each row execute function al_private.prune_draft_field_references('documentId');
create trigger prune_removed_recipient_fields after delete on public.al_recipients
for each row execute function al_private.prune_draft_field_references('recipientId');

-- Re-grant no new privileges. Recovery uses the existing service boundary and verifies tenant administration.
create function public.al_retry_signing_finalize(p_actor uuid,p_org uuid,p_envelope uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
  o:=al_private.flow_context(p_actor,null,p_org,true);
  perform al_private.require_access(o,true);
  perform 1 from public.al_envelopes where organization_id=o and id=p_envelope and status='finalizing' for update;
  if not found then raise exception 'DOCUMENT_LOCKED';end if;
  update al_private.signing_outbox set status='pending',attempts=0,available_at=now(),lease_token=null,lease_until=null,last_error=null
  where organization_id=o and envelope_id=p_envelope and kind='finalize' and status='failed';
  if not found then raise exception 'FINALIZATION_NOT_RETRYABLE';end if;
  perform al_private.audit(o,p_envelope,'envelope.finalization_retried');
  return jsonb_build_object('queued',true);
end $$;
revoke all on function public.al_retry_signing_finalize(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.al_retry_signing_finalize(uuid,uuid,uuid) to service_role;

do $migration$
declare src text;
begin
  src:=pg_get_functiondef('al_private.al_save_template(uuid,text,jsonb,uuid,integer)'::regprocedure);
  src:=replace(src,'jsonb_array_length(p_fields)>200','jsonb_array_length(p_fields) not between 1 and 200');
  src:=replace(src,'''text'',''date'',''signature''','''text'',''date''');
  src:=replace(src,'ids:=array_append(ids,f->>''id'');','if jsonb_typeof(f->''required'') is distinct from ''boolean''
    or jsonb_typeof(f->''label'') is distinct from ''string'' or length(trim(f->>''label''))>120
    or jsonb_typeof(f->''recipientRole'') is distinct from ''string'' or length(trim(f->>''recipientRole''))>120
    or exists(select 1 from unnest(array[''x'',''y'',''width'',''height'',''page'']) k where jsonb_typeof(f->k) is distinct from ''number'')
    or (f->>''page'')::numeric<>trunc((f->>''page'')::numeric)
    then raise exception ''INVALID_FIELDS'';end if;
    ids:=array_append(ids,f->>''id'');');
  execute src;

  src:=pg_get_functiondef('public.al_reverse_recorded_payment(text,text)'::regprocedure);
  execute replace(src,'perform 1 from public.al_organizations where id=o for update;',
    'perform 1 from public.al_organizations where id=o for update;
    if exists(select 1 from al_private.payment_reversals where reference=p_reference) then return jsonb_build_object(''ok'',true,''replay'',true);end if;');

  src:=pg_get_functiondef('public.al_platform_commercial(text,uuid,jsonb)'::regprocedure);
  src:=replace(src,'if s->>''model'' in (''per_document'',''hybrid'') then insert into al_private.document_tariffs',
    'if s->>''model'' in (''per_document'',''hybrid'') or (s->>''model''=''subscription'' and not coalesce((select commercial_offer_id is null from al_private.document_tariffs where organization_id=p_org order by version desc limit 1),false)) then insert into al_private.document_tariffs');
  src:=replace(src,'coalesce((s->>''extraSignerOre'')::bigint,0),offer from al_private.document_tariffs',
    'case when s->>''model''=''subscription'' then 0 else coalesce((s->>''extraSignerOre'')::bigint,0) end,offer from al_private.document_tariffs');
  src:=replace(src,'select reference,paid_until,created_at from al_private.payment_receipts where organization_id=p_org order by created_at desc limit 50',
    'select p.reference,p.paid_until,p.created_at,r.created_at as reversed_at from al_private.payment_receipts p left join al_private.payment_reversals r on r.reference=p.reference where p.organization_id=p_org order by p.created_at desc limit 50');
  src:=replace(src,'select count(*) from al_private.api_entitlements where not suspended and model=''subscription'' and paid_until>now()',
    'select count(*) from al_private.api_entitlements e join al_private.payment_receipts p on p.reference=e.payment_reference and p.organization_id=e.organization_id
    where not e.suspended and e.model=''subscription'' and e.paid_until>now() and p.paid_until>now()
    and not exists(select 1 from al_private.payment_reversals r where r.reference=p.reference)
    and not exists(select 1 from al_private.organization_commercial c join al_private.commercial_offers o on o.id=c.offer_id where c.organization_id=e.organization_id and (o.snapshot->>''apiIncluded'')::boolean is false)');
  execute src;
end
$migration$;

-- Existing subscriptions with an older package-derived tariff need a new zero-rate version.
-- Explicit manual tariff overrides remain in effect.
insert into al_private.document_tariffs(organization_id,version,document_ore,included_signers,extra_signer_ore,commercial_offer_id)
select c.organization_id,coalesce(t.version,0)+1,0,1,0,o.id
from al_private.organization_commercial c join al_private.commercial_offers o on o.id=c.offer_id
left join lateral (
  select version,commercial_offer_id from al_private.document_tariffs
  where organization_id=c.organization_id order by version desc limit 1
) t on true
where o.snapshot->>'model'='subscription' and (t.version is null or (t.commercial_offer_id is not null and t.commercial_offer_id<>o.id));

alter table al_private.billing_sync_tasks add column catalog_revision int;
alter table al_private.billing_sync_tasks drop constraint billing_sync_tasks_target_type_check;
alter table al_private.billing_sync_tasks add check(target_type in ('price','offer','price_visibility'));
create function al_private.queue_billing_price_visibility() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.active=old.active or new.published is null then return new; end if;
  insert into al_private.billing_sync_tasks(connection_id,target_type,target_id,terms,status,catalog_revision)
  select b.id,'price_visibility',gen_random_uuid(),jsonb_build_object('code',new.code,'version',new.published,'active',new.active,'priceId',v.id),
    case when b.configured then 'pending' else 'blocked' end,new.revision
  from al_private.billing_connections b cross join al_private.catalog_versions v
  where v.code=new.code and v.version=new.published;
  return new;
end $$;
revoke all on function al_private.queue_billing_price_visibility() from public,anon,authenticated;
create trigger queue_catalog_visibility_sync after update of active on al_private.catalog_heads
for each row execute function al_private.queue_billing_price_visibility();

-- Pending invitations take precedence over history in the existing bounded response.
do $migration$
declare src text;
begin
  src:=pg_get_functiondef('public.al_team_command(uuid,uuid,text,jsonb)'::regprocedure);
  execute replace(src,'where organization_id=o order by created_at desc limit 200',
    'where organization_id=o order by (accepted_at is null and revoked_at is null and expires_at>now()) desc,created_at desc limit 200');
end
$migration$;

create function public.al_my_payment_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e al_private.api_entitlements; paid boolean;
begin
  if auth.role()<>'authenticated' or not public.al_can_access(p_org) then raise exception 'ACCESS_DENIED';end if;
  select * into e from al_private.api_entitlements where organization_id=p_org;
  paid:=coalesce(e.paid_until>now() and exists(select 1 from al_private.payment_receipts p
    where p.reference=e.payment_reference and p.organization_id=p_org and p.paid_until>now()
    and not exists(select 1 from al_private.payment_reversals r where r.reference=p.reference)),false);
  return jsonb_build_object('model',coalesce(e.model,'unconfigured'),'enabled',paid,'paidUntil',e.paid_until);
end $$;
revoke all on function public.al_my_payment_status(uuid) from public,anon;
grant execute on function public.al_my_payment_status(uuid) to authenticated;
create function public.al_usage_by_month(p_org uuid,p_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare month_start date; summary jsonb; billing jsonb;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD';end if;
  month_start:=(p_month||'-01')::date;
  summary:=public.al_usage_summary(p_org,month_start::timestamp at time zone 'Europe/Stockholm',
     (month_start+interval '1 month') at time zone 'Europe/Stockholm');
  billing:=public.al_my_payment_status(p_org);
  return summary||jsonb_build_object('billing_enabled',billing->'enabled','billing_model',billing->'model');
end $$;
revoke all on function public.al_usage_by_month(uuid,text) from public,anon;
grant execute on function public.al_usage_by_month(uuid,text) to authenticated;

do $migration$
declare src text;
begin
  src:=pg_get_functiondef('public.al_flow_before_document_price(uuid,text,uuid,uuid,text,jsonb)'::regprocedure);
  src:=replace(src,'if p_action=''authorize_upload'' then perform al_private.lock_draft(o,e.id);',
    'if p_action=''authorize_upload'' then perform al_private.lock_draft(o,e.id);
    if p_payload ? ''id'' and exists(select 1 from al_private.storage_cleanup q where q.bucket=''al-documents'' and q.path=o::text||''/''||e.id::text||''/''||(p_payload->>''id'')||''.pdf'') then raise exception ''UPLOAD_CONFLICT'';end if;
    if p_payload ? ''id'' and not exists(select 1 from public.al_documents where envelope_id=e.id and id=(p_payload->>''id'')::uuid) then
      if (select count(*) from public.al_documents where envelope_id=e.id)>=20 then raise exception ''DOCUMENT_LIMIT'';end if;
      if (select coalesce(sum(byte_size),0) from public.al_documents where envelope_id=e.id)+coalesce((p_payload->>''byteSize'')::bigint,0)>52428800 then raise exception ''DOCUMENT_TOTAL_LIMIT'';end if;
    end if;');
  execute src;
  src:=pg_get_functiondef('al_private.al_register_document(uuid,uuid,uuid,text,text,bigint)'::regprocedure);
  execute replace(src,'if (select count(*) from public.al_documents',
    'if (select coalesce(sum(byte_size),0) from public.al_documents where envelope_id=p_envelope)+p_byte_size>52428800 then raise exception ''DOCUMENT_TOTAL_LIMIT'';end if;
    if (select count(*) from public.al_documents');
  src:=pg_get_functiondef('public.al_signer_command(text,text,jsonb)'::regprocedure);
  execute replace(src,'or to_char(v::date,''YYYY-MM-DD'')<>v',' or not al_private.valid_signing_date(v)');
end
$migration$;

create function al_private.valid_signing_date(value text) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  return to_char(value::date,'YYYY-MM-DD')=value;
exception when invalid_datetime_format or datetime_field_overflow then
  return false;
end $$;
revoke all on function al_private.valid_signing_date(text) from public,anon,authenticated;

-- Storage objects are deleted through the Storage API, after the database fences registration.
create table al_private.storage_cleanup (
  bucket text not null,
  path text not null,
  scheduled_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key(bucket,path)
);
alter table al_private.storage_cleanup enable row level security;
revoke all on al_private.storage_cleanup from public,anon,authenticated;

create function al_private.check_original_cleanup_fence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('al:storage:'||new.storage_path,0));
  if exists(select 1 from al_private.storage_cleanup where bucket='al-documents' and path=new.storage_path) then raise exception 'UPLOAD_CONFLICT';end if;
  return new;
end $$;
revoke all on function al_private.check_original_cleanup_fence() from public,anon,authenticated;
create trigger al_original_cleanup_fence before insert on public.al_documents
for each row execute function al_private.check_original_cleanup_fence();

create function public.al_storage_cleanup_batch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare obj record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED';end if;
  for obj in
    select s.bucket_id,s.name from storage.objects s
    where s.bucket_id in ('al-documents','al-final-documents')
      and (to_jsonb(s)->>'created_at')::timestamptz<now()-interval '7 days'
      and not exists(select 1 from al_private.storage_cleanup q where q.bucket=s.bucket_id and q.path=s.name)
      and (s.bucket_id<>'al-documents' or not exists(select 1 from public.al_documents d where d.storage_path=s.name))
      and (s.bucket_id<>'al-final-documents' or
        (not exists(select 1 from al_private.signing_cases c cross join lateral jsonb_array_elements(c.result->'files') f where c.envelope_id::text=split_part(s.name,'/',2) and f->>'path'=s.name)
        and not exists(select 1 from al_private.signing_outbox j where j.kind='finalize' and j.status='running' and j.lease_until>now()
           and s.name like j.organization_id::text||'/'||j.envelope_id::text||'/'||j.lease_token::text||'/%')))
    order by s.bucket_id,s.name limit 20
  loop
    if obj.bucket_id='al-documents' then
      perform pg_advisory_xact_lock(hashtextextended('al:storage:'||obj.name,0));
      if exists(select 1 from public.al_documents where storage_path=obj.name) then continue;end if;
    else
      -- Serialize against a finish transaction that may still be committing a result.
      perform 1 from al_private.signing_outbox j where j.kind='finalize'
        and j.envelope_id::text=split_part(obj.name,'/',2) for update;
      if exists(select 1 from al_private.signing_cases c cross join lateral jsonb_array_elements(c.result->'files') f
        where c.envelope_id::text=split_part(obj.name,'/',2) and f->>'path'=obj.name) then continue;end if;
    end if;
    insert into al_private.storage_cleanup(bucket,path) values(obj.bucket_id,obj.name) on conflict do nothing;
  end loop;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from
    (select bucket,path from al_private.storage_cleanup where removed_at is null order by scheduled_at,bucket,path limit 20)x);
end $$;
revoke all on function public.al_storage_cleanup_batch() from public,anon,authenticated;
grant execute on function public.al_storage_cleanup_batch() to service_role;

create function public.al_storage_cleanup_done(p_bucket text,p_paths text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED';end if;
  update al_private.storage_cleanup set removed_at=now()
  where bucket=p_bucket and path=any(p_paths) and removed_at is null
    and not exists(select 1 from storage.objects s where s.bucket_id=p_bucket and s.name=path);
end $$;
revoke all on function public.al_storage_cleanup_done(text,text[]) from public,anon,authenticated;
grant execute on function public.al_storage_cleanup_done(text,text[]) to service_role;

create function public.al_recover_signing_email(p_actor uuid,p_org uuid,p_envelope uuid,p_job uuid,p_outcome text,p_reference text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;j al_private.signing_outbox;e public.al_envelopes;
begin
  o:=al_private.flow_context(p_actor,null,p_org,true);
  perform al_private.require_access(o,true);
  select * into e from public.al_envelopes where organization_id=o and id=p_envelope for update;
  if not found then raise exception 'ENVELOPE_NOT_FOUND';end if;
  select * into j from al_private.signing_outbox where organization_id=o and envelope_id=e.id and id=p_job and kind in ('invitation','completion') for update;
  if not found or j.status not in ('failed','reconcile') then raise exception 'DELIVERY_NOT_RECOVERABLE';end if;
  if p_outcome='retry' then
    if (j.kind='invitation' and e.status not in ('sent','in_progress')) or (j.kind='completion' and e.status<>'completed') then raise exception 'DOCUMENT_LOCKED';end if;
    if j.status='reconcile' and length(trim(coalesce(p_reference,''))) not between 3 and 160 then raise exception 'INVALID_BODY';end if;
    update al_private.signing_outbox set status='pending',attempts=0,available_at=now(),lease_token=null,lease_until=null,last_error=null where id=j.id;
  elsif p_outcome='accepted' and j.status='reconcile' and length(trim(coalesce(p_reference,''))) between 3 and 160 then
    update al_private.signing_outbox set status='accepted',provider_reference=trim(p_reference),lease_token=null,lease_until=null,last_error=null where id=j.id;
  else raise exception 'INVALID_BODY';end if;
  perform al_private.audit(o,e.id,'email.delivery_reconciled',jsonb_build_object('jobId',j.id,'decision',p_outcome,'reference',left(p_reference,160)));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.al_recover_signing_email(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.al_recover_signing_email(uuid,uuid,uuid,uuid,text,text) to service_role;

-- Keep existing response shapes and allow bounded navigation of older records.
do $migration$
declare src text;
begin
  src:=pg_get_functiondef('public.al_platform(text,uuid,jsonb)'::regprocedure);
  src:=replace(src,'where o.name ilike ''%''||left(coalesce(p_payload->>''search'',''''),120)||''%'' order by o.created_at desc,o.id limit 200',
    'where (o.name ilike ''%''||left(coalesce(p_payload->>''search'',''''),120)||''%''
     or (p_payload->>''search'' ~ ''^[0-9 -]+$'' and regexp_replace(o.registration_number,''[- ]'','''',''g'')=regexp_replace(p_payload->>''search'',''[- ]'','''',''g'')))
     order by o.created_at desc,o.id limit 200 offset greatest(0,coalesce((p_payload->>''offset'')::int,0))');
  src:=replace(src,'order by created_at desc limit 100)x)', 'order by created_at desc,id limit 100 offset greatest(0,coalesce((p_payload->>''agreementOffset'')::int,0)))x)');
  src:=replace(src,'order by created_at desc limit 50)x)', 'order by created_at desc,id limit 50 offset greatest(0,coalesce((p_payload->>''auditOffset'')::int,0)))x)');
  execute src;
end
$migration$;

-- Remove stale references from existing drafts only. Signed/sent data is left intact.
with stale as (
  select e.id,coalesce(jsonb_agg(f.value order by f.ordinality) filter (where
    exists(select 1 from public.al_documents d where d.envelope_id=e.id and d.id::text=f.value->>'documentId')
    and exists(select 1 from public.al_recipients r where r.envelope_id=e.id and r.id::text=f.value->>'recipientId')
  ),'[]') as fields
  from public.al_envelopes e cross join lateral jsonb_array_elements(e.fields) with ordinality f(value,ordinality)
  where e.status='draft' group by e.id
)
update public.al_envelopes e set fields=stale.fields,generation=e.generation+1,updated_at=now()
from stale where stale.id=e.id and e.status='draft' and e.fields is distinct from stale.fields;

do $migration$
declare src text;
begin
  src:=pg_get_functiondef('public.al_flow_before_document_price(uuid,text,uuid,uuid,text,jsonb)'::regprocedure);
  execute replace(src, $needle$'last_error',last_error$needle$,
    $replacement$'last_error',last_error,'canRecover',p_key_hash is null and exists(select 1 from public.al_memberships m where m.organization_id=o and m.user_id=p_actor and m.active and m.role in ('owner','admin'))$replacement$);
end
$migration$;
