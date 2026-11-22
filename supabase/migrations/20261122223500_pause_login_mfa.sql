-- Launch policy: password sessions retain the same membership and role checks.
create or replace function al_private.al_can_access(p_org uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.al_memberships m
   where m.organization_id=p_org and m.user_id=al_private.actor() and m.active
     and (not p_write or m.role in ('owner','admin','sender'))
     and (auth.role()<>'service_role' or nullif(current_setting('al.organization',true),'')::uuid=p_org)
 )
$$;

create or replace function al_private.require_platform_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if auth.role()<>'authenticated' or u is null or not exists(
   select 1 from al_private.platform_admins where user_id=u and active
 ) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 return u;
end
$$;

-- Keep the current platform actions and pagination while removing the duplicate MFA gate.
do $migration$
declare
 src text:=pg_get_functiondef('public.al_platform(text,uuid,jsonb)'::regprocedure);
 gate constant text:=$gate$if claims->>'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;$gate$;
begin
 if strpos(src,gate)=0 then raise exception 'Unexpected al_platform definition';end if;
 execute replace(src,gate,'');
end
$migration$;
