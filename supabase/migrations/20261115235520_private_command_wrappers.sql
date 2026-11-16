-- Keep privileged implementations outside the exposed API schema. Public RPCs
-- are invoker wrappers; implementations still enforce membership and role.
grant usage on schema al_private to authenticated, service_role;
do $$
declare f record; args text; v text;
begin
 for f in select p.oid,p.proname,p.pronargs,p.provolatile,
   pg_get_function_arguments(p.oid) declaration,
   pg_get_function_identity_arguments(p.oid) identity_args,
   pg_get_function_result(p.oid) result_type
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'al_%' and p.prosecdef
 and has_function_privilege('authenticated',p.oid,'EXECUTE')
 loop
  select coalesce(string_agg('$'||i,',' order by i),'') into args from generate_series(1,f.pronargs) i;
  v:=case f.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end;
  execute format('alter function public.%I(%s) set schema al_private',f.proname,f.identity_args);
  execute format('create function public.%I(%s) returns %s language sql %s security invoker set search_path='''' as %L',f.proname,f.declaration,f.result_type,v,format('select al_private.%I(%s)',f.proname,args));
  execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
  execute format('revoke all on function al_private.%I(%s) from public,anon',f.proname,f.identity_args);
  execute format('grant execute on function public.%I(%s) to authenticated,service_role',f.proname,f.identity_args);
  execute format('grant execute on function al_private.%I(%s) to authenticated,service_role',f.proname,f.identity_args);
 end loop;
end $$;
