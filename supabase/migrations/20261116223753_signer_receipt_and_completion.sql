-- Immutable signer evidence, service-only. No retrofit of completed documents.
alter table al_private.signing_links add column signer_evidence jsonb;
create function al_private.valid_personal_number(p text) returns boolean language plpgsql stable set search_path='' as $$
declare d date; s int:=0; n int;i int;
begin
 if p !~ '^[0-9]{12}$' then return false;end if;
 begin d:=make_date(substring(p,1,4)::int,substring(p,5,2)::int,substring(p,7,2)::int);exception when others then return false;end;
 if d>current_date or d<date '1800-01-01' then return false;end if;
 for i in 3..12 loop n:=substring(p,i,1)::int*case when i%2=1 then 2 else 1 end;s:=s+n/10+n%10;end loop;return s%10=0;
end $$;
revoke all on function al_private.valid_personal_number(text) from public,anon,authenticated;
create function public.al_signer_decide(p_hash text,p_payload jsonb,p_network jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare answer jsonb;l al_private.signing_links;c al_private.signing_cases;ident jsonb;pn text;ev jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED';end if;
 if p_payload->>'intent'='approve' then
  ident:=p_payload->'identity';pn:=regexp_replace(coalesce(ident->>'personalNumber',''),'[- +]','','g');
  if jsonb_typeof(ident)<>'object' or length(trim(coalesce(ident->>'name',''))) not between 2 and 120 or (ident->>'name') ~ '[[:cntrl:]]' or not al_private.valid_personal_number(pn) then raise exception 'INVALID_SIGNER_IDENTITY';end if;
 end if;
 -- Existing command owns locks, expiry, frozen snapshot, consent and exact replay.
 answer:=public.al_signer_command(p_hash,'decide',p_payload);
 select * into l from al_private.signing_links where token_hash=p_hash;
 if p_payload->>'intent'='approve' and l.signer_evidence is null then
  select * into c from al_private.signing_cases where envelope_id=l.envelope_id;
  ev:=jsonb_build_object('schema','avtalslank.signer-evidence.v1','name',trim(ident->>'name'),'personalNumber',pn,'identityAssurance','self_declared','hashAlgorithm','sha256-postgres-jsonb-v1','signedAt',l.consumed_at,'documentSetHash',c.snapshot_hash,'recipientId',l.recipient_id,'method','email_approval','ip',case when p_network->>'source'='forwarded_unverified' and length(p_network->>'ip')<=45 then p_network->>'ip' else null end,'ipSource',case when p_network->>'source'='forwarded_unverified' then 'forwarded_unverified' else 'unavailable' end);
  -- DB time and frozen snapshot participate; a hash is integrity evidence, not a qualified signature.
  ev:=ev||jsonb_build_object('signingHash',encode(sha256(convert_to(jsonb_build_object('evidence',ev,'decision',l.decision)::text,'UTF8')),'hex'));
  update al_private.signing_links set signer_evidence=ev where id=l.id;
 end if;return answer;
end $$;
revoke all on function public.al_signer_decide(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.al_signer_decide(text,jsonb,jsonb) to service_role;
-- Broaden the existing recipient final-download projection to the same case's evidence archive.
do $$declare src text;begin
 select pg_get_functiondef('public.al_signer_command(text,text,jsonb)'::regprocedure) into src;
 if position('and value->>''documentId''<>''evidence''' in src)=0 then raise exception 'SIGNER_PATCH_FAILED';end if;
 src:=replace(src,'and value->>''documentId''<>''evidence''','');execute src;
end $$;
alter table al_private.signing_outbox drop constraint signing_outbox_kind_check;
alter table al_private.signing_outbox add constraint signing_outbox_kind_check check(kind in ('invitation','finalize','webhook','completion'));
do $$declare src text;begin
 select pg_get_functiondef('public.al_signing_worker(text,uuid,uuid,jsonb)'::regprocedure) into src;
 if position('''consumedAt'',consumed_at' in src)=0 then raise exception 'WORKER_PATCH_FAILED';end if;
 src:=replace(src,'''consumedAt'',consumed_at','''consumedAt'',consumed_at,''evidence'',signer_evidence');
 src:=replace(src,'kind in (''invitation'',''webhook'')','kind in (''invitation'',''webhook'',''completion'')');execute src;
end $$;
create function al_private.queue_completion_mail() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  insert into al_private.signing_outbox(organization_id,envelope_id,kind,effect_key,payload)
  select new.organization_id,new.id,'completion','completed:'||l.id,jsonb_build_object('linkId',l.id,'recipientId',l.recipient_id)
  from al_private.signing_links l where l.envelope_id=new.id and l.consumed_at is not null and l.revoked_at is null and l.expires_at>now() on conflict(effect_key) do nothing;
 end if;return new;
end $$;
revoke all on function al_private.queue_completion_mail() from public,anon,authenticated;
create trigger al_queue_completion_mail after update of status on public.al_envelopes for each row execute function al_private.queue_completion_mail();
