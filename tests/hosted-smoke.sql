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
select set_config('request.jwt.claims','{"sub":"f8160001-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare o uuid:=current_setting('al.smoke_org_a')::uuid;e uuid:=current_setting('al.smoke_envelope_a')::uuid;r uuid;c jsonb;u jsonb;begin
 select id into r from public.al_recipients where envelope_id=e;
 perform public.al_edit_recipient(o,e,r,'Smoke redigerad','smoke-edit@example.invalid','bankid');
 perform public.al_reorder_recipients(o,e,array[r]);
 c:=public.al_save_contact(o,'Smoke kontakt','SMOKE@example.invalid','Test');
 if c->>'email'<>'smoke@example.invalid' then raise exception 'CONTACT_NORMALIZATION';end if;
 perform public.al_save_contact(o,'Smoke arkiverad','smoke@example.invalid','Test',(c->>'id')::uuid,1,true);
 perform public.al_update_organization(o,'Smoke uppdaterad','000000-0000');
 begin
  perform public.al_set_member_role(o,'f8160001-0000-4000-8000-000000000001','reader',true);
  raise exception 'OWNER_PROTECTION_MISSING';
 exception when others then if sqlerrm<>'LAST_OWNER' then raise;end if;end;
 u:=public.al_usage_summary(o,'2026-11-01','2026-12-01');
 if (u->>'billing_enabled')::boolean or u->>'billing_model'<>'unconfigured' then raise exception 'BILLING_CHANGED';end if;
 if jsonb_array_length(public.al_activity(o))<5 then raise exception 'AUDIT_MISSING';end if;
 perform public.al_duplicate_draft(o,e,'Smoke kopia');
 perform public.al_remove_recipient(o,e,r);
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare o uuid:=current_setting('al.smoke_org_a')::uuid;e uuid:=current_setting('al.smoke_envelope_a')::uuid;s jsonb;begin
 s:=public.al_flow_command('f8160001-0000-4000-8000-000000000001',null,o,e,'read');
 if s->'envelope'->>'id'<>e::text then raise exception 'CONNECTED_READ_FAILED';end if;
 s:=public.al_flow_command('f8160001-0000-4000-8000-000000000001',null,o,e,'fields',jsonb_build_object('generation',(s->'envelope'->>'generation')::int,'fields','[]'::jsonb));
 begin
  perform public.al_flow_command('f8160002-0000-4000-8000-000000000002',null,o,e,'read');raise exception 'CONNECTED_TENANT_LEAK';
 exception when others then if sqlerrm<>'ACCESS_DENIED' then raise;end if;end;
 begin
  perform public.al_flow_command('f8160001-0000-4000-8000-000000000001',null,o,e,'send',jsonb_build_object('generation',(s->>'generation')::int));raise exception 'UNCONFIGURED_SEND_ALLOWED';
 exception when others then if sqlerrm<>'SIGNING_METHOD_NOT_READY' then raise;end if;end;
 begin
  perform public.al_signer_command(repeat('0',64),'view');raise exception 'INVALID_LINK_ALLOWED';
 exception when others then if sqlerrm<>'INVALID_SIGNING_LINK' then raise;end if;end;
end $$;
reset role;
-- Team commands run as service only, with a confirmed email binding.
update auth.users set email_confirmed_at=now() where id in ('f8160001-0000-4000-8000-000000000001','f8160002-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare a uuid:='f8160001-0000-4000-8000-000000000001';b uuid:='f8160002-0000-4000-8000-000000000002';o uuid:=current_setting('al.smoke_org_a')::uuid;v jsonb;begin
 v:=public.al_team_command(a,o,'create',jsonb_build_object('email','avtalslank-smoke-b@example.invalid','role','reader','tokenHash',repeat('9',64)));
 begin
 perform public.al_team_command(a,null,'accept',jsonb_build_object('tokenHash',repeat('9',64)));raise exception 'WRONG_EMAIL_ALLOWED';
 exception when others then if sqlerrm<>'INVALID_INVITATION' then raise;end if;end;
 v:=public.al_team_command(b,null,'accept',jsonb_build_object('tokenHash',repeat('9',64)));
 if (v->>'organizationId')::uuid<>o then raise exception 'WRONG_ORGANIZATION';end if;
 v:=public.al_team_command(b,o,'leave');
 perform public.al_team_command(b,null,'accept',jsonb_build_object('tokenHash',repeat('9',64)));
 begin
 perform public.al_operational_status(b,null,o);raise exception 'RETRY_RESTORED_ACCESS';
 exception when others then if sqlerrm<>'ACCESS_DENIED' then raise;end if;end;
 begin
 perform public.al_team_command(a,o,'leave');raise exception 'LAST_OWNER_LEFT';
 exception when others then if sqlerrm<>'LAST_OWNER' then raise;end if;end;
 v:=public.al_operational_status(a,null,o);
 if not(v ?& array['workerFresh','methods','deliveries']) then raise exception 'STATUS_SHAPE';end if;
end $$;
reset role;
rollback;
