-- Controlled two-tenant smoke test. All synthetic records are rolled back.
begin;
insert into auth.users(id,email) values
 ('f8160001-0000-4000-8000-000000000001','avtalslank-smoke-a@example.invalid'),
 ('f8160002-0000-4000-8000-000000000002','avtalslank-smoke-b@example.invalid');
select set_config('request.jwt.claims','{"sub":"f8160001-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare o uuid;e jsonb;begin
 o:=public.al_create_organization('Avtalslänk smoke A');e:=public.al_save_draft(o,'Smoke-avtal A');
 perform public.al_add_recipient(o,(e->>'id')::uuid,'Testperson','signer@example.invalid','freja',1);
 perform set_config('al.smoke_org_a',o::text,true);perform set_config('al.smoke_envelope_a',e->>'id',true);
 if (select model from public.al_billing_accounts where organization_id=o)<>'unconfigured' then raise exception 'BILLING_UNEXPECTEDLY_CONFIGURED';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f8160002-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare o uuid;begin
 o:=public.al_create_organization('Avtalslänk smoke B');
 if exists(select 1 from public.al_envelopes where id=current_setting('al.smoke_envelope_a')::uuid) then raise exception 'CROSS_TENANT_READ';end if;
 begin
  perform public.al_save_draft(current_setting('al.smoke_org_a')::uuid,'Otillåtet');
  raise exception 'CROSS_TENANT_WRITE';
 exception when insufficient_privilege then null;end;
 begin
  update public.al_envelopes set status='completed';raise exception 'DIRECT_COMPLETION_ALLOWED';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
