-- Every price-dependent send uses the same lock order as tariff administration.
create function al_private.lock_document_price_context(p_org uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock_shared(hashtextextended('al-document-default',0));
 perform 1 from public.al_organizations where id=p_org for share;if not found then raise exception 'NOT_FOUND';end if;
end $$;
revoke all on function al_private.lock_document_price_context(uuid) from public,anon,authenticated;
do $$declare src text;sig text;begin
 foreach sig in array array['public.al_document_quote(uuid,text,uuid,uuid)','public.al_flow_command(uuid,text,uuid,uuid,text,jsonb)'] loop
 src:=pg_get_functiondef(sig::regprocedure);
 src:=replace(src,'perform 1 from public.al_envelopes where id=p_envelope and organization_id=o for update;','perform al_private.lock_document_price_context(o);perform 1 from public.al_envelopes where id=p_envelope and organization_id=o for update;');
 if position('lock_document_price_context(o)' in src)=0 then raise exception 'PRICE_LOCK_PATCH_FAILED';end if;execute src;
 end loop;
end $$;
-- A selected per-document offer creates the actual signing tariff in the same transaction.
alter table al_private.document_tariffs add column commercial_offer_id uuid references al_private.commercial_offers(id);
do $$declare src text;begin
 src:=pg_get_functiondef('public.al_platform_commercial(text,uuid,jsonb)'::regprocedure);
 src:=replace(src,'if (s->>''model''=''per_document''', 'if coalesce(s->>''includedSigners'',''1'') !~ ''^[0-9]{1,2}$'' or coalesce(s->>''extraSignerOre'',''0'') !~ ''^[0-9]{1,9}$'' then raise exception ''INVALID_PRICE'';end if; if coalesce((s->>''includedSigners'')::int,1) not between 1 and 50 or coalesce((s->>''extraSignerOre'')::bigint,0)>100000000 then raise exception ''INVALID_PRICE'';end if; if (s->>''model''=''per_document''');
 src:=replace(src,'''taxBasis'',''excluding_vat'');','''taxBasis'',''excluding_vat'',''includedSigners'',coalesce((s->>''includedSigners'')::int,1),''extraSignerOre'',coalesce((s->>''extraSignerOre'')::bigint,0));');
 src:=replace(src,'insert into al_private.organization_commercial(organization_id,offer_id)', 'if s->>''model'' in (''per_document'',''hybrid'') then insert into al_private.document_tariffs(organization_id,version,document_ore,included_signers,extra_signer_ore,commercial_offer_id) select p_org,coalesce(max(version),0)+1,(s->>''documentOre'')::bigint,coalesce((s->>''includedSigners'')::int,1),coalesce((s->>''extraSignerOre'')::bigint,0),offer from al_private.document_tariffs where organization_id=p_org;end if; insert into al_private.organization_commercial(organization_id,offer_id)');
 if position('commercial_offer_id' in src)=0 then raise exception 'OFFER_TARIFF_PATCH_FAILED';end if;execute src;
end $$;
create table al_private.payment_reversals(reference text primary key references al_private.payment_receipts(reference),reason text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
alter table al_private.payment_reversals enable row level security;
revoke all on al_private.payment_reversals from public,anon,authenticated;
create policy deny_client_access on al_private.payment_reversals as restrictive for all to anon,authenticated using(false) with check(false);
create trigger immutable_payment_reversal before update or delete on al_private.payment_reversals for each row execute function al_private.platform_audit_immutable();
-- Never let a replay of an earlier payment replace a later period.
do $$declare src text;begin
 src:=pg_get_functiondef('public.al_platform(text,uuid,jsonb)'::regprocedure);
 src:=replace(src,'new_role text;','new_role text;payment_existed boolean;');
 src:=replace(src,'insert into al_private.payment_receipts(reference,organization_id,paid_until,recorded_by)', 'if exists(select 1 from al_private.payment_reversals where reference=trim(p_payload->>''reference'')) then raise exception ''PAYMENT_REVERSED'';end if; select exists(select 1 from al_private.payment_receipts where reference=trim(p_payload->>''reference'')) into payment_existed;insert into al_private.payment_receipts(reference,organization_id,paid_until,recorded_by)');
 src:=replace(src,'payment_reference=excluded.payment_reference,updated_at=now();','payment_reference=excluded.payment_reference,updated_at=now() where api_entitlements.paid_until is null or api_entitlements.paid_until<=excluded.paid_until;');
 src:=replace(src,'insert into al_private.api_entitlements(organization_id,model,paid_until,payment_reference)', 'if payment_existed then return jsonb_build_object(''ok'',true,''replay'',true);end if; insert into al_private.api_entitlements(organization_id,model,paid_until,payment_reference)');
 if position('payment_existed boolean' in src)=0 then raise exception 'PAYMENT_REPLAY_PATCH_FAILED';end if;execute src;
end $$;
create function public.al_reverse_recorded_payment(p_reference text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=al_private.require_platform_admin();o uuid;begin
 if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'REASON_REQUIRED';end if;
 select organization_id into o from al_private.payment_receipts where reference=p_reference;if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from public.al_organizations where id=o for update;
 update al_private.api_entitlements set paid_until=least(paid_until,now()),updated_at=now() where organization_id=o and payment_reference=p_reference;
 insert into al_private.payment_reversals(reference,reason,actor_id) values(p_reference,p_reason,u) on conflict do nothing;
 insert into al_private.platform_audit(actor_id,organization_id,action,reason,metadata) values(u,o,'payment.reference_reversed',p_reason,jsonb_build_object('reference',p_reference));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.al_reverse_recorded_payment(text,text) from public,anon;
grant execute on function public.al_reverse_recorded_payment(text,text) to authenticated;
alter function al_private.assert_key_live(text) rename to assert_key_live_before_payment_receipt;
create function al_private.assert_key_live(p_hash text) returns void language plpgsql security definer set search_path='' as $$declare o uuid;begin
 select organization_id into o from public.al_api_keys where token_hash=p_hash;
 if o is not null then perform 1 from public.al_organizations where id=o for share;end if;
 perform al_private.assert_key_live_before_payment_receipt(p_hash);
 if not exists(select 1 from al_private.api_entitlements e join al_private.payment_receipts r on r.reference=e.payment_reference and r.organization_id=e.organization_id where e.organization_id=o and r.paid_until>now() and not exists(select 1 from al_private.payment_reversals x where x.reference=r.reference)) then raise exception 'PAYMENT_REQUIRED';end if;
end $$;
revoke all on function al_private.assert_key_live(text) from public,anon,authenticated;
grant execute on function al_private.assert_key_live(text) to service_role;
