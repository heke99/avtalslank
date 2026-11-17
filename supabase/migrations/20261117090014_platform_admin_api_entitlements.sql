-- Platform operations are separate from tenant membership. No metadata-based promotion.
create table al_private.platform_admins(user_id uuid primary key references auth.users(id),active boolean not null default true,created_at timestamptz not null default now());
create table al_private.platform_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),organization_id uuid references public.al_organizations(id),action text not null,reason text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create table al_private.api_entitlements(organization_id uuid primary key references public.al_organizations(id),suspended boolean not null default false,model text not null default 'unconfigured' check(model in ('unconfigured','subscription','per_document','hybrid')),paid_until timestamptz,payment_reference text unique,updated_at timestamptz not null default now());
create table al_private.payment_receipts(reference text primary key,organization_id uuid not null references public.al_organizations(id),paid_until timestamptz not null,recorded_by uuid not null references auth.users(id),created_at timestamptz not null default now());
alter table al_private.payment_receipts enable row level security;
revoke all on al_private.payment_receipts from public,anon,authenticated;
alter table al_private.platform_admins enable row level security;
alter table al_private.platform_audit enable row level security;
alter table al_private.api_entitlements enable row level security;
revoke all on al_private.platform_admins,al_private.platform_audit,al_private.api_entitlements from public,anon,authenticated;
create function al_private.platform_audit_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'IMMUTABLE_AUDIT';end $$;
create trigger immutable_platform_audit before update or delete on al_private.platform_audit for each row execute function al_private.platform_audit_immutable();
create trigger immutable_payment_receipt before update or delete on al_private.payment_receipts for each row execute function al_private.platform_audit_immutable();
revoke all on function al_private.platform_audit_immutable() from public,anon,authenticated;
-- Same guard covers legacy dispatch, cached responses and all connected key routes.
alter function al_private.assert_key_live(text) rename to assert_key_live_before_payment;
create function al_private.assert_key_live(p_hash text) returns void language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 perform al_private.assert_key_live_before_payment(p_hash);
 select organization_id into o from public.al_api_keys where token_hash=p_hash;
 if not exists(select 1 from al_private.api_entitlements e where e.organization_id=o and not e.suspended and e.model='subscription' and e.paid_until>now() and e.payment_reference is not null) then raise exception 'PAYMENT_REQUIRED';end if;
