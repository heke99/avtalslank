-- Isolated production role/entitlement checks. No provider calls; all data rolled back.
begin;
set local statement_timeout='15s';
insert into auth.users(id,email,email_confirmed_at) values
('f8200001-0000-4000-8000-000000000001','release-owner-a@example.invalid',now()),
('f8200002-0000-4000-8000-000000000002','release-owner-b@example.invalid',now()),
('f8200003-0000-4000-8000-000000000003','release-reader@example.invalid',now());
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200001-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $$declare o uuid;e jsonb;begin
 o:=public.al_create_organization('Isolated release A');e:=public.al_save_draft(o,'Release draft');
 perform set_config('al.release_org',o::text,true);perform set_config('al.release_envelope',e->>'id',true);
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200002-0000-4000-8000-000000000002"}',true);
do $$begin
 perform public.al_create_organization('Isolated release B');
 if exists(select 1 from public.al_envelopes where id=current_setting('al.release_envelope')::uuid) then raise exception 'TENANT_LEAK';end if;
 begin perform public.al_save_draft(current_setting('al.release_org')::uuid,'Forbidden');raise exception 'FOREIGN_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
 begin perform public.al_platform('list');raise exception 'ORDINARY_PLATFORM_ACCESS';exception when others then if sqlerrm<>'PLATFORM_ADMIN_REQUIRED' then raise;end if;end;
 begin perform public.al_api_payment_guard(repeat('e',64));raise exception 'SERVICE_RPC_EXPOSED';exception when insufficient_privilege then null;end;
 begin update public.al_envelopes set status='completed';raise exception 'DIRECT_STATUS_WRITE';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.al_memberships(organization_id,user_id,role,active) values(current_setting('al.release_org')::uuid,'f8200003-0000-4000-8000-000000000003','reader',true);
insert into al_private.platform_admins(user_id) values('f8200001-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200003-0000-4000-8000-000000000003"}',true);set local role authenticated;
do $$begin
 if not exists(select 1 from public.al_envelopes where id=current_setting('al.release_envelope')::uuid) then raise exception 'READER_CANNOT_READ';end if;
 begin perform public.al_save_draft(current_setting('al.release_org')::uuid,'Reader forbidden');raise exception 'READER_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200001-0000-4000-8000-000000000001","aal":"aal1"}',true);
do $$begin if jsonb_typeof(public.al_platform('list')) is distinct from 'array' then raise exception 'ADMIN_LIST_FAILED';end if;end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$declare o uuid:=current_setting('al.release_org')::uuid;k jsonb;begin
 k:=public.al_manage_keys('f8200001-0000-4000-8000-000000000001',o,'create',jsonb_build_object('name','Isolated release key','prefix','al_live_f820abcd','tokenHash',repeat('e',64),'scopes',jsonb_build_array('envelopes:read'),'expiresAt',now()+interval '10 minutes'));
 begin perform public.al_api_payment_guard(repeat('e',64));raise exception 'UNPAID_API_ALLOWED';exception when others then if sqlerrm<>'PAYMENT_REQUIRED' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200001-0000-4000-8000-000000000001","aal":"aal2"}',true);set local role authenticated;
do $$declare o uuid:=current_setting('al.release_org')::uuid;begin
 perform public.al_platform('record_payment',o,jsonb_build_object('model','subscription','reference','synthetic-release-rollback-only','paidUntil',now()+interval '1 hour','reason','Synthetic rollback access verification'));
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$begin perform public.al_api_payment_guard(repeat('e',64));end $$;
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200001-0000-4000-8000-000000000001","aal":"aal2"}',true);set local role authenticated;
do $$begin perform public.al_reverse_recorded_payment('synthetic-release-rollback-only','Synthetic rollback reversal verification');end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$begin begin perform public.al_api_payment_guard(repeat('e',64));raise exception 'REVERSED_API_ALLOWED';exception when others then if sqlerrm<>'PAYMENT_REQUIRED' then raise;end if;end;end $$;
reset role;
rollback;
select 'production_role_payment_smoke_passed_and_rolled_back' as result;
