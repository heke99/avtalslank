-- Synthetic editor/tenant verification; no actual upload, provider or email. Complete rollback.
begin;
insert into auth.users(id,email,email_confirmed_at) values('f8170001-0000-4000-8000-000000000001','avtalslank-editor-a@example.invalid',now()),('f8170002-0000-4000-8000-000000000002','avtalslank-editor-b@example.invalid',now());
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8170001-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $$declare o uuid;e jsonb;r jsonb;t jsonb;begin
 o:=public.al_create_organization('Editor smoke A');e:=public.al_save_draft(o,'Editor smoke','',false,30);
 r:=public.al_add_recipient(o,(e->>'id')::uuid,'Testmottagare','editor-recipient@example.invalid','email_approval',1);
 t:=public.al_save_template(o,'Editor smoke template','[{"id":"source","label":"Namn","type":"text","recipientRole":"Kund","required":false,"page":0,"x":0.1,"y":0.2,"width":0.4,"height":0.05}]');
 perform set_config('al.editor_org',o::text,true);perform set_config('al.editor_envelope',e->>'id',true);perform set_config('al.editor_recipient',r->>'id',true);perform set_config('al.editor_template',t->>'id',true);
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8170002-0000-4000-8000-000000000002"}',true);
do $$declare o uuid;begin
 o:=public.al_create_organization('Editor smoke B');perform set_config('al.editor_foreign_org',o::text,true);
 if exists(select 1 from public.al_templates where id=current_setting('al.editor_template')::uuid) then raise exception 'FOREIGN_TEMPLATE_VISIBLE';end if;
end $$;
reset role;
do $$declare d uuid:=gen_random_uuid();o uuid:=current_setting('al.editor_org')::uuid;e uuid:=current_setting('al.editor_envelope')::uuid;begin
 insert into public.al_documents(id,organization_id,envelope_id,name,storage_path,sha256,byte_size,status,page_count) values(d,o,e,'editor-smoke.pdf',o::text||'/'||e::text||'/'||d::text||'/original.pdf',repeat('a',64),5,'ready',2);perform set_config('al.editor_document',d::text,true);
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare a uuid:='f8170001-0000-4000-8000-000000000001';b uuid:='f8170002-0000-4000-8000-000000000002';o uuid:=current_setting('al.editor_org')::uuid;e uuid:=current_setting('al.editor_envelope')::uuid;v jsonb;s jsonb;f jsonb;begin
 v:=public.al_flow_command(a,null,o,e,'read');
 f:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'documentId',current_setting('al.editor_document'),'recipientId',current_setting('al.editor_recipient'),'label','Kopierat namn','type','text','required',false,'page',1,'x',0.1,'y',0.2,'width',0.4,'height',0.05));
 s:=public.al_flow_command(a,null,o,e,'fields',jsonb_build_object('generation',v->'envelope'->'generation','fields',f));
 if s->'fields' is distinct from f or (s->>'expires_days')::int<>30 then raise exception 'EDITOR_VALUES_CHANGED';end if;
 begin perform public.al_flow_command(a,null,o,e,'fields',jsonb_build_object('generation',v->'envelope'->'generation','fields',f));raise exception 'STALE_FIELDS_ALLOWED';exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 begin perform public.al_flow_command(b,null,current_setting('al.editor_foreign_org')::uuid,e,'fields',jsonb_build_object('generation',s->'generation','fields',f));raise exception 'FOREIGN_EDIT_ALLOWED';exception when others then if sqlerrm<>'ENVELOPE_NOT_FOUND' then raise;end if;end;
 perform public.al_flow_command(a,null,o,e,'read');
 perform public.al_cancel_envelope(o,e);
 begin perform public.al_flow_command(a,null,o,e,'fields',jsonb_build_object('generation',s->'generation','fields',f));raise exception 'LOCKED_EDIT_ALLOWED';exception when others then if sqlerrm<>'DOCUMENT_LOCKED' then raise;end if;end;
end $$;
reset role;
rollback;
