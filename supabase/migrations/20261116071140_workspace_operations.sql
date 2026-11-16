-- Workspace commands. Private implementations, guarded invoker API wrappers.
create table public.al_contacts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 name text not null check(length(trim(name)) between 2 and 120),
 email text not null check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 company text not null default '' check(length(company)<=160), archived boolean not null default false,
 version int not null default 1, updated_at timestamptz not null default now(), unique(organization_id,email)
);
alter table public.al_contacts enable row level security;
grant select on public.al_contacts to authenticated;
create policy contacts_member_read on public.al_contacts for select to authenticated using(public.al_can_access(organization_id));
create index al_contacts_org_name on public.al_contacts(organization_id,name);
-- Defer uniqueness while atomically changing order, without temporary invalid positions.
alter table public.al_recipients drop constraint al_recipients_envelope_id_position_key;
alter table public.al_recipients add constraint al_recipients_envelope_id_position_key unique(envelope_id,position) deferrable initially immediate;

create function al_private.al_edit_recipient(p_org uuid,p_envelope uuid,p_id uuid,p_name text,p_email text,p_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.al_recipients;
begin
 perform al_private.lock_draft(p_org,p_envelope);
 update public.al_recipients set name=trim(p_name),email=lower(trim(p_email)),method=p_method where organization_id=p_org and envelope_id=p_envelope and id=p_id returning * into r;
 if not found then raise exception 'RECIPIENT_NOT_FOUND';end if;
 perform al_private.audit(p_org,p_envelope,'recipient.updated',jsonb_build_object('recipient_id',p_id));return to_jsonb(r);
end $$;
create function al_private.al_remove_recipient(p_org uuid,p_envelope uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform al_private.lock_draft(p_org,p_envelope);
 delete from public.al_recipients where organization_id=p_org and envelope_id=p_envelope and id=p_id;
 if not found then raise exception 'RECIPIENT_NOT_FOUND';end if;
 set constraints public.al_recipients_envelope_id_position_key deferred;
 with ordered as (select id,row_number() over(order by position) n from public.al_recipients where envelope_id=p_envelope)
 update public.al_recipients r set position=o.n from ordered o where r.id=o.id;
 set constraints public.al_recipients_envelope_id_position_key immediate;
 perform al_private.audit(p_org,p_envelope,'recipient.removed',jsonb_build_object('recipient_id',p_id));return jsonb_build_object('removed',p_id);
end $$;
create function al_private.al_reorder_recipients(p_org uuid,p_envelope uuid,p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform al_private.lock_draft(p_org,p_envelope);
 if p_ids is null or cardinality(p_ids)<>(select count(*) from public.al_recipients where envelope_id=p_envelope)
 or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids)
 or exists(select 1 from unnest(p_ids) x(id) where not exists(select 1 from public.al_recipients r where r.id=x.id and r.envelope_id=p_envelope)) then raise exception 'INVALID_RECIPIENT_ORDER';end if;
 set constraints public.al_recipients_envelope_id_position_key deferred;
 update public.al_recipients r set position=o.n from unnest(p_ids) with ordinality o(id,n) where r.id=o.id;
 set constraints public.al_recipients_envelope_id_position_key immediate;
 perform al_private.audit(p_org,p_envelope,'recipients.reordered');return to_jsonb(p_ids);
end $$;
create function al_private.al_remove_document(p_org uuid,p_envelope uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform al_private.lock_draft(p_org,p_envelope);
 if not exists(select 1 from public.al_documents where organization_id=p_org and envelope_id=p_envelope and id=p_id) then raise exception 'DOCUMENT_NOT_FOUND';end if;
 -- Keep the immutable storage object; physical cleanup is a separate retention operation.
 delete from al_private.jobs where document_id=p_id;
 delete from public.al_documents where id=p_id;
 perform al_private.audit(p_org,p_envelope,'document.detached',jsonb_build_object('document_id',p_id));return jsonb_build_object('removed',p_id);
end $$;
create function al_private.al_duplicate_draft(p_org uuid,p_envelope uuid,p_title text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.al_envelopes;v jsonb;n uuid;
begin
 perform al_private.require_access(p_org);
 select * into e from public.al_envelopes where id=p_envelope and organization_id=p_org for update;
 if not found then raise exception 'ENVELOPE_NOT_FOUND';end if;
 v:=public.al_save_draft(p_org,p_title,e.message,e.sequential,e.expires_days);n:=(v->>'id')::uuid;
 insert into public.al_recipients(organization_id,envelope_id,name,email,method,position) select p_org,n,name,email,method,position from public.al_recipients where envelope_id=p_envelope;
 -- Never reuse signed statuses, scanned document claims, evidence or usage from source.
 perform al_private.audit(p_org,n,'envelope.duplicated',jsonb_build_object('source_id',p_envelope));return v;
end $$;
create function al_private.al_save_contact(p_org uuid,p_name text,p_email text,p_company text default '',p_id uuid default null,p_version int default null,p_archived boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.al_contacts;
begin
 perform al_private.require_access(p_org);
 if p_id is null then insert into public.al_contacts(organization_id,name,email,company) values(p_org,trim(p_name),lower(trim(p_email)),trim(p_company)) returning * into c;
 else update public.al_contacts set name=trim(p_name),email=lower(trim(p_email)),company=trim(p_company),archived=p_archived,version=version+1,updated_at=now() where id=p_id and organization_id=p_org and version=p_version returning * into c;
 if not found then raise exception 'VERSION_CONFLICT';end if;end if;
 perform al_private.audit(p_org,null,'contact.saved',jsonb_build_object('contact_id',c.id,'archived',c.archived));return to_jsonb(c);
end $$;
create function al_private.al_update_organization(p_org uuid,p_name text,p_registration_number text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.al_organizations;
begin
 perform al_private.require_access(p_org,true);
 if length(coalesce(p_registration_number,''))>30 then raise exception 'INVALID_REGISTRATION_NUMBER';end if;
 update public.al_organizations set name=trim(p_name),registration_number=nullif(trim(p_registration_number),'') where id=p_org returning * into o;
 perform al_private.audit(p_org,null,'organization.updated');return to_jsonb(o);
end $$;
create function al_private.al_set_member_role(p_org uuid,p_user uuid,p_role text,p_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.al_memberships;caller_role text;
begin
 -- Serialize every membership change for this organization, including last-owner checks.
 perform 1 from public.al_organizations where id=p_org for update;
 perform al_private.require_access(p_org,true);
 select role into caller_role from public.al_memberships where organization_id=p_org and user_id=al_private.actor() and active;
 select * into m from public.al_memberships where organization_id=p_org and user_id=p_user for update;
 if not found then raise exception 'MEMBER_NOT_FOUND';end if;
 if p_role is null or p_role not in ('owner','admin','sender','reader') or p_active is null then raise exception 'INVALID_ROLE';end if;
 if caller_role<>'owner' and (m.role in ('owner','admin') or p_role in ('owner','admin')) then raise exception 'OWNER_REQUIRED';end if;
 if m.active and m.role='owner' and (not p_active or p_role<>'owner') and not exists(select 1 from public.al_memberships where organization_id=p_org and user_id<>p_user and active and role='owner') then raise exception 'LAST_OWNER';end if;
 update public.al_memberships set role=p_role,active=p_active where organization_id=p_org and user_id=p_user returning * into m;
 perform al_private.audit(p_org,null,'member.updated',jsonb_build_object('user_id',p_user,'role',p_role,'active',p_active));return to_jsonb(m);
end $$;
create function al_private.al_delete_template(p_org uuid,p_id uuid,p_version int) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform al_private.require_access(p_org);
 delete from public.al_templates where organization_id=p_org and id=p_id and version=p_version;
 if not found then raise exception 'VERSION_CONFLICT';end if;
 perform al_private.audit(p_org,null,'template.deleted',jsonb_build_object('template_id',p_id));return jsonb_build_object('removed',p_id);
end $$;
create function al_private.al_usage_summary(p_org uuid,p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.al_can_access(p_org) then raise exception 'ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then raise exception 'INVALID_PERIOD';end if;
 return jsonb_build_object('from',p_from,'to',p_to,'billing_model',(select model from public.al_billing_accounts where organization_id=p_org),'billing_enabled',(select enabled from public.al_billing_accounts where organization_id=p_org),'counts',coalesce((select jsonb_object_agg(kind,total) from(select kind,sum(quantity) total from public.al_usage_events where organization_id=p_org and occurred_at>=p_from and occurred_at<p_to group by kind)x),'{}'::jsonb));
end $$;
-- Export bounded pages by monotonic (created_at,id) tuple, never OFFSET.
create function al_private.al_activity(p_org uuid,p_limit int default 50,p_before_time timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.al_can_access(p_org) then raise exception 'ACCESS_DENIED';end if;
 if p_limit is null or p_limit not between 1 and 200 or (p_before_time is null)<>(p_before_id is null) then raise exception 'INVALID_PAGE';end if;
 return coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc) from(select * from public.al_events where organization_id=p_org and (p_before_time is null or (created_at,id)<(p_before_time,p_before_id)) order by created_at desc,id desc limit p_limit)e),'[]');
end $$;

-- Generate public INVOKER wrappers; private schema is not exposed by PostgREST.
do $wrap$
declare f record;args text;
begin
 for f in select p.proname,pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_arguments(p.oid) declaration,pg_get_function_result(p.oid) result_type,p.proargnames from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='al_private' and p.proname in ('al_edit_recipient','al_remove_recipient','al_reorder_recipients','al_remove_document','al_duplicate_draft','al_save_contact','al_update_organization','al_set_member_role','al_delete_template','al_usage_summary','al_activity') loop
 select string_agg(quote_ident(a),',') into args from unnest(f.proargnames)a;
 execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',f.proname,f.declaration,f.result_type,format('select al_private.%I(%s)',f.proname,args));
 execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
 execute format('revoke all on function al_private.%I(%s) from public,anon',f.proname,f.identity_args);
 execute format('grant execute on function public.%I(%s) to authenticated,service_role',f.proname,f.identity_args);
 execute format('grant execute on function al_private.%I(%s) to authenticated,service_role',f.proname,f.identity_args);
 end loop;
end $wrap$;

-- API extension delegates existing actions to the original implementation.
alter function al_private.api_execute(text,text,jsonb) rename to api_execute_foundation;
create function al_private.api_execute(p_hash text,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.al_api_keys;needed text;o uuid;
begin
 if p_action not in ('edit_recipient','remove_recipient','reorder_recipients','remove_document','duplicate_draft','list_contacts','save_contact','activity','usage_summary','list_templates','save_template','delete_template') then return al_private.api_execute_foundation(p_hash,p_action,p_payload);end if;
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select * into k from public.al_api_keys where token_hash=p_hash and revoked_at is null;
 if not found then raise exception 'INVALID_API_KEY';end if;
 needed:=case when p_action='usage_summary' then 'billing:read' when p_action='list_templates' then 'templates:read' when p_action in ('save_template','delete_template') then 'templates:write' when p_action in ('list_contacts','activity') then 'envelopes:read' else 'envelopes:write' end;
 if not needed=any(k.scopes) then raise exception 'SCOPE_DENIED';end if;
 perform set_config('al.actor',k.created_by::text,true);perform set_config('al.organization',k.organization_id::text,true);o:=k.organization_id;
 if not public.al_can_access(o) then raise exception 'MEMBERSHIP_REVOKED';end if;
 case p_action
 when 'edit_recipient' then return public.al_edit_recipient(o,(p_payload->>'envelopeId')::uuid,(p_payload->>'id')::uuid,p_payload->>'name',p_payload->>'email',p_payload->>'method');
 when 'remove_recipient' then return public.al_remove_recipient(o,(p_payload->>'envelopeId')::uuid,(p_payload->>'id')::uuid);
 when 'reorder_recipients' then return public.al_reorder_recipients(o,(p_payload->>'envelopeId')::uuid,array(select jsonb_array_elements_text(p_payload->'ids')::uuid));
 when 'remove_document' then return public.al_remove_document(o,(p_payload->>'envelopeId')::uuid,(p_payload->>'id')::uuid);
 when 'duplicate_draft' then return public.al_duplicate_draft(o,(p_payload->>'envelopeId')::uuid,p_payload->>'title');
 when 'list_contacts' then return coalesce((select jsonb_agg(to_jsonb(c)) from(select * from public.al_contacts where organization_id=o and not archived order by name,id limit 200)c),'[]');
 when 'save_contact' then return public.al_save_contact(o,p_payload->>'name',p_payload->>'email',coalesce(p_payload->>'company',''),(p_payload->>'id')::uuid,(p_payload->>'version')::int,coalesce((p_payload->>'archived')::boolean,false));
 when 'activity' then return public.al_activity(o,coalesce((p_payload->>'limit')::int,50),(p_payload->>'beforeTime')::timestamptz,(p_payload->>'beforeId')::uuid);
 when 'usage_summary' then return public.al_usage_summary(o,(p_payload->>'from')::timestamptz,(p_payload->>'to')::timestamptz);
 when 'list_templates' then return coalesce((select jsonb_agg(to_jsonb(t)) from(select * from public.al_templates where organization_id=o order by updated_at desc,id limit 200)t),'[]');
 when 'save_template' then return public.al_save_template(o,p_payload->>'name',p_payload->'fields',(p_payload->>'id')::uuid,(p_payload->>'version')::int);
 when 'delete_template' then return public.al_delete_template(o,(p_payload->>'id')::uuid,(p_payload->>'version')::int);
 end case;
end $$;
revoke all on function al_private.api_execute(text,text,jsonb) from public,anon,authenticated;
grant execute on function al_private.api_execute(text,text,jsonb) to service_role;
create or replace function public.al_api_dispatch(p_hash text,p_action text,p_payload jsonb default '{}',p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v al_private.idempotency;r jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.al_api_keys k join public.al_memberships m on m.organization_id=k.organization_id and m.user_id=k.created_by where k.token_hash=p_hash and k.revoked_at is null and m.active) then raise exception 'INVALID_API_KEY' using errcode='42501';end if;
 if p_action in ('list_envelopes','get_envelope','billing','list_contacts','activity','usage_summary','list_templates') then return al_private.api_execute(p_hash,p_action,p_payload);end if;
 if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
 insert into al_private.idempotency(key_hash,operation,request_key,payload) values(p_hash,p_action,p_idempotency_key,p_payload) on conflict do nothing;
 select * into v from al_private.idempotency where key_hash=p_hash and operation=p_action and request_key=p_idempotency_key for update;
 if v.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 if v.response is not null then return v.response;end if;
 r:=al_private.api_execute(p_hash,p_action,p_payload);
 update al_private.idempotency set response=r where key_hash=p_hash and operation=p_action and request_key=p_idempotency_key;
 return r;
end $$;

