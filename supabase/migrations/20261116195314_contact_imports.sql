-- Contact imports are atomic, tenant-bound and replay-safe. No raw source file/rows retained in receipts.
create table al_private.contact_imports(
 organization_id uuid not null references public.al_organizations(id),request_id uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),actor_id uuid not null references auth.users(id),
 result jsonb not null,created_at timestamptz not null default now(),primary key(organization_id,request_id)
);
alter table al_private.contact_imports enable row level security;
create policy no_client_access on al_private.contact_imports as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on al_private.contact_imports from public,anon,authenticated;
create index contact_imports_org_time on al_private.contact_imports(organization_id,created_at desc,request_id desc);
create index contact_imports_actor on al_private.contact_imports(actor_id);
create function public.al_contact_import(p_actor uuid,p_key_hash text,p_org uuid,p_request uuid default null,p_rows jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;digest text;receipt al_private.contact_imports;row jsonb;normalized jsonb:='[]';emails text[]:='{}';n text;e text;c text;created int:=0;skipped int:=0;archived int:=0;result jsonb;existing public.al_contacts;begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,p_rows is not null);
 if p_rows is null then return coalesce((select jsonb_agg(jsonb_build_object('requestId',x.request_id,'createdAt',x.created_at,'result',x.result) order by x.created_at desc,x.request_id desc) from(select * from al_private.contact_imports where organization_id=o order by created_at desc,request_id desc limit 20)x),'[]');end if;
 perform al_private.require_access(o);
 if p_request is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 or octet_length(p_rows::text)>65536 then raise exception 'CONTACT_IMPORT_LIMIT';end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row)<>'object' or jsonb_typeof(row->'name') is distinct from 'string' or jsonb_typeof(row->'email') is distinct from 'string' or (row ? 'company' and jsonb_typeof(row->'company') is distinct from 'string') then raise exception 'INVALID_CONTACT_IMPORT';end if;
  if exists(select 1 from jsonb_object_keys(row) k where k not in ('name','email','company')) then raise exception 'INVALID_CONTACT_IMPORT';end if;
  n:=trim(row->>'name');e:=lower(trim(row->>'email'));c:=trim(coalesce(row->>'company',''));
  if length(n) not between 2 and 120 or length(e)>254 or e!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(c)>160 then raise exception 'INVALID_CONTACT_IMPORT';end if;
  if e=any(emails) then raise exception 'DUPLICATE_IMPORT_EMAIL';end if;emails:=array_append(emails,e);
  normalized:=normalized||jsonb_build_array(jsonb_build_object('name',n,'email',e,'company',c));
 end loop;
 digest:=encode(pg_catalog.sha256(convert_to(normalized::text,'UTF8')),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('al:contact-import:'||o::text,0));
 select * into receipt from al_private.contact_imports where organization_id=o and request_id=p_request;
 if found then if receipt.payload_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT';end if;return receipt.result;end if;
 for row in select value from jsonb_array_elements(normalized) loop
  select * into existing from public.al_contacts where organization_id=o and email=row->>'email' for update;
  if found then skipped:=skipped+1;if existing.archived then archived:=archived+1;end if;
  else
   -- A concurrent ordinary contact creation can win; ON CONFLICT preserves that contact.
   insert into public.al_contacts(organization_id,name,email,company) values(o,row->>'name',row->>'email',row->>'company') on conflict(organization_id,email) do nothing;
   if found then created:=created+1;else skipped:=skipped+1;end if;
  end if;
 end loop;
 result:=jsonb_build_object('requestId',p_request,'total',jsonb_array_length(normalized),'created',created,'skipped',skipped,'archivedSkipped',archived);
 insert into al_private.contact_imports(organization_id,request_id,payload_hash,actor_id,result) values(o,p_request,digest,al_private.actor(),result);
 perform al_private.audit(o,null,'contacts.imported',result);return result;
end $$;
revoke all on function public.al_contact_import(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.al_contact_import(uuid,text,uuid,uuid,jsonb) to service_role;
