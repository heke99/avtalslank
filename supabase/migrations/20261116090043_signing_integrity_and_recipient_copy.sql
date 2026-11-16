-- Strengthen cross-resource integrity without changing already delivered migrations.
alter table public.al_recipients add constraint al_recipients_id_envelope_unique unique(id,envelope_id);
alter table al_private.signing_links add constraint signing_links_recipient_envelope_fk foreign key(recipient_id,envelope_id) references public.al_recipients(id,envelope_id);
alter table al_private.signing_cases add constraint signing_cases_tenant_envelope_fk foreign key(organization_id,envelope_id) references public.al_envelopes(organization_id,id);
alter table al_private.signing_cases add constraint signing_cases_tenant_envelope_unique unique(organization_id,envelope_id);
alter table al_private.signing_outbox add constraint signing_outbox_tenant_case_fk foreign key(organization_id,envelope_id) references al_private.signing_cases(organization_id,envelope_id);
do $$declare t text;begin
 foreach t in array array['signing_cases','signing_links','signing_outbox','signing_worker','webhook_secrets'] loop
  execute format('create policy deny_client_access on al_private.%I as restrictive for all to anon,authenticated using(false) with check(false)',t);
 end loop;
end $$;
create or replace function public.al_signer_command(p_hash text,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare l al_private.signing_links;e public.al_envelopes;c al_private.signing_cases;r public.al_recipients; f jsonb;k text;v text;n public.al_recipients;own_fields jsonb;view jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 -- Resolve only the resource ID first, then lock envelope before link for a consistent lock order.
 select * into l from al_private.signing_links where token_hash=p_hash;
 if not found then raise exception 'INVALID_SIGNING_LINK';end if;
 select * into e from public.al_envelopes where id=l.envelope_id for update;
 select * into l from al_private.signing_links where token_hash=p_hash for update;
 select * into c from al_private.signing_cases where envelope_id=e.id;
 select * into r from public.al_recipients where id=l.recipient_id and envelope_id=e.id;
 if l.revoked_at is not null or l.expires_at<=now() or e.status not in ('sent','in_progress','finalizing','completed','declined') then raise exception 'INVALID_SIGNING_LINK';end if;
 if l.consumed_at is not null then
  if p_action='decide' and p_payload is not distinct from l.decision then return jsonb_build_object('status',r.status,'envelopeStatus',e.status);end if;
  if p_action not in ('view','final') then raise exception 'LINK_ALREADY_USED';end if;
 end if;
 own_fields:=coalesce((select jsonb_agg(value) from jsonb_array_elements(c.snapshot->'envelope'->'fields') where value->>'recipientId'=r.id::text),'[]');
 view:=jsonb_build_object('title',c.snapshot->'envelope'->>'title','message',c.snapshot->'envelope'->>'message','recipient',jsonb_build_object('id',r.id,'name',r.name,'method',r.method,'status',r.status),'status',e.status,'snapshotHash',c.snapshot_hash,'expiresAt',l.expires_at,'fields',own_fields,'documents',coalesce((select jsonb_agg(jsonb_build_object('id',value->>'id','name',value->>'name','sha256',value->>'sha256','byte_size',value->'byte_size','page_count',value->'page_count')) from jsonb_array_elements(c.snapshot->'documents')),'[]'),'waiting',e.sequential and exists(select 1 from public.al_recipients where envelope_id=e.id and position<r.position and status<>'signed'));
 if p_action='view' then return view;end if;
 if p_action='final' then
  if e.status<>'completed' or r.status<>'signed' then raise exception 'FINAL_DOCUMENT_NOT_READY';end if;
  select value into f from jsonb_array_elements(c.result->'files') where value->>'documentId'=p_payload->>'documentId' and value->>'documentId'<>'evidence';
  if f is null then raise exception 'DOCUMENT_NOT_FOUND';end if;return f;
 end if;
 if e.status not in ('sent','in_progress') then raise exception 'DOCUMENT_LOCKED';end if;
 if e.sequential and exists(select 1 from public.al_recipients where envelope_id=e.id and position<r.position and status<>'signed') then raise exception 'WAITING_FOR_PREVIOUS_RECIPIENT';end if;
 if p_action='document' then
  select value into f from jsonb_array_elements(c.snapshot->'documents') where value->>'id'=p_payload->>'documentId';
  if f is null then raise exception 'DOCUMENT_NOT_FOUND';end if;return f;
 end if;
 if p_action<>'decide' then raise exception 'UNKNOWN_ACTION';end if;
 if p_payload->>'documentSetHash' is distinct from c.snapshot_hash then raise exception 'DOCUMENT_SET_CHANGED';end if;
 if p_payload->>'intent'='decline' then
  if length(coalesce(p_payload->>'reason',''))>500 then raise exception 'INVALID_DECISION';end if;
  update public.al_recipients set status='declined' where id=r.id;
  update public.al_envelopes set status='declined',updated_at=now() where id=e.id;
  update al_private.signing_links set consumed_at=now(),decision=p_payload where id=l.id;
  update al_private.signing_links set revoked_at=now() where envelope_id=e.id and id<>l.id;
  update al_private.signing_outbox set status='cancelled' where envelope_id=e.id and status='pending';
  insert into public.al_events(organization_id,envelope_id,kind,metadata) values(e.organization_id,e.id,'recipient.declined',jsonb_build_object('recipient_id',r.id)),(e.organization_id,e.id,'envelope.declined','{}');
  return jsonb_build_object('status','declined','envelopeStatus','declined');
 end if;
 if p_payload->>'intent' is distinct from 'approve' or p_payload->'consent' is distinct from 'true'::jsonb or p_payload->>'consentVersion' is distinct from 'email-approval-v1' or jsonb_typeof(p_payload->'values') is distinct from 'object' or r.method<>'email_approval' then raise exception 'INVALID_DECISION';end if;
 for k,v in select key,value from jsonb_each_text(p_payload->'values') loop
  if not exists(select 1 from jsonb_array_elements(own_fields) x where x->>'id'=k) or length(v)>2000 or jsonb_typeof(p_payload->'values'->k)<>'string' then raise exception 'UNASSIGNED_FIELD';end if;
 end loop;
 for f in select value from jsonb_array_elements(own_fields) loop
  v:=p_payload->'values'->>(f->>'id');
  if (f->>'required')::boolean and coalesce(trim(v),'')='' then raise exception 'REQUIRED_FIELD';end if;
  if f->>'type'='date' and coalesce(v,'')<>'' then
   if v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'INVALID_DATE';end if;
  end if;
 end loop;
 update al_private.signing_links set consumed_at=now(),decision=p_payload where id=l.id;
 update public.al_recipients set status='signed' where id=r.id;
 insert into public.al_events(organization_id,envelope_id,kind,metadata) values(e.organization_id,e.id,'recipient.signed',jsonb_build_object('recipient_id',r.id,'snapshot_hash',c.snapshot_hash,'consent_version','email-approval-v1'));
 insert into public.al_usage_events(organization_id,event_key,kind,quantity,envelope_id) values(e.organization_id,'signed:'||r.id,'recipient_signed',1,e.id) on conflict do nothing;
 if not exists(select 1 from public.al_recipients where envelope_id=e.id and status<>'signed') then
  update public.al_envelopes set status='finalizing',updated_at=now() where id=e.id;
  insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) values(e.organization_id,e.id,'finalize','finalize:'||e.id,'{}') on conflict do nothing;
 else
  update public.al_envelopes set status='in_progress',updated_at=now() where id=e.id;
  if e.sequential then
   select * into n from public.al_recipients where envelope_id=e.id and status='pending' order by position limit 1;
   insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload) select e.organization_id,e.id,'invitation','invite:'||n.id,jsonb_build_object('linkId',id,'recipientId',n.id) from al_private.signing_links where recipient_id=n.id and envelope_id=e.id on conflict do nothing;
  end if;
 end if;
 return jsonb_build_object('status','signed','envelopeStatus',(select status from public.al_envelopes where id=e.id));
end $$;

