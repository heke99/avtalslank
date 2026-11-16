-- Team lifecycle and operational controls; authenticated identities are resolved by Edge.
create table al_private.team_invitations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.al_organizations(id),
 email text not null check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 role text not null check(role in ('admin','sender','reader')), token_hash text unique not null check(token_hash~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days', revoked_at timestamptz, accepted_at timestamptz, accepted_by uuid references auth.users(id)
);
create unique index al_team_invitation_pending on al_private.team_invitations(organization_id,email) where revoked_at is null and accepted_at is null;
alter table al_private.team_invitations enable row level security;
create policy deny_client_access on al_private.team_invitations as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on al_private.team_invitations from public,anon,authenticated;
create function public.al_team_command(p_actor uuid,p_org uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;i al_private.team_invitations;m public.al_memberships;u auth.users;caller_role text;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 select * into u from auth.users where id=p_actor;
 if not found then raise exception 'AUTH_REQUIRED';end if;
 if p_action='accept' then
  select * into i from al_private.team_invitations where token_hash=p_payload->>'tokenHash';
  if not found then raise exception 'INVALID_INVITATION';end if;
  perform 1 from public.al_organizations where id=i.organization_id for update;
  select * into i from al_private.team_invitations where id=i.id for update;
  if i.revoked_at is not null or i.expires_at<=now() or lower(u.email)<>i.email or u.email_confirmed_at is null then raise exception 'INVALID_INVITATION';end if;
  if i.accepted_at is not null then
   if i.accepted_by=p_actor then return jsonb_build_object('organizationId',i.organization_id,'accepted',true);end if;
   raise exception 'INVALID_INVITATION';
  end if;
  if exists(select 1 from public.al_memberships where organization_id=i.organization_id and user_id=p_actor and active) then raise exception 'ALREADY_MEMBER';end if;
  insert into public.al_memberships(organization_id,user_id,role,active) values(i.organization_id,p_actor,i.role,true) on conflict(organization_id,user_id) do update set role=excluded.role,active=true;
  update al_private.team_invitations set accepted_at=now(),accepted_by=p_actor where id=i.id;
  insert into public.al_events(organization_id,kind,actor_id,metadata) values(i.organization_id,'team.invitation_accepted',p_actor,jsonb_build_object('invitation_id',i.id,'role',i.role));
  return jsonb_build_object('organizationId',i.organization_id,'accepted',true);
 end if;
 o:=al_private.flow_context(p_actor,null,p_org,false);
 perform 1 from public.al_organizations where id=o for update;
 select * into m from public.al_memberships where organization_id=o and user_id=p_actor and active;
 if not found then raise exception 'ACCESS_DENIED';end if;
 if p_action='leave' then
  if m.role='owner' and not exists(select 1 from public.al_memberships where organization_id=o and active and role='owner' and user_id<>p_actor) then raise exception 'LAST_OWNER';end if;
  update public.al_memberships set active=false where organization_id=o and user_id=p_actor;
  update public.al_api_keys set revoked_at=coalesce(revoked_at,now()) where organization_id=o and created_by=p_actor;
  insert into public.al_events(organization_id,kind,actor_id) values(o,'member.left',p_actor);
  return jsonb_build_object('left',true);
 end if;
 perform al_private.require_access(o,true);
 if p_action='list' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'created_at',created_at,'expires_at',expires_at,'revoked_at',revoked_at,'accepted_at',accepted_at) order by created_at desc) from (select * from al_private.team_invitations where organization_id=o order by created_at desc limit 200)t),'[]');end if;
 if p_action='create' then
  if p_payload->>'role'='admin' and m.role<>'owner' then raise exception 'OWNER_REQUIRED';end if;
  update al_private.team_invitations set revoked_at=now() where organization_id=o and expires_at<=now() and revoked_at is null and accepted_at is null;
  if (select count(*) from al_private.team_invitations where organization_id=o and revoked_at is null and accepted_at is null)>=100 then raise exception 'INVITATION_LIMIT';end if;
  if exists(select 1 from public.al_memberships x join auth.users a on a.id=x.user_id where x.organization_id=o and x.active and lower(a.email)=lower(trim(p_payload->>'email'))) then raise exception 'ALREADY_MEMBER';end if;
  insert into al_private.team_invitations(organization_id,email,role,token_hash,created_by) values(o,lower(trim(p_payload->>'email')),p_payload->>'role',p_payload->>'tokenHash',p_actor) returning * into i;
  perform al_private.audit(o,null,'team.invitation_created',jsonb_build_object('invitation_id',i.id,'role',i.role));
  return jsonb_build_object('id',i.id,'expiresAt',i.expires_at);
 end if;
 if p_action='revoke' then
  update al_private.team_invitations set revoked_at=coalesce(revoked_at,now()) where organization_id=o and id=(p_payload->>'id')::uuid and accepted_at is null returning * into i;
  if not found then raise exception 'INVITATION_NOT_FOUND';end if;
  perform al_private.audit(o,null,'team.invitation_revoked',jsonb_build_object('invitation_id',i.id));return jsonb_build_object('revoked',true);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.al_team_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.al_team_command(uuid,uuid,text,jsonb) to service_role;

