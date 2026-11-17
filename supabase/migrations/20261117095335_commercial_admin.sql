-- Prices are versioned in integer ore. Catalog edits never charge or prove payment.
create table al_private.catalog_heads(code text primary key check(code~'^[a-z][a-z0-9_-]{2,39}$'),revision int not null default 0,latest int not null default 0,published int,active boolean not null default true);
create table al_private.catalog_versions(id uuid primary key default gen_random_uuid(),code text not null references al_private.catalog_heads(code),version int not null,terms jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(code,version));
create table al_private.commercial_offers(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.al_organizations(id),price_id uuid not null references al_private.catalog_versions(id),snapshot jsonb not null,reference text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,id));
create table al_private.organization_commercial(organization_id uuid primary key references public.al_organizations(id),offer_id uuid not null,revision int not null default 1,foreign key(organization_id,offer_id) references al_private.commercial_offers(organization_id,id));
create table al_private.support_notes(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.al_organizations(id),body text not null check(length(body) between 1 and 2000),created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['catalog_heads','catalog_versions','commercial_offers','organization_commercial','support_notes'] loop execute format('alter table al_private.%I enable row level security',t);execute format('revoke all on al_private.%I from public,anon,authenticated',t);execute format('create policy deny_client_access on al_private.%I as restrictive for all to anon,authenticated using(false) with check(false)',t);end loop;end $$;
create trigger immutable_catalog_version before update or delete on al_private.catalog_versions for each row execute function al_private.platform_audit_immutable();
create trigger immutable_commercial_offer before update or delete on al_private.commercial_offers for each row execute function al_private.platform_audit_immutable();
create function al_private.require_platform_admin() returns uuid language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid();begin
 if auth.role()<>'authenticated' or u is null or not exists(select 1 from al_private.platform_admins where user_id=u and active) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 if (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;return u;
end $$;
revoke all on function al_private.require_platform_admin() from public,anon,authenticated;
create function public.al_platform_commercial(p_action text,p_org uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=al_private.require_platform_admin();r text;h al_private.catalog_heads;v al_private.catalog_versions;s jsonb;n int;result jsonb;offer uuid;rev int;
begin
 if p_action='overview' then
  result:=jsonb_build_object('organizations',(select count(*) from public.al_organizations),'users',(select count(*) from auth.users),'agreements',(select count(*) from public.al_envelopes),'completed',(select count(*) from public.al_envelopes where status='completed'),'paidApi',(select count(*) from al_private.api_entitlements where not suspended and model='subscription' and paid_until>now()),'failedJobs',(select count(*) from al_private.jobs where status='failed'));
 elsif p_action='catalog' then
  result:=coalesce((select jsonb_agg(to_jsonb(x)) from(select ch.code,ch.revision,ch.latest,ch.published,ch.active,cv.id,cv.terms from al_private.catalog_heads ch join al_private.catalog_versions cv on cv.code=ch.code and cv.version=ch.latest order by ch.code)x),'[]');
 elsif p_action='company' then
  if not exists(select 1 from public.al_organizations where id=p_org) then raise exception 'NOT_FOUND';end if;
  result:=jsonb_build_object('offer',(select to_jsonb(o)||jsonb_build_object('revision',c.revision) from al_private.organization_commercial c join al_private.commercial_offers o on o.id=c.offer_id where c.organization_id=p_org),'history',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,snapshot,reference,created_at from al_private.commercial_offers where organization_id=p_org order by created_at desc limit 50)x),'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select reference,paid_until,created_at from al_private.payment_receipts where organization_id=p_org order by created_at desc limit 50)x),'notes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select body,created_by,created_at from al_private.support_notes where organization_id=p_org order by created_at desc limit 50)x),'usage',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select kind,sum(quantity) as quantity from public.al_usage_events where organization_id=p_org group by kind)x));
 else
  r:=trim(p_payload->>'reason');if r is null or length(r) not between 10 and 500 then raise exception 'REASON_REQUIRED';end if;
  if p_action in ('save_price','publish_price','archive_price') then
   if coalesce(p_payload->>'code','')!~'^[a-z][a-z0-9_-]{2,39}$' then raise exception 'INVALID_PRICE';end if;
   perform pg_advisory_xact_lock(hashtextextended('al-catalog:'||(p_payload->>'code'),0));
   select * into h from al_private.catalog_heads where code=p_payload->>'code' for update;
   if not found then
    if p_action<>'save_price' or coalesce((p_payload->>'revision')::int,-1)<>0 then raise exception 'VERSION_CONFLICT';end if;
    insert into al_private.catalog_heads(code) values(p_payload->>'code') returning * into h;
   end if;
   if (p_payload->>'revision') is null or h.revision<>(p_payload->>'revision')::int then raise exception 'VERSION_CONFLICT';end if;
   if p_action='save_price' then
    s:=p_payload->'terms';
    if jsonb_typeof(s) is distinct from 'object' or length(trim(coalesce(s->>'name',''))) not between 2 and 80 or length(coalesce(s->>'description',''))>500 or coalesce(s->>'model','') not in ('subscription','per_document','hybrid') or coalesce(s->>'interval','') not in ('month','year') or jsonb_typeof(s->'apiIncluded') is distinct from 'boolean' then raise exception 'INVALID_PRICE';end if;
    foreach r in array array['baseOre','documentOre','includedDocuments','userLimit','bindingMonths','noticeMonths'] loop
     if coalesce(s->>r,'')!~'^[0-9]{1,9}$' or (s->>r)::bigint>100000000 or (r in ('bindingMonths','noticeMonths') and (s->>r)::int>120) then raise exception 'INVALID_PRICE';end if;
    end loop;
    if (s->>'model'='per_document' and (s->>'baseOre')::int<>0) or (s->>'model'='subscription' and (s->>'documentOre')::int<>0) then raise exception 'INVALID_PRICE';end if;
    s:=jsonb_build_object('name',trim(s->>'name'),'description',coalesce(s->>'description',''),'model',s->>'model','interval',s->>'interval','baseOre',(s->>'baseOre')::int,'documentOre',(s->>'documentOre')::int,'includedDocuments',(s->>'includedDocuments')::int,'userLimit',(s->>'userLimit')::int,'bindingMonths',(s->>'bindingMonths')::int,'noticeMonths',(s->>'noticeMonths')::int,'apiIncluded',(s->>'apiIncluded')::boolean,'currency','SEK','taxBasis','excluding_vat');
    n:=h.latest+1;insert into al_private.catalog_versions(code,version,terms,created_by) values(h.code,n,s,u);
    update al_private.catalog_heads set latest=n,revision=revision+1 where code=h.code;
   elsif p_action='publish_price' then
    if h.latest=0 or not h.active then raise exception 'INVALID_PRICE';end if;
    update al_private.catalog_heads set published=latest,revision=revision+1 where code=h.code;
   else update al_private.catalog_heads set active=not active,revision=revision+1 where code=h.code;
   end if;
   result:=jsonb_build_object('ok',true,'code',h.code,'revision',h.revision+1);
  else
   perform 1 from public.al_organizations where id=p_org for update;if not found then raise exception 'NOT_FOUND';end if;
   if p_action='assign_offer' then
    select * into v from al_private.catalog_versions where id=(p_payload->>'priceId')::uuid;
    if not found or not exists(select 1 from al_private.catalog_heads where code=v.code and active) then raise exception 'INVALID_PRICE';end if;
    select revision into rev from al_private.organization_commercial where organization_id=p_org;
    if coalesce((p_payload->>'revision')::int,-1)<>coalesce(rev,0) then raise exception 'VERSION_CONFLICT';end if;
    if length(trim(coalesce(p_payload->>'reference',''))) not between 3 and 160 then raise exception 'INVALID_BODY';end if;
    s:=v.terms;
    foreach r in array array['baseOre','documentOre'] loop
     if p_payload ? r then
      if coalesce(p_payload->>r,'')!~'^[0-9]{1,9}$' or (p_payload->>r)::bigint>100000000 then raise exception 'INVALID_PRICE';end if;
      s:=jsonb_set(s,array[r],to_jsonb((p_payload->>r)::int));
     end if;
    end loop;
    if (s->>'model'='per_document' and (s->>'baseOre')::int<>0) or (s->>'model'='subscription' and (s->>'documentOre')::int<>0) then raise exception 'INVALID_PRICE';end if;
    insert into al_private.commercial_offers(organization_id,price_id,snapshot,reference,created_by) values(p_org,v.id,s,trim(p_payload->>'reference'),u) returning id into offer;
    insert into al_private.organization_commercial(organization_id,offer_id) values(p_org,offer) on conflict(organization_id) do update set offer_id=excluded.offer_id,revision=organization_commercial.revision+1;
   elsif p_action='note' then insert into al_private.support_notes(organization_id,body,created_by) values(p_org,trim(p_payload->>'body'),u);
   elsif p_action='rename_company' then
    if length(trim(coalesce(p_payload->>'name',''))) not between 2 and 120 then raise exception 'INVALID_BODY';end if;
    update public.al_organizations set name=trim(p_payload->>'name') where id=p_org;
   else raise exception 'INVALID_ACTION';end if;
   result:=jsonb_build_object('ok',true);
  end if;
  r:=trim(p_payload->>'reason');
 end if;
 insert into al_private.platform_audit(actor_id,organization_id,action,reason,metadata) values(u,p_org,'commercial.'||p_action,coalesce(r,'Administrative read'),case when p_action in ('save_price','publish_price','archive_price') then result when p_action='assign_offer' then jsonb_build_object('offerId',offer) else '{}' end);
 return result;
