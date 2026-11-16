-- Account evidence and integration lifecycle. Verified Edge identities only.
alter table public.al_api_keys add column expires_at timestamptz;
alter table public.al_api_keys add column last_used_at timestamptz;
grant select(expires_at,last_used_at) on public.al_api_keys to authenticated;
create function al_private.assert_key_live(p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 if not exists(select 1 from public.al_api_keys k where k.token_hash=p_hash and k.revoked_at is null and (k.expires_at is null or k.expires_at>now())) then raise exception 'INVALID_API_KEY';end if;
end $$;
revoke all on function al_private.assert_key_live(text) from public,anon,authenticated;
grant execute on function al_private.assert_key_live(text) to service_role;
-- Harden all current key entry points, including cached idempotency responses and foundation delegation.
do $$declare sig text;src text;begin
 foreach sig in array array['public.al_api_dispatch(text,text,jsonb,text)','al_private.api_execute(text,text,jsonb)','al_private.api_execute_foundation(text,text,jsonb)'] loop
  src:=pg_get_functiondef(sig::regprocedure);
  src:=regexp_replace(src,'\mbegin\M',E'begin\n perform al_private.assert_key_live(p_hash);','i');
  execute src;
 end loop;
 src:=pg_get_functiondef('al_private.flow_context(uuid,text,uuid,boolean)'::regprocedure);
 src:=replace(src,'if p_key_hash is not null then',E'if p_key_hash is not null then\n  perform al_private.assert_key_live(p_key_hash);');
 if position('assert_key_live(p_key_hash)' in src)=0 then raise exception 'KEY_GUARD_PATCH_FAILED';end if;
 execute src;
end $$;
-- Only successful calls update last-use metadata. Exceptions roll back the touch.
do $$declare sig text;src text;begin
 foreach sig in array array['public.al_api_dispatch(text,text,jsonb,text)','al_private.api_execute(text,text,jsonb)','al_private.api_execute_foundation(text,text,jsonb)'] loop
  src:=pg_get_functiondef(sig::regprocedure);
  src:=replace(src,'perform al_private.assert_key_live(p_hash);',E'perform al_private.assert_key_live(p_hash);\n update public.al_api_keys set last_used_at=now() where token_hash=p_hash and (last_used_at is null or last_used_at<now()-interval ''1 minute'');');execute src;
 end loop;
 src:=pg_get_functiondef('al_private.flow_context(uuid,text,uuid,boolean)'::regprocedure);
 src:=replace(src,'end if;return o;',E'end if;\n if p_key_hash is not null then update public.al_api_keys set last_used_at=now() where token_hash=p_key_hash and (last_used_at is null or last_used_at<now()-interval ''1 minute'');end if;return o;');
 if position('last_used_at' in src)=0 then raise exception 'KEY_USAGE_PATCH_FAILED';end if;execute src;
end $$;
create function public.al_manage_keys(p_actor uuid,p_org uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;k public.al_api_keys;n public.al_api_keys;expiry timestamptz;total int;new_id uuid;
begin
 o:=al_private.flow_context(p_actor,null,p_org,true);perform al_private.require_access(o,true);
 perform 1 from public.al_organizations where id=o for update;
 if p_action='list' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'prefix',prefix,'scopes',scopes,'expires_at',expires_at,'last_used_at',last_used_at,'revoked_at',revoked_at,'created_at',created_at) order by created_at desc) from (select * from public.al_api_keys where organization_id=o order by created_at desc limit 200)x),'[]');end if;
 if p_action='revoke_all' then
  update public.al_api_keys set revoked_at=now() where organization_id=o and revoked_at is null;get diagnostics total=row_count;
  perform al_private.audit(o,null,'api_key.all_revoked',jsonb_build_object('count',total));return jsonb_build_object('count',total);
 end if;
 if p_action='rotate' then
  select * into k from public.al_api_keys where id=(p_payload->>'id')::uuid and organization_id=o for update;
  if not found then raise exception 'KEY_NOT_FOUND';end if;
  if k.revoked_at is not null or (k.expires_at is not null and k.expires_at<=now()) then raise exception 'KEY_NOT_ACTIVE';end if;
  expiry:=k.expires_at;
 elsif p_action='create' then
  expiry:=(p_payload->>'expiresAt')::timestamptz;
  if expiry is not null and (expiry<=now() or expiry>now()+interval '366 days') then raise exception 'INVALID_KEY_EXPIRY';end if;
 else raise exception 'UNKNOWN_ACTION';end if;
 -- Reuse existing validation and issuer. Rotation inherits permissions and expiry, never caller roles/scopes.
 new_id:=public.al_issue_api_key(o,case when p_action='rotate' then k.name else p_payload->>'name' end,p_payload->>'prefix',p_payload->>'tokenHash',case when p_action='rotate' then k.scopes else array(select jsonb_array_elements_text(p_payload->'scopes')) end);
 update public.al_api_keys set expires_at=expiry where id=new_id returning * into n;
 if p_action='rotate' then
  update public.al_api_keys set revoked_at=now() where id=k.id;
  perform al_private.audit(o,null,'api_key.rotated',jsonb_build_object('previous_id',k.id,'id',n.id));
 end if;
 return jsonb_build_object('id',n.id,'prefix',n.prefix,'expiresAt',expiry);