end $$;
revoke all on function al_private.assert_key_live(text) from public,anon,authenticated;
grant execute on function al_private.assert_key_live(text) to service_role;
create function public.al_api_payment_guard(p_hash text) returns void language plpgsql security definer set search_path='' as $$begin perform al_private.assert_key_live(p_hash);end $$;
revoke all on function public.al_api_payment_guard(text) from public,anon,authenticated;
grant execute on function public.al_api_payment_guard(text) to service_role;
create function public.al_platform(p_action text,p_org uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;result jsonb;r text;target uuid;old_role text;new_role text;
begin
 if auth.role()<>'authenticated' or actor is null then raise exception 'AUTH_REQUIRED';end if;
 if p_action='status' then return jsonb_build_object('admin',exists(select 1 from al_private.platform_admins where user_id=actor and active),'mfa',claims->>'aal'='aal2');end if;
 if not exists(select 1 from al_private.platform_admins where user_id=actor and active) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 if claims->>'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(select o.id,o.name,o.kind,o.registration_number,e.model,e.paid_until,e.suspended,(select count(*) from public.al_memberships m where m.organization_id=o.id and m.active) as members from public.al_organizations o left join al_private.api_entitlements e on e.organization_id=o.id where o.name ilike '%'||left(coalesce(p_payload->>'search',''),120)||'%' order by o.created_at desc,o.id limit 200)x;
 else
  perform 1 from public.al_organizations where id=p_org for update;if not found then raise exception 'NOT_FOUND';end if;
  if p_action='detail' then
   result:=jsonb_build_object('organization',(select to_jsonb(o) from public.al_organizations o where id=p_org),'members',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role,'active',m.active,'email',u.email)),'[]') from public.al_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_org),'agreements',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,title,status,created_at from public.al_envelopes where organization_id=p_org order by created_at desc limit 100)x),'entitlement',(select to_jsonb(e) from al_private.api_entitlements e where organization_id=p_org),'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select actor_id,action,reason,created_at from al_private.platform_audit where organization_id=p_org order by created_at desc limit 50)x));
  else
   r:=trim(p_payload->>'reason');if r is null or length(r) not between 10 and 500 then raise exception 'REASON_REQUIRED';end if;
   if p_action='suspend_api' then
    if jsonb_typeof(p_payload->'suspended') is distinct from 'boolean' then raise exception 'INVALID_BODY';end if;
    insert into al_private.api_entitlements(organization_id,suspended) values(p_org,(p_payload->>'suspended')::boolean) on conflict(organization_id) do update set suspended=excluded.suspended,updated_at=now();
   elsif p_action='record_payment' then
    -- Only time-bounded subscriptions are enabled. Credit charging needs reservations first.
    if p_payload->>'model' is distinct from 'subscription' or length(trim(coalesce(p_payload->>'reference',''))) not between 5 and 160 or (p_payload->>'paidUntil') is null or (p_payload->>'paidUntil')::timestamptz<=now() or (p_payload->>'paidUntil')::timestamptz>now()+interval '1 year' then raise exception 'INVALID_PAYMENT';end if;
    insert into al_private.payment_receipts(reference,organization_id,paid_until,recorded_by) values(trim(p_payload->>'reference'),p_org,(p_payload->>'paidUntil')::timestamptz,actor) on conflict(reference) do nothing;
    if not exists(select 1 from al_private.payment_receipts where reference=trim(p_payload->>'reference') and organization_id=p_org and paid_until=(p_payload->>'paidUntil')::timestamptz) then raise exception 'PAYMENT_REFERENCE_CONFLICT';end if;
    insert into al_private.api_entitlements(organization_id,model,paid_until,payment_reference) values(p_org,'subscription',(p_payload->>'paidUntil')::timestamptz,trim(p_payload->>'reference')) on conflict(organization_id) do update set model=excluded.model,paid_until=excluded.paid_until,payment_reference=excluded.payment_reference,updated_at=now();
   elsif p_action='revoke_keys' then update public.al_api_keys set revoked_at=now() where organization_id=p_org and revoked_at is null;
   elsif p_action='member' then
    target:=(p_payload->>'userId')::uuid;new_role:=p_payload->>'role';
    if new_role is null or new_role not in ('owner','admin','sender','reader') or jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'INVALID_ROLE';end if;
    select role into old_role from public.al_memberships where organization_id=p_org and user_id=target for update;if not found then raise exception 'NOT_FOUND';end if;
    if old_role='owner' and (new_role<>'owner' or not (p_payload->>'active')::boolean) and not exists(select 1 from public.al_memberships where organization_id=p_org and user_id<>target and active and role='owner') then raise exception 'LAST_OWNER';end if;
    update public.al_memberships set role=new_role,active=(p_payload->>'active')::boolean where organization_id=p_org and user_id=target;
   else raise exception 'INVALID_ACTION';end if;
   result:=jsonb_build_object('ok',true);
  end if;
 end if;
 insert into al_private.platform_audit(actor_id,organization_id,action,reason,metadata) values(actor,p_org,p_action,coalesce(r,'Administrative read'),case when p_action='member' then jsonb_build_object('userId',target,'role',new_role,'active',p_payload->'active') when p_action='record_payment' then jsonb_build_object('reference',p_payload->>'reference','paidUntil',p_payload->>'paidUntil') else '{}' end);
 return result;
end $$;
revoke all on function public.al_platform(text,uuid,jsonb) from public,anon;
grant execute on function public.al_platform(text,uuid,jsonb) to authenticated;