end $$;
revoke all on function public.al_platform_commercial(text,uuid,jsonb) from public,anon;
grant execute on function public.al_platform_commercial(text,uuid,jsonb) to authenticated;
create function public.al_public_prices() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('code',h.code,'version',v.version,'terms',v.terms) order by h.code),'[]') from al_private.catalog_heads h join al_private.catalog_versions v on v.code=h.code and v.version=h.published where h.active
$$;
revoke all on function public.al_public_prices() from public;
grant execute on function public.al_public_prices() to anon,authenticated;
create function public.al_my_commercial(p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.role()<>'authenticated' or not public.al_can_access(p_org) then raise exception 'ACCESS_DENIED';end if;
 return (select jsonb_build_object('snapshot',o.snapshot,'reference',o.reference,'createdAt',o.created_at) from al_private.organization_commercial c join al_private.commercial_offers o on o.id=c.offer_id where c.organization_id=p_org);
end $$;
revoke all on function public.al_my_commercial(uuid) from public,anon;
grant execute on function public.al_my_commercial(uuid) to authenticated;
-- A price assignment can restrict API, but never grants it without separate paid entitlement.
alter function al_private.assert_key_live(text) rename to assert_key_live_before_catalog;
create function al_private.assert_key_live(p_hash text) returns void language plpgsql security definer set search_path='' as $$begin
 perform al_private.assert_key_live_before_catalog(p_hash);
 if exists(select 1 from public.al_api_keys k join al_private.organization_commercial c on c.organization_id=k.organization_id join al_private.commercial_offers o on o.id=c.offer_id where k.token_hash=p_hash and not (o.snapshot->>'apiIncluded')::boolean) then raise exception 'PAYMENT_REQUIRED';end if;
end $$;
revoke all on function al_private.assert_key_live(text) from public,anon,authenticated;
grant execute on function al_private.assert_key_live(text) to service_role;
-- Provider-neutral identity and durable sync state. Keys are runtime secrets, never database/UI fields.
create table al_private.billing_connections(id uuid primary key default gen_random_uuid(),provider text not null,display_name text not null,account_reference text,configured boolean not null default false,new_payments boolean not null default false,check(not new_payments or configured));
create unique index one_new_payment_provider on al_private.billing_connections(new_payments) where new_payments;
create table al_private.billing_sync_tasks(id uuid primary key default gen_random_uuid(),connection_id uuid not null references al_private.billing_connections(id),target_type text not null check(target_type in ('price','offer')),target_id uuid not null,terms jsonb not null,status text not null default 'blocked' check(status in ('blocked','pending','running','synced','failed','unknown')),created_at timestamptz not null default now(),unique(connection_id,target_type,target_id));
create table al_private.billing_external_objects(connection_id uuid not null references al_private.billing_connections(id),kind text not null check(kind in ('price','offer','customer','subscription','payment')),local_id uuid not null,external_id text not null,created_at timestamptz not null default now(),primary key(connection_id,kind,local_id),unique(connection_id,kind,external_id));
do $$declare t text;begin foreach t in array array['billing_connections','billing_sync_tasks','billing_external_objects'] loop execute format('alter table al_private.%I enable row level security',t);execute format('revoke all on al_private.%I from public,anon,authenticated',t);execute format('create policy deny_client_access on al_private.%I as restrictive for all to anon,authenticated using(false) with check(false)',t);end loop;end $$;
insert into al_private.billing_connections(provider,display_name) values('stripe','Stripe – Avtalslänk (inte ansluten)');
create function al_private.queue_billing_price() returns trigger language plpgsql security definer set search_path='' as $$declare t jsonb;k uuid;kind text;begin
 if tg_table_name='catalog_heads' then
  if new.published is null or new.published is not distinct from old.published then return new;end if;
  select terms,id into t,k from al_private.catalog_versions where code=new.code and version=new.published;kind:='price';
 else t:=new.snapshot;k:=new.id;kind:='offer';end if;
 insert into al_private.billing_sync_tasks(connection_id,target_type,target_id,terms,status) select id,kind,k,t,case when configured then 'pending' else 'blocked' end from al_private.billing_connections on conflict do nothing;
 return new;
end $$;
revoke all on function al_private.queue_billing_price() from public,anon,authenticated;
create trigger queue_catalog_sync after update of published on al_private.catalog_heads for each row execute function al_private.queue_billing_price();
create trigger queue_offer_sync after insert on al_private.commercial_offers for each row execute function al_private.queue_billing_price();
create function public.al_platform_billing_status() returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform al_private.require_platform_admin();return jsonb_build_object('connections',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'name',display_name,'configured',configured,'newPayments',new_payments)),'[]') from al_private.billing_connections),'sync',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select status,count(*) as count from al_private.billing_sync_tasks group by status)x));
end $$;
revoke all on function public.al_platform_billing_status() from public,anon;
grant execute on function public.al_platform_billing_status() to authenticated;