end $$;
revoke all on function public.al_manage_keys(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.al_manage_keys(uuid,uuid,text,jsonb) to service_role;

create table al_private.commercial_preferences(organization_id uuid primary key references public.al_organizations(id),plan text check(plan in ('start','team','api')),revision int not null default 1,updated_at timestamptz not null default now(),updated_by uuid not null references auth.users(id));
alter table al_private.commercial_preferences enable row level security;
create policy deny_client_access on al_private.commercial_preferences as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on al_private.commercial_preferences from public,anon,authenticated;
create function public.al_plan_preference(p_actor uuid,p_org uuid,p_save boolean default false,p_plan text default null,p_revision int default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;r al_private.commercial_preferences;admin boolean;
begin
 o:=al_private.flow_context(p_actor,null,p_org,false);
 select exists(select 1 from public.al_memberships where organization_id=o and user_id=p_actor and active and role in ('owner','admin')) into admin;
 if p_save then
  perform al_private.require_access(o,true);perform 1 from public.al_organizations where id=o for update;
  if p_plan is not null and p_plan not in ('start','team','api') then raise exception 'INVALID_PLAN';end if;
  select * into r from al_private.commercial_preferences where organization_id=o;
  if p_revision is null or p_revision<>coalesce(r.revision,0) then raise exception 'VERSION_CONFLICT';end if;
  insert into al_private.commercial_preferences(organization_id,plan,updated_by) values(o,p_plan,p_actor) on conflict(organization_id) do update set plan=excluded.plan,updated_by=excluded.updated_by,updated_at=now(),revision=al_private.commercial_preferences.revision+1 returning * into r;
  perform al_private.audit(o,null,'plan.preference_saved',jsonb_build_object('plan',p_plan));
 else select * into r from al_private.commercial_preferences where organization_id=o;end if;
 return jsonb_build_object('plan',r.plan,'revision',coalesce(r.revision,0),'canManage',admin,'updatedAt',r.updated_at);
end $$;
revoke all on function public.al_plan_preference(uuid,uuid,boolean,text,int) from public,anon,authenticated;
grant execute on function public.al_plan_preference(uuid,uuid,boolean,text,int) to service_role;

create function public.al_rotate_webhook(p_actor uuid,p_org uuid,p_id uuid,p_secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;w public.al_webhook_endpoints;
begin
 o:=al_private.flow_context(p_actor,null,p_org,true);perform al_private.require_access(o,true);
 select * into w from public.al_webhook_endpoints where organization_id=o and id=p_id for update;
 if not found then raise exception 'WEBHOOK_NOT_FOUND';end if;
 if w.active then raise exception 'WEBHOOK_MUST_BE_DISABLED';end if;
 if exists(select 1 from al_private.signing_outbox where organization_id=o and kind='webhook' and payload->>'endpointId'=w.id::text and status in ('pending','running','reconcile')) then raise exception 'WEBHOOK_DELIVERIES_PENDING';end if;
 if p_secret!~'^[a-f0-9]{64}$' then raise exception 'INVALID_WEBHOOK_CONFIGURATION';end if;
 update al_private.webhook_secrets set secret=p_secret where endpoint_id=w.id;
 if not found then raise exception 'WEBHOOK_NOT_FOUND';end if;
 perform al_private.audit(o,null,'webhook.secret_rotated',jsonb_build_object('endpoint_id',w.id));return jsonb_build_object('id',w.id,'rotated',true);
end $$;
revoke all on function public.al_rotate_webhook(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.al_rotate_webhook(uuid,uuid,uuid,text) to service_role;

create table al_private.legal_documents(version text primary key,kind text not null check(kind='account_terms'),html text not null,sha256 text not null check(sha256=encode(pg_catalog.sha256(convert_to(html,'UTF8')),'hex')),published_at timestamptz not null default now());
create table al_private.legal_acceptances(user_id uuid not null references auth.users(id),version text not null references al_private.legal_documents(version),document_hash text not null,accepted_at timestamptz not null default now(),primary key(user_id,version));
create function al_private.immutable_legal_evidence() returns trigger language plpgsql set search_path='' as $$begin raise exception 'IMMUTABLE_LEGAL_EVIDENCE';end $$;
create trigger immutable_legal_document before update or delete on al_private.legal_documents for each row execute function al_private.immutable_legal_evidence();
create trigger immutable_legal_acceptance before update or delete on al_private.legal_acceptances for each row execute function al_private.immutable_legal_evidence();
alter table al_private.legal_documents enable row level security;
alter table al_private.legal_acceptances enable row level security;
create policy deny_client_access on al_private.legal_documents as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client_access on al_private.legal_acceptances as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on al_private.legal_documents,al_private.legal_acceptances from public,anon,authenticated;
revoke all on function al_private.immutable_legal_evidence() from public,anon,authenticated;
insert into al_private.legal_documents(version,kind,html,sha256) values('2026-11-16.2','account_terms',$snapshot$<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Avtalslänk – kontovillkor 2026-11-16.2</title><style>body{max-width:850px;margin:40px auto;padding:0 20px;font:16px/1.65 Arial;color:#202727}h2{margin-top:32px}</style><p>Trafexa Nordic AB · 556855-4884 · Version 2026-11-16.2</p><p class="public-lead">Villkor för företagskonton och användning av Avtalslänk. Version 2026-11-16.2.</p><h2>1. Parter och omfattning</h2><p>Avtalslänk tillhandahålls av Trafexa Nordic AB, 556855-4884. Kontot är avsett för dig som företräder ett företag eller en organisation. Du ska vara behörig att skapa konto och hantera uppgifter för organisationen.</p><h2>2. Vad kontot ger tillgång till</h2><p>Du kan förbereda utkast, dokument, mottagare, kontakter och mallar samt hantera team och API-inställningar. Tillgång till en funktion eller signeringsmetod avgörs av företagets anslutning och visas i arbetsytan. Ett utkast eller en händelse i arbetsytan är inte en genomförd underskrift.</p><h2>3. Pris och abonnemang</h2><p>Registrering och val av planintresse startar inget betalt abonnemang, ingen bindningstid och ingen automatisk debitering. Pris, omfattning, avtalsperiod och uppsägningstid fastställs i en separat beställning som behöver godkännas innan betalning startar. Ingen registrering övergår automatiskt till en betalplan.</p><h2>4. Ditt ansvar</h2><p>Skydda inloggning och API-nycklar och ge kollegor lämplig behörighet. Använd endast material som du får behandla och dela. Du ansvarar för avtalstext, mottagare och valet av lämplig signeringsmetod när signering blir tillgänglig. Tjänsten ersätter inte din egen bedömning av avtalsinnehåll eller juridiska krav.</p><h2>5. Tillåten användning</h2><p>Tjänsten får inte användas för bedrägeri, olagligt innehåll, skräppost, skadlig kod, intrång eller kringgående av behörigheter. Stör inte andras användning eller försök komma åt andra företags uppgifter. Känsliga personuppgifter får inte behandlas utan att användningen omfattas av ett uttryckligt avtal och lämpliga skyddsåtgärder.</p><h2>6. Personuppgifter och dokument</h2><p>Du ska ha rättslig grund och informera berörda personer innan du lägger in deras uppgifter. <a href="/integritet">Integritetspolicyn</a> beskriver kontobehandlingen. Behandling av kundens dokument förutsätter ett personuppgiftsbiträdesavtal och fastställda drift-, bevarande- och raderingsvillkor.</p><h2>7. Tillgänglighet och ändringar</h2><p>Tjänsten kan vara otillgänglig vid underhåll, fel eller leverantörsstörningar. Någon avtalad tillgänglighetsnivå eller garanterad supporttid ingår inte i detta kontoflöde. Vi kan ändra funktioner och rätta fel. Väsentligt ändrade kontovillkor ska presenteras innan de börjar tillämpas.</p><h2>8. Avslut och begränsning</h2><p>Begär kontoavslut genom info@trafexa.com. Hämta material som du behöver innan avslut. Ett lämnat medlemskap är inte samma sak som radering. Den sista ägaren behöver ordna fortsatt ägarskap eller kontakta oss. Vi kan begränsa åtkomst vid konkret misstanke om intrång, missbruk eller olaglig användning och utreder då vad som behöver göras.</p><h2>9. Rättigheter och ansvar</h2><p>Du behåller dina rättigheter till uppladdat material. Trafexa får hantera materialet i den omfattning som behövs för tjänsten enligt dessa villkor och dina instruktioner. Trafexas rättigheter till tjänstens programvara och utformning övergår inte genom registrering. Ansvar bedöms enligt tillämplig svensk rätt; dessa villkor begränsar inte ansvar som inte får begränsas enligt lag.</p><h2>10. Kontakt och tillämplig rätt</h2><p>Frågor och reklamationer skickas till info@trafexa.com. Svensk rätt gäller. En tvist som inte kan lösas mellan parterna prövas av behörig svensk allmän domstol.</p></html>$snapshot$,'a866f2eb3f0ae8a3ae7765efac8a56e705763f56c38c042874de9613e6f390cf');
create function public.al_legal_account(p_actor uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare d al_private.legal_documents;a al_private.legal_acceptances;u auth.users;history jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select * into u from auth.users where id=p_actor;if not found then raise exception 'AUTH_REQUIRED';end if;
 select * into d from al_private.legal_documents where version='2026-11-16.2';
 if p_action='accept' then
  if u.email_confirmed_at is null then raise exception 'EMAIL_VERIFICATION_REQUIRED';end if;
  if p_payload->'accepted' is distinct from 'true'::jsonb then raise exception 'TERMS_REQUIRED';end if;
  if p_payload->>'version' is distinct from d.version or p_payload->>'sha256' is distinct from d.sha256 then raise exception 'LEGAL_VERSION_CHANGED';end if;
  insert into al_private.legal_acceptances(user_id,version,document_hash) values(p_actor,d.version,d.sha256) on conflict(user_id,version) do nothing;
 elsif p_action<>'read' then raise exception 'UNKNOWN_ACTION';end if;
 select * into a from al_private.legal_acceptances where user_id=p_actor and version=d.version;
 select coalesce(jsonb_agg(jsonb_build_object('version',x.version,'sha256',x.document_hash,'acceptedAt',x.accepted_at) order by x.accepted_at desc),'[]') into history from al_private.legal_acceptances x where x.user_id=p_actor;
 return jsonb_build_object('document',jsonb_build_object('version',d.version,'sha256',d.sha256,'url','/legal/'||d.version||'/villkor.html'),'accepted',a.user_id is not null,'acceptedAt',a.accepted_at,'history',history);
end $$;
revoke all on function public.al_legal_account(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.al_legal_account(uuid,text,jsonb) to service_role;
