-- Descriptive signup intent is private; it never authorizes existing-tenant membership.
alter table public.al_organizations add column kind text not null default 'company' check(kind in ('company','personal'));
create unique index al_company_registration_unique on public.al_organizations((regexp_replace(registration_number,'[- ]','','g'))) where kind='company' and registration_number is not null;
create table al_private.registration_drafts(user_id uuid primary key references auth.users(id) on delete cascade deferrable initially deferred,payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=4096),created_at timestamptz not null default now());
create table al_private.account_profiles(user_id uuid primary key references auth.users(id) on delete cascade,kind text not null check(kind in ('company','personal')),full_name text not null,personal_number text,company_email text,phone text,organization_id uuid not null references public.al_organizations(id),created_at timestamptz not null default now(),check((kind='personal' and personal_number is not null) or(kind='company' and personal_number is null)));
alter table al_private.registration_drafts enable row level security;
alter table al_private.account_profiles enable row level security;
create policy deny_client_access on al_private.registration_drafts as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client_access on al_private.account_profiles as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on al_private.registration_drafts,al_private.account_profiles from public,anon,authenticated;
create function al_private.validate_registration(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n text;total int:=0;v int;i int;k text:=p->>'kind';
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096 or k is null or k not in ('company','personal') or jsonb_typeof(p->'fullName') is distinct from 'string' or length(trim(coalesce(p->>'fullName',''))) not between 2 and 120 or coalesce(p->>'fullName','') ~ '[[:cntrl:]]' or length(coalesce(p->>'phone',''))>40 then raise exception 'INVALID_REGISTRATION';end if;
 if k='personal' then
  n:=regexp_replace(coalesce(p->>'personalNumber',''),'[- +]','','g');if not al_private.valid_personal_number(n) then raise exception 'INVALID_REGISTRATION';end if;
  return jsonb_build_object('kind',k,'fullName',trim(p->>'fullName'),'personalNumber',n,'phone',p->>'phone');
 end if;
 if p->>'existingOrganizationId' is not null and p->>'existingOrganizationId'<>'' then
  perform (p->>'existingOrganizationId')::uuid;return jsonb_build_object('kind',k,'fullName',trim(p->>'fullName'),'phone',p->>'phone','existingOrganizationId',p->>'existingOrganizationId');
 end if;
 n:=regexp_replace(coalesce(p->>'registrationNumber',''),'[- ]','','g');
 if jsonb_typeof(p->'companyName') is distinct from 'string' or n !~ '^[0-9]{10}$' or length(trim(coalesce(p->>'companyName',''))) not between 2 and 120 or length(coalesce(p->>'companyEmail',''))>254 or (coalesce(p->>'companyEmail','')<>'' and p->>'companyEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_REGISTRATION';end if;
 for i in 1..10 loop v:=substring(n,i,1)::int*case when i%2=1 then 2 else 1 end;total:=total+v/10+v%10;end loop;
 if total%10<>0 then raise exception 'INVALID_REGISTRATION';end if;
 return jsonb_build_object('kind',k,'fullName',trim(p->>'fullName'),'companyName',trim(p->>'companyName'),'registrationNumber',n,'companyEmail',nullif(p->>'companyEmail',''),'phone',p->>'phone');
end $$;
revoke all on function al_private.validate_registration(jsonb) from public,anon,authenticated;
create function al_private.capture_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare p jsonb;
begin
 if coalesce(new.raw_user_meta_data,'{}'::jsonb) ? 'registration' then
  p:=al_private.validate_registration(new.raw_user_meta_data->'registration');
  -- Never carry personal number or signup draft in user_metadata/JWTs.
  insert into al_private.registration_drafts(user_id,payload) values(new.id,p);
  new.raw_user_meta_data:=new.raw_user_meta_data-'registration';
 end if;return new;
end $$;
revoke all on function al_private.capture_registration() from public,anon,authenticated;
create trigger al_capture_registration before insert on auth.users for each row execute function al_private.capture_registration();
create function public.al_registration(p_actor uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users;r al_private.account_profiles;p jsonb;o uuid;registered boolean;draft boolean;
begin
 if auth.role()<>'service_role' or p_actor is null then raise exception 'AUTH_REQUIRED';end if;
 select * into u from auth.users where id=p_actor for update;if not found then raise exception 'AUTH_REQUIRED';end if;
 select * into r from al_private.account_profiles where user_id=p_actor;registered:=found;
 select exists(select 1 from al_private.registration_drafts where user_id=p_actor) into draft;
 if p_action='read' then return jsonb_build_object('profile',case when registered then jsonb_build_object('kind',r.kind,'fullName',r.full_name,'organizationId',r.organization_id,'email',u.email,'companyEmail',r.company_email,'phone',r.phone,'personalNumberMasked',case when r.personal_number is null then null else '********'||right(r.personal_number,4) end) else null end,'hasDraft',draft,'emailVerified',u.email_confirmed_at is not null);end if;
 if p_action<>'complete' then raise exception 'INVALID_BODY';end if;
 if u.email_confirmed_at is null then raise exception 'EMAIL_VERIFICATION_REQUIRED';end if;
 if registered then return jsonb_build_object('kind',r.kind,'fullName',r.full_name,'organizationId',r.organization_id,'email',u.email);end if;
 if p_payload='{}'::jsonb then select payload into p from al_private.registration_drafts where user_id=p_actor;else p:=p_payload;end if;
 p:=al_private.validate_registration(p);
 -- An accepted invitation may already establish membership; link the profile without granting a new role.
 if p->>'kind'='company' and p->>'existingOrganizationId' is null then
  select x.id into o from public.al_organizations x join public.al_memberships m on m.organization_id=x.id where m.user_id=p_actor and m.active and x.kind='company' and regexp_replace(x.registration_number,'[- ]','','g')=p->>'registrationNumber';
  if found then p:=p||jsonb_build_object('existingOrganizationId',o);end if;
 end if;
 if p->>'existingOrganizationId' is not null then
  o:=(p->>'existingOrganizationId')::uuid;
  if not exists(select 1 from public.al_memberships m join public.al_organizations x on x.id=m.organization_id where m.user_id=p_actor and m.organization_id=o and m.active and x.kind='company') then raise exception 'ACCESS_DENIED';end if;
 else
  if p->>'kind'='company' then
   perform pg_advisory_xact_lock(hashtextextended('avtalslank-company:'||(p->>'registrationNumber'),0));
   if exists(select 1 from public.al_organizations where kind='company' and regexp_replace(registration_number,'[- ]','','g')=p->>'registrationNumber') then raise exception 'COMPANY_ALREADY_REGISTERED';end if;
  end if;
  insert into public.al_organizations(name,registration_number,kind) values(case when p->>'kind'='company' then p->>'companyName' else p->>'fullName' end,p->>'registrationNumber',p->>'kind') returning id into o;
  insert into public.al_memberships(organization_id,user_id,role,active) values(o,p_actor,'owner',true);
  insert into public.al_billing_accounts(organization_id) values(o);
 end if;
 insert into al_private.account_profiles(user_id,kind,full_name,personal_number,company_email,phone,organization_id) values(p_actor,p->>'kind',p->>'fullName',p->>'personalNumber',coalesce(p->>'companyEmail',u.email),p->>'phone',o);
 delete from al_private.registration_drafts where user_id=p_actor;
 insert into public.al_events(organization_id,kind,actor_id,metadata) values(o,'account.registration_completed',p_actor,jsonb_build_object('kind',p->>'kind'));
 return jsonb_build_object('kind',p->>'kind','fullName',p->>'fullName','organizationId',o,'email',u.email);
end $$;
revoke all on function public.al_registration(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.al_registration(uuid,text,jsonb) to service_role;
-- Personal workspaces are not shared company teams.
do $$declare src text;begin
 select pg_get_functiondef('public.al_team_command(uuid,uuid,text,jsonb)'::regprocedure) into src;
 if position('if p_action=''create'' then' in src)=0 then raise exception 'PERSONAL_TEAM_GUARD_PATCH_FAILED';end if;
 src:=replace(src,'if p_action=''create'' then','if p_action=''create'' then if exists(select 1 from public.al_organizations where id=o and kind=''personal'') then raise exception ''COMPANY_ACCOUNT_REQUIRED'';end if;');execute src;
end $$;


insert into al_private.legal_documents(version,kind,html,sha256) values('2026-11-17','account_terms',$snapshot$<!doctype html><html lang="sv"><meta charset="utf-8"><title>Kontovillkor 2026-11-17</title><body><p class="public-lead">Villkor för företags- och privatkonton och användning av Avtalslänk. Version <!-- -->2026-11-17<!-- -->.</p><h2>1. Parter och omfattning</h2><p>Avtalslänk tillhandahålls av Trafexa Nordic AB, 556855-4884. Kontot kan registreras av en privatperson eller av någon som företräder ett företag eller en organisation. Företräder du en organisation ska du vara behörig att skapa konto och hantera dess uppgifter.</p><h2>2. Vad kontot ger tillgång till</h2><p>Du kan förbereda utkast, dokument, mottagare, kontakter och mallar samt hantera team och API-inställningar. Tillgång till en funktion eller signeringsmetod avgörs av kontots eller företagets anslutning och visas i arbetsytan. Ett utkast eller en händelse i arbetsytan är inte en genomförd underskrift.</p><h2>3. Pris och abonnemang</h2><p>Registrering och val av planintresse startar inget betalt abonnemang, ingen bindningstid och ingen automatisk debitering. Pris, omfattning, avtalsperiod och uppsägningstid fastställs i en separat beställning som behöver godkännas innan betalning startar. Ingen registrering övergår automatiskt till en betalplan.</p><h2>4. Ditt ansvar</h2><p>Skydda inloggning och API-nycklar och ge kollegor lämplig behörighet. Använd endast material som du får behandla och dela. Du ansvarar för avtalstext, mottagare och valet av lämplig signeringsmetod när signering blir tillgänglig. Tjänsten ersätter inte din egen bedömning av avtalsinnehåll eller juridiska krav.</p><h2>5. Tillåten användning</h2><p>Tjänsten får inte användas för bedrägeri, olagligt innehåll, skräppost, skadlig kod, intrång eller kringgående av behörigheter. Stör inte andras användning eller försök komma åt andra företags uppgifter. Känsliga personuppgifter får inte behandlas utan att användningen omfattas av ett uttryckligt avtal och lämpliga skyddsåtgärder.</p><h2>6. Personuppgifter och dokument</h2><p>Du ska ha rättslig grund och informera berörda personer innan du lägger in deras uppgifter. <a href="/integritet">Integritetspolicyn</a> beskriver kontobehandlingen. Behandling av kundens dokument förutsätter ett personuppgiftsbiträdesavtal och fastställda drift-, bevarande- och raderingsvillkor.</p><h2>7. Tillgänglighet och ändringar</h2><p>Tjänsten kan vara otillgänglig vid underhåll, fel eller leverantörsstörningar. Någon avtalad tillgänglighetsnivå eller garanterad supporttid ingår inte i detta kontoflöde. Vi kan ändra funktioner och rätta fel. Väsentligt ändrade kontovillkor ska presenteras innan de börjar tillämpas.</p><h2>8. Avslut och begränsning</h2><p>Begär kontoavslut genom info@trafexa.com. Hämta material som du behöver innan avslut. Ett lämnat medlemskap är inte samma sak som radering. Den sista ägaren behöver ordna fortsatt ägarskap eller kontakta oss. Vi kan begränsa åtkomst vid konkret misstanke om intrång, missbruk eller olaglig användning och utreder då vad som behöver göras.</p><h2>9. Rättigheter och ansvar</h2><p>Du behåller dina rättigheter till uppladdat material. Trafexa får hantera materialet i den omfattning som behövs för tjänsten enligt dessa villkor och dina instruktioner. Trafexas rättigheter till tjänstens programvara och utformning övergår inte genom registrering. Ansvar bedöms enligt tillämplig svensk rätt; dessa villkor begränsar inte ansvar som inte får begränsas enligt lag.</p><h2>10. Kontakt och tillämplig rätt</h2><p>Frågor och reklamationer skickas till info@trafexa.com. Svensk rätt gäller. En tvist som inte kan lösas mellan parterna prövas av behörig svensk allmän domstol.</p></body></html>$snapshot$,'b235b6f55b661f9de3fe80ea17ead4afd2927e87a710040fa3fc99a3596c817f');
do $$declare src text;begin select pg_get_functiondef('public.al_legal_account(uuid,text,jsonb)'::regprocedure) into src;src:=replace(src,'2026-11-16.2','2026-11-17');execute src;end $$;
