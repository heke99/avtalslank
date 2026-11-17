alter table public.al_recipients add column company_name text not null default '' check(length(company_name)<=120),add column registration_number text not null default '' check(registration_number='' or registration_number~'^[0-9]{10}$');
create table al_private.document_tariffs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.al_organizations(id),version int not null,document_ore bigint not null check(document_ore between 0 and 100000000),included_signers int not null check(included_signers between 1 and 50),extra_signer_ore bigint not null check(extra_signer_ore between 0 and 100000000),created_at timestamptz not null default now(),unique(organization_id,version));
create table al_private.document_charges(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.al_organizations(id),envelope_id uuid not null references public.al_envelopes(id),document_id uuid not null references public.al_documents(id),tariff_id uuid not null references al_private.document_tariffs(id),signers int not null check(signers between 1 and 50),amount_ore bigint not null check(amount_ore>=0),currency text not null default 'SEK',created_at timestamptz not null default now(),unique(document_id));
create table al_private.document_charge_jobs(charge_id uuid primary key references al_private.document_charges(id),status text not null default 'blocked_provider' check(status in ('blocked_provider','pending','running','paid','failed','unknown')));
alter table al_private.signing_cases add column price_quote jsonb;
do $$declare t text;begin foreach t in array array['document_tariffs','document_charges','document_charge_jobs'] loop execute format('alter table al_private.%I enable row level security',t);execute format('revoke all on al_private.%I from public,anon,authenticated',t);execute format('create policy deny_client_access on al_private.%I as restrictive for all to anon,authenticated using(false) with check(false)',t);end loop;end $$;
create trigger immutable_document_tariff before update or delete on al_private.document_tariffs for each row execute function al_private.platform_audit_immutable();
create trigger immutable_document_charge before update or delete on al_private.document_charges for each row execute function al_private.platform_audit_immutable();
create function al_private.document_quote(p_org uuid,p_envelope uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare t al_private.document_tariffs;e public.al_envelopes;n int;d jsonb;q jsonb;unit bigint;begin
 select * into e from public.al_envelopes where id=p_envelope and organization_id=p_org;if not found then raise exception 'NOT_FOUND';end if;
 select * into t from al_private.document_tariffs where organization_id=p_org order by version desc limit 1 for share;if not found then raise exception 'DOCUMENT_TARIFF_REQUIRED';end if;
 select count(*) into n from public.al_recipients where envelope_id=p_envelope;
 select jsonb_agg(id order by id) into d from public.al_documents where envelope_id=p_envelope;
 if n not between 1 and 50 or d is null then raise exception 'DOCUMENT_OR_SIGNER_REQUIRED';end if;
 unit:=t.document_ore+greatest(0,n-t.included_signers)*t.extra_signer_ore;
 q:=jsonb_build_object('tariffId',t.id,'version',t.version,'generation',e.generation,'documentIds',d,'documents',jsonb_array_length(d),'signers',n,'unitOre',unit,'totalOre',unit*jsonb_array_length(d),'currency','SEK','taxBasis','excluding_vat');
 return q||jsonb_build_object('hash',encode(sha256(convert_to(q::text,'UTF8')),'hex'));
end $$;
revoke all on function al_private.document_quote(uuid,uuid) from public,anon,authenticated;
create function public.al_document_quote(p_actor uuid,p_key_hash text,p_org uuid,p_envelope uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare o uuid;q jsonb;begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,true);perform 1 from public.al_envelopes where id=p_envelope and organization_id=o for update;
 select price_quote into q from al_private.signing_cases where envelope_id=p_envelope;if q is not null then return q;end if;
 return al_private.document_quote(o,p_envelope);
end $$;
revoke all on function public.al_document_quote(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.al_document_quote(uuid,text,uuid,uuid) to service_role;
alter function public.al_flow_command(uuid,text,uuid,uuid,text,jsonb) rename to al_flow_before_document_price;
revoke all on function public.al_flow_before_document_price(uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
create function public.al_flow_command(p_actor uuid,p_key_hash text,p_org uuid,p_envelope uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare o uuid;q jsonb;r jsonb;existing boolean;begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,p_action not in ('read','download','deliveries'));
 perform 1 from public.al_envelopes where id=p_envelope and organization_id=o for update;if not found then raise exception 'ENVELOPE_NOT_FOUND';end if;
 if p_action='party' then
  perform al_private.lock_draft(o,p_envelope);
  if length(coalesce(p_payload->>'companyName',''))>120 or coalesce(p_payload->>'registrationNumber','')!~'^([0-9]{10})?$' then raise exception 'INVALID_BODY';end if;
  if coalesce(p_payload->>'registrationNumber','')<>'' then perform al_private.validate_registration(jsonb_build_object('kind','company','fullName','Mottagare','companyName','Mottagare','registrationNumber',p_payload->>'registrationNumber'));end if;
  update public.al_recipients set company_name=coalesce(p_payload->>'companyName',''),registration_number=coalesce(p_payload->>'registrationNumber','') where envelope_id=p_envelope and id=(p_payload->>'recipientId')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  update public.al_envelopes set generation=generation+1,updated_at=now() where id=p_envelope;return jsonb_build_object('ok',true);
 end if;
 select exists(select 1 from al_private.signing_cases where envelope_id=p_envelope) into existing;
 r:=public.al_flow_before_document_price(p_actor,p_key_hash,p_org,p_envelope,p_action,p_payload);
 if p_action='send' and not existing then
  q:=al_private.document_quote(o,p_envelope);
  if q->>'hash' is distinct from p_payload->>'priceHash' then raise exception 'PRICE_CHANGED';end if;
  update al_private.signing_cases set price_quote=q where envelope_id=p_envelope;
 end if;return r;
end $$;
revoke all on function public.al_flow_command(uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.al_flow_command(uuid,text,uuid,uuid,text,jsonb) to service_role;
create function al_private.record_document_charges() returns trigger language plpgsql security definer set search_path='' as $$declare d jsonb;cid uuid;begin
 if old.finalized_at is not null or new.finalized_at is null or new.price_quote is null then return new;end if;
 if exists(select 1 from jsonb_array_elements(new.snapshot->'recipients') r where not exists(select 1 from public.al_recipients actual where actual.id=(r->>'id')::uuid and actual.envelope_id=new.envelope_id and actual.status='signed')) then raise exception 'COMPLETE_SIGNERS_REQUIRED';end if;
 for d in select value from jsonb_array_elements(new.price_quote->'documentIds') loop
  insert into al_private.document_charges(organization_id,envelope_id,document_id,tariff_id,signers,amount_ore) values(new.organization_id,new.envelope_id,(d#>>'{}')::uuid,(new.price_quote->>'tariffId')::uuid,(new.price_quote->>'signers')::int,(new.price_quote->>'unitOre')::bigint) on conflict(document_id) do nothing returning id into cid;
  if cid is not null then insert into al_private.document_charge_jobs(charge_id) values(cid) on conflict do nothing;end if;
 end loop;return new;
end $$;
revoke all on function al_private.record_document_charges() from public,anon,authenticated;
create trigger record_document_charges after update of finalized_at on al_private.signing_cases for each row execute function al_private.record_document_charges();
create function public.al_admin_document_tariff(p_org uuid,p_payload jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=al_private.require_platform_admin();v int;t al_private.document_tariffs;begin
 perform 1 from public.al_organizations where id=p_org for update;if not found then raise exception 'NOT_FOUND';end if;
 select * into t from al_private.document_tariffs where organization_id=p_org order by version desc limit 1;
 if p_payload is null then return jsonb_build_object('tariff',case when t.id is null then null else to_jsonb(t) end,'charges',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select c.*,j.status from al_private.document_charges c join al_private.document_charge_jobs j on j.charge_id=c.id where c.organization_id=p_org order by c.created_at desc limit 100)x));end if;
 if length(trim(coalesce(p_payload->>'reason',''))) not between 10 and 500 then raise exception 'REASON_REQUIRED';end if;
 if coalesce((p_payload->>'version')::int,-1)<>coalesce(t.version,0) then raise exception 'VERSION_CONFLICT';end if;
 v:=coalesce(t.version,0)+1;
 insert into al_private.document_tariffs(organization_id,version,document_ore,included_signers,extra_signer_ore) values(p_org,v,(p_payload->>'documentOre')::bigint,(p_payload->>'includedSigners')::int,(p_payload->>'extraSignerOre')::bigint) returning * into t;
 insert into al_private.platform_audit(actor_id,organization_id,action,reason,metadata) values(u,p_org,'document_tariff.saved',p_payload->>'reason',jsonb_build_object('tariffId',t.id,'version',v));return to_jsonb(t);
end $$;
revoke all on function public.al_admin_document_tariff(uuid,jsonb) from public,anon;
grant execute on function public.al_admin_document_tariff(uuid,jsonb) to authenticated;
alter table al_private.signing_cases add column search_sender jsonb;
create function al_private.freeze_case_sender() returns trigger language plpgsql security definer set search_path='' as $$begin select jsonb_build_object('name',name,'registrationNumber',registration_number) into new.search_sender from public.al_organizations where id=new.organization_id;return new;end $$;
revoke all on function al_private.freeze_case_sender() from public,anon,authenticated;
create trigger freeze_case_sender before insert on al_private.signing_cases for each row execute function al_private.freeze_case_sender();
create function al_private.protect_case_prices() returns trigger language plpgsql set search_path='' as $$begin if old.price_quote is not null and new.price_quote is distinct from old.price_quote or new.search_sender is distinct from old.search_sender then raise exception 'IMMUTABLE_PRICE_QUOTE';end if;return new;end $$;
revoke all on function al_private.protect_case_prices() from public,anon,authenticated;
create trigger protect_case_prices before update on al_private.signing_cases for each row execute function al_private.protect_case_prices();
create function al_private.search_signed(p_org uuid,p_query text,p_cursor uuid,p_limit int) returns jsonb language plpgsql security definer set search_path='' as $$declare q text:=lower(trim(coalesce(p_query,'')));items jsonb;more boolean;last_id text;begin
 if q<>'' and regexp_replace(q,'[- ]','','g')='' then raise exception 'INVALID_QUERY';end if;
 if length(q)>160 or p_limit not between 1 and 100 then raise exception 'INVALID_QUERY';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into items from(
 select e.id,e.title,e.organization_id,e.status,e.updated_at,c.finalized_at,coalesce(c.search_sender->>'name',o.name) as company,
 (select jsonb_agg(jsonb_build_object('name',coalesce(l.signer_evidence->>'name',r.name),'email',r.email,'company',r.company_name,'registrationNumber',r.registration_number) order by r.position) from public.al_recipients r left join al_private.signing_links l on l.recipient_id=r.id and l.envelope_id=e.id where r.envelope_id=e.id) as signers
 from public.al_envelopes e join public.al_organizations o on o.id=e.organization_id join al_private.signing_cases c on c.envelope_id=e.id
 where e.status='completed' and c.finalized_at is not null and (p_org is null or e.organization_id=p_org) and (p_cursor is null or e.id>p_cursor)
 and(q='' or strpos(lower(e.title),q)>0 or strpos(lower(coalesce(c.search_sender->>'name',o.name)),q)>0 or strpos(regexp_replace(coalesce(c.search_sender->>'registrationNumber',o.registration_number,''),'[- ]','','g'),regexp_replace(q,'[- ]','','g'))>0
 or exists(select 1 from public.al_recipients r left join al_private.signing_links l on l.recipient_id=r.id and l.envelope_id=e.id where r.envelope_id=e.id and (strpos(lower(r.name),q)>0 or strpos(lower(r.email),q)>0 or strpos(lower(r.company_name),q)>0 or strpos(r.registration_number,regexp_replace(q,'[- ]','','g'))>0 or strpos(lower(coalesce(l.signer_evidence->>'name','')),q)>0)))
 order by e.id limit p_limit+1)x;
 more:=jsonb_array_length(items)>p_limit;
 if more then select jsonb_agg(value order by ordinality) into items from jsonb_array_elements(items) with ordinality where ordinality<=p_limit;last_id:=items->(p_limit-1)->>'id';end if;
 return jsonb_build_object('items',items,'nextCursor',last_id);
end $$;
revoke all on function al_private.search_signed(uuid,text,uuid,int) from public,anon,authenticated;
create function public.al_search_signed(p_actor uuid,p_key_hash text,p_org uuid,p_query text default '',p_cursor uuid default null,p_limit int default 50) returns jsonb language plpgsql security definer set search_path='' as $$declare o uuid;begin o:=al_private.flow_context(p_actor,p_key_hash,p_org,false);return al_private.search_signed(o,p_query,p_cursor,p_limit);end $$;
revoke all on function public.al_search_signed(uuid,text,uuid,text,uuid,int) from public,anon,authenticated;
grant execute on function public.al_search_signed(uuid,text,uuid,text,uuid,int) to service_role;
create function public.al_admin_search_signed(p_query text default '',p_org uuid default null,p_cursor uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=al_private.require_platform_admin();r jsonb;begin r:=al_private.search_signed(p_org,p_query,p_cursor,50);insert into al_private.platform_audit(actor_id,organization_id,action,reason) values(u,p_org,'signed.search','Administrative signed agreement search');return r;end $$;
revoke all on function public.al_admin_search_signed(text,uuid,uuid) from public,anon;
grant execute on function public.al_admin_search_signed(text,uuid,uuid) to authenticated;
