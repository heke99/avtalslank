alter table public.al_templates add column pdf_path text;
create unique index al_templates_pdf_path_idx on public.al_templates(pdf_path) where pdf_path is not null;

create function public.al_template_file_access(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 if p_path !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/templates/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$' then return false;end if;
 org:=split_part(p_path,'/',1)::uuid;
 return public.al_can_access(org,p_write) and (p_write or exists(
  select 1 from public.al_templates where organization_id=org and pdf_path=p_path
 ));
end $$;
revoke all on function public.al_template_file_access(text,boolean) from public,anon;
grant execute on function public.al_template_file_access(text,boolean) to authenticated;
create policy al_template_pdf_read on storage.objects for select to authenticated
 using(bucket_id='al-documents' and public.al_template_file_access(name));
create policy al_template_pdf_insert on storage.objects for insert to authenticated
 with check(bucket_id='al-documents' and public.al_template_file_access(name,true));

create function public.al_save_pdf_template(p_org uuid,p_name text,p_fields jsonb,p_path text,p_id uuid default null,p_version int default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
 if p_path is null or split_part(p_path,'/',1) is distinct from p_org::text or not public.al_template_file_access(p_path,true) then raise exception 'ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('al:storage:'||p_path,0));
 if not exists(select 1 from storage.objects where bucket_id='al-documents' and name=p_path)
   or exists(select 1 from al_private.storage_cleanup where bucket='al-documents' and path=p_path)
 then raise exception 'UPLOAD_NOT_FOUND';end if;
 if jsonb_typeof(p_fields) is distinct from 'array' or jsonb_array_length(p_fields) not between 1 and 200 then raise exception 'INVALID_FIELDS';end if;
 if exists(select 1 from jsonb_array_elements(p_fields) f where f->>'recipientRole' is distinct from 'Avsändare' or f->>'type' not in ('text','date'))
 then raise exception 'INVALID_FIELDS';end if;
 saved:=public.al_save_template(p_org,p_name,p_fields,p_id,p_version);
 update public.al_templates set pdf_path=p_path where id=(saved->>'id')::uuid;
 return saved||jsonb_build_object('pdf_path',p_path);
end $$;
revoke all on function public.al_save_pdf_template(uuid,text,jsonb,text,uuid,int) from public,anon;
grant execute on function public.al_save_pdf_template(uuid,text,jsonb,text,uuid,int) to authenticated;

-- A referenced source PDF is not an orphan. Recheck under the same lock as registration.
do $migration$
declare src text;patched text;
begin
 src:=pg_get_functiondef('public.al_storage_cleanup_batch()'::regprocedure);
 patched:=replace(src,'not exists(select 1 from public.al_documents d where d.storage_path=s.name)',
  '(not exists(select 1 from public.al_documents d where d.storage_path=s.name) and not exists(select 1 from public.al_templates t where t.pdf_path=s.name))');
 if patched=src then raise exception 'TEMPLATE_CLEANUP_PREDICATE_FAILED';end if;
 src:=replace(patched,'if exists(select 1 from public.al_documents where storage_path=obj.name) then continue;end if;',
  'if exists(select 1 from public.al_documents where storage_path=obj.name) or exists(select 1 from public.al_templates where pdf_path=obj.name) then continue;end if;');
 if src=patched then raise exception 'TEMPLATE_CLEANUP_LOCK_FAILED';end if;
 execute src;
end
$migration$;
