-- Contact import acceptance: controlled two-tenant transaction, no external effects.
begin;
insert into auth.users(id,email) values('f8180001-0000-4000-8000-000000000001','avtalslank-import-a@example.invalid'),('f8180002-0000-4000-8000-000000000002','avtalslank-import-b@example.invalid');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8180001-0000-4000-8000-000000000001"}',true);set local role authenticated;
do $$declare o uuid;begin o:=public.al_create_organization('Import smoke A');perform set_config('al.import_org',o::text,true);end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$declare a uuid:='f8180001-0000-4000-8000-000000000001';b uuid:='f8180002-0000-4000-8000-000000000002';o uuid:=current_setting('al.import_org')::uuid;r uuid:=gen_random_uuid();v jsonb;begin
 v:=public.al_contact_import(a,null,o,r,'[{"name":"Import smoke","email":"smoke-import@example.invalid","company":"Test"}]');
 if (v->>'created')::int<>1 then raise exception 'IMPORT_MISSING';end if;
 if public.al_contact_import(a,null,o,r,'[{"name":"Import smoke","email":"smoke-import@example.invalid","company":"Test"}]') is distinct from v then raise exception 'REPLAY_CHANGED';end if;
 begin perform public.al_contact_import(a,null,o,r,'[{"name":"Changed","email":"changed-smoke@example.invalid"}]');raise exception 'CONFLICT_ALLOWED';exception when others then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise;end if;end;
 begin perform public.al_contact_import(a,null,o,gen_random_uuid(),'[{"name":"Rollback","email":"rollback-smoke@example.invalid"},{"name":"X","email":"bad"}]');raise exception 'INVALID_BATCH_ALLOWED';exception when others then if sqlerrm<>'INVALID_CONTACT_IMPORT' then raise;end if;end;
 begin perform public.al_contact_import(b,null,o);raise exception 'FOREIGN_HISTORY_ALLOWED';exception when others then if sqlerrm<>'ACCESS_DENIED' then raise;end if;end;
 v:=public.al_contact_import(a,null,o,gen_random_uuid(),'[{"name":"Do not overwrite","email":"smoke-import@example.invalid"}]');if (v->>'skipped')::int<>1 then raise exception 'EXISTING_OVERWRITTEN';end if;
 if jsonb_array_length(public.al_contact_import(a,null,o))<>2 then raise exception 'HISTORY_MISSING';end if;
end $$;
reset role;
do $$begin if exists(select 1 from public.al_contacts where email='rollback-smoke@example.invalid') then raise exception 'PARTIAL_IMPORT';end if;end $$;
rollback;
