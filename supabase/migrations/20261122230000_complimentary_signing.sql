create table al_private.complimentary_signing (
 organization_id uuid primary key references public.al_organizations(id)
);
alter table al_private.complimentary_signing enable row level security;
revoke all on al_private.complimentary_signing from public,anon,authenticated;
create policy deny_client_access on al_private.complimentary_signing as restrictive for all to anon,authenticated using(false) with check(false);

create function public.al_admin_complimentary_signing(
 p_org uuid,p_enabled boolean default null,p_reason text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=al_private.require_platform_admin(); current_value boolean;
begin
 if p_enabled is null then
  perform 1 from public.al_organizations where id=p_org;
 else
  perform pg_advisory_xact_lock_shared(hashtextextended('al-document-default',0));
  perform 1 from public.al_organizations where id=p_org for update;
 end if;
 if not found then raise exception 'NOT_FOUND';end if;
 select exists(select 1 from al_private.complimentary_signing where organization_id=p_org) into current_value;
 if p_enabled is null or p_enabled=current_value then return current_value;end if;
 if coalesce(length(trim(p_reason)),0) not between 10 and 500 then raise exception 'REASON_REQUIRED';end if;
 if p_enabled then insert into al_private.complimentary_signing values(p_org);
 else delete from al_private.complimentary_signing where organization_id=p_org;
 end if;
 insert into al_private.platform_audit(actor_id,organization_id,action,reason,metadata)
 values(actor,p_org,'document_signing.complimentary',trim(p_reason),jsonb_build_object('enabled',p_enabled));
 return p_enabled;
end $$;
revoke all on function public.al_admin_complimentary_signing(uuid,boolean,text) from public,anon;
grant execute on function public.al_admin_complimentary_signing(uuid,boolean,text) to authenticated;

-- Only the service entry points can set the verified human actor for this quote.
do $migration$
declare src text; patched text;
begin
 src:=pg_get_functiondef('public.al_document_quote(uuid,text,uuid,uuid)'::regprocedure);
 patched:=replace(src,'return al_private.document_quote(o,p_envelope);',
  'perform set_config(''al.complimentary_actor'',coalesce(case when p_key_hash is null then p_actor::text end,''''),true);return al_private.document_quote(o,p_envelope);');
 if patched=src then raise exception 'QUOTE_PATCH_FAILED';end if;
 execute patched;

 src:=pg_get_functiondef('public.al_flow_command(uuid,text,uuid,uuid,text,jsonb)'::regprocedure);
 patched:=replace(src,'q:=al_private.document_quote(o,p_envelope);',
  'perform set_config(''al.complimentary_actor'',coalesce(case when p_key_hash is null then p_actor::text end,''''),true);q:=al_private.document_quote(o,p_envelope);');
 patched:=replace(patched,'if q->>''hash'' is distinct from p_payload->>''priceHash'' then',
  'if not coalesce((q->>''complimentary'')::boolean,false) and q->>''hash'' is distinct from p_payload->>''priceHash'' then');
 if strpos(patched,'al.complimentary_actor')=0 or strpos(patched,'coalesce((q->>''complimentary'')')=0 then raise exception 'SEND_PATCH_FAILED';end if;
 execute patched;

 src:=pg_get_functiondef('al_private.document_quote(uuid,uuid)'::regprocedure);
 patched:=replace(src,'unit bigint;','unit bigint;complimentary boolean;');
 patched:=replace(patched,'perform pg_advisory_xact_lock_shared(hashtextextended(''al-document-default'',0));',
  'select exists(select 1 from al_private.complimentary_signing where organization_id=p_org) into complimentary;
   complimentary:=complimentary or exists(select 1 from al_private.platform_admins where active and user_id=nullif(current_setting(''al.complimentary_actor'',true),'''')::uuid);
   if not complimentary then perform pg_advisory_xact_lock_shared(hashtextextended(''al-document-default'',0));');
 patched:=replace(patched,'raise exception ''DOCUMENT_TARIFF_REQUIRED'';end if;',
  'raise exception ''DOCUMENT_TARIFF_REQUIRED'';end if;end if;');
 patched:=replace(patched,'unit:=t.document_ore+greatest(0,n-t.included_signers)*t.extra_signer_ore;',
  'unit:=case when complimentary then 0 else t.document_ore+greatest(0,n-t.included_signers)*t.extra_signer_ore end;');
 patched:=replace(patched,'return q||jsonb_build_object', 'if complimentary then q:=q||jsonb_build_object(''complimentary'',true);end if;return q||jsonb_build_object');
 if strpos(patched,'complimentary boolean')=0 or strpos(patched,'then 0 else t.document_ore')=0 then raise exception 'COMPLIMENTARY_QUOTE_PATCH_FAILED';end if;
 execute patched;

 src:=pg_get_functiondef('al_private.record_document_charges()'::regprocedure);
 patched:=replace(src,'new.price_quote is null then','new.price_quote is null or coalesce((new.price_quote->>''complimentary'')::boolean,false) then');
 if patched=src then raise exception 'CHARGE_PATCH_FAILED';end if;
 execute patched;
end
$migration$;