create table al_private.signing_reminders (
 recipient_id uuid primary key references public.al_recipients(id), count int not null default 0 check(count between 0 and 3), last_queued_at timestamptz not null
);
alter table al_private.signing_reminders enable row level security;
create policy deny_client_access on al_private.signing_reminders as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on al_private.signing_reminders from public,anon,authenticated;
create function public.al_remind_signer(p_actor uuid,p_key_hash text,p_org uuid,p_envelope uuid,p_recipient uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;e public.al_envelopes;r public.al_recipients;l al_private.signing_links;counter al_private.signing_reminders;previous al_private.signing_outbox;
begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,true);
 select * into e from public.al_envelopes where id=p_envelope and organization_id=o for update;
 if not found then raise exception 'ENVELOPE_NOT_FOUND';end if;
 if e.status not in ('sent','in_progress') then raise exception 'DOCUMENT_LOCKED';end if;
 select * into r from public.al_recipients where id=p_recipient and envelope_id=e.id and organization_id=o;
 if not found or r.status<>'pending' then raise exception 'RECIPIENT_NOT_PENDING';end if;
 if e.sequential and exists(select 1 from public.al_recipients where envelope_id=e.id and position<r.position and status<>'signed') then raise exception 'WAITING_FOR_PREVIOUS_RECIPIENT';end if;
 select * into l from al_private.signing_links where recipient_id=r.id and envelope_id=e.id and consumed_at is null and revoked_at is null and expires_at>now();
 if not found then raise exception 'INVALID_SIGNING_LINK';end if;
 select * into previous from al_private.signing_outbox where envelope_id=e.id and kind='invitation' and payload->>'recipientId'=r.id::text order by created_at desc limit 1;
 if previous.status='reconcile' then raise exception 'DELIVERY_RECONCILIATION_REQUIRED';end if;
 if previous.status is distinct from 'accepted' then raise exception 'DELIVERY_PENDING';end if;
 select * into counter from al_private.signing_reminders where recipient_id=r.id for update;
 if found and counter.count>=3 then raise exception 'REMINDER_LIMIT';end if;
 if previous.created_at>now()-interval '30 minutes' or (counter.last_queued_at is not null and counter.last_queued_at>now()-interval '30 minutes') then raise exception 'REMINDER_COOLDOWN';end if;
 insert into al_private.signing_reminders(recipient_id,count,last_queued_at) values(r.id,1,now()) on conflict(recipient_id) do update set count=al_private.signing_reminders.count+1,last_queued_at=now() returning * into counter;
 insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) values(o,e.id,'invitation','reminder:'||r.id||':'||counter.count,jsonb_build_object('linkId',l.id,'recipientId',r.id,'reminder',true));
 perform al_private.audit(o,e.id,'recipient.reminder_queued',jsonb_build_object('recipient_id',r.id,'number',counter.count));return jsonb_build_object('queued',true,'count',counter.count);
end $$;
revoke all on function public.al_remind_signer(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.al_remind_signer(uuid,text,uuid,uuid,uuid) to service_role;
create function public.al_operational_status(p_actor uuid,p_key_hash text,p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,false);
 return jsonb_build_object('workerFresh',exists(select 1 from al_private.signing_worker where id='main' and ready and heartbeat_at>now()-interval '2 minutes'),
 'methods',public.al_capabilities(),'deliveries',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from al_private.signing_outbox where organization_id=o group by status)x),'{}'::jsonb));
end $$;
revoke all on function public.al_operational_status(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.al_operational_status(uuid,text,uuid) to service_role;

-- Enrolled users must step up: direct PostgREST and Storage are not a bypass.
create or replace function al_private.al_can_access(p_org uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.al_memberships m where m.organization_id=p_org and m.user_id=al_private.actor() and m.active
 and (not p_write or m.role in ('owner','admin','sender'))
 and (auth.role()<>'service_role' or nullif(current_setting('al.organization',true),'')::uuid=p_org))
 and (auth.role()='service_role' or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2'
 or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'))
$$;
