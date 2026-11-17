alter table al_private.document_tariffs alter column organization_id drop not null;
create unique index global_document_tariff_version on al_private.document_tariffs(version) where organization_id is null;
do $$declare src text;begin
src:=pg_get_functiondef('public.al_admin_document_tariff(uuid,jsonb)'::regprocedure);
src:=replace(src,'perform 1 from public.al_organizations where id=p_org for update;if not found then raise exception ''NOT_FOUND'';end if;','if p_org is null then perform pg_advisory_xact_lock(hashtextextended(''al-document-default'',0));else perform 1 from public.al_organizations where id=p_org for update;if not found then raise exception ''NOT_FOUND'';end if;end if;');
src:=replace(src,'where organization_id=p_org order by version','where organization_id is not distinct from p_org order by version');execute src;
src:=pg_get_functiondef('al_private.document_quote(uuid,uuid)'::regprocedure);
src:=replace(src,'select * into t from al_private.document_tariffs where organization_id=p_org order by version desc limit 1 for share;','perform pg_advisory_xact_lock_shared(hashtextextended(''al-document-default'',0));select * into t from al_private.document_tariffs where organization_id=p_org or organization_id is null order by (organization_id is not null) desc,version desc limit 1 for share;');execute src;
end $$;
create function public.al_public_document_price() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('version',version,'documentOre',document_ore,'includedSigners',included_signers,'extraSignerOre',extra_signer_ore,'currency','SEK','taxBasis','excluding_vat') from al_private.document_tariffs where organization_id is null order by version desc limit 1$$;
revoke all on function public.al_public_document_price() from public;
grant execute on function public.al_public_document_price() to anon,authenticated;
