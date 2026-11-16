-- Bounded, tenant-scoped cursor listing. Identity is verified by Edge before service RPC.
create function public.al_query_envelopes(p_actor uuid,p_key_hash text,p_org uuid,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid;lim int;state text;query text;after_time timestamptz;after_id uuid;from_time timestamptz;to_time timestamptz;items jsonb;next_item jsonb;more boolean;
begin
 o:=al_private.flow_context(p_actor,p_key_hash,p_org,false);
 if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'INVALID_QUERY';end if;
 lim:=coalesce((p_filters->>'limit')::int,100);state:=p_filters->>'status';query:=coalesce(p_filters->>'query','');
 if lim not between 1 and 100 or length(query)>160 or (state is not null and state not in ('draft','sent','in_progress','completed','declined','expired','cancelled')) then raise exception 'INVALID_QUERY';end if;
 after_time:=(p_filters->'cursor'->>'updatedAt')::timestamptz;after_id:=(p_filters->'cursor'->>'id')::uuid;
 if (after_time is null)<>(after_id is null) then raise exception 'INVALID_CURSOR';end if;
 from_time:=(p_filters->>'from')::timestamptz;to_time:=(p_filters->>'to')::timestamptz;
 if from_time is not null and to_time is not null and from_time>to_time then raise exception 'INVALID_QUERY';end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at desc,e.id desc),'[]') into items from
 (select * from public.al_envelopes where organization_id=o and (state is null or status=state)
 and (query='' or strpos(lower(title),lower(query))>0)
 and (from_time is null or updated_at>=from_time) and (to_time is null or updated_at<=to_time)
 and (after_time is null or (updated_at,id)<(after_time,after_id)) order by updated_at desc,id desc limit lim+1)e;
 more:=jsonb_array_length(items)>lim;
 if more then
  select jsonb_agg(value order by ordinality) into items from jsonb_array_elements(items) with ordinality where ordinality<=lim;
  next_item:=items->(lim-1);
 end if;
 return jsonb_build_object('items',items,'nextCursor',case when more then jsonb_build_object('updatedAt',next_item->>'updated_at','id',next_item->>'id') else null end);
end $$;
revoke all on function public.al_query_envelopes(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.al_query_envelopes(uuid,text,uuid,jsonb) to service_role;
