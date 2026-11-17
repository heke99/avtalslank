import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.110.7';
import {parseEnvelopeQuery,encodeCursor} from '../../../packages/http/src/index.ts';
export async function queryRoute(req:Request,path:string,db:SupabaseClient,identity:{actor:string|null;keyHash:string|null;organizationId:string|null}){
 if(path==='/v1/signed-search'&&req.method==='GET'){const u=new URL(req.url);const limit=Number(u.searchParams.get('limit')??50);const cursor=u.searchParams.get('cursor');if(!Number.isInteger(limit)||limit<1||limit>100||cursor&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor))throw Error('INVALID_QUERY');const r=await db.rpc('al_search_signed',{p_actor:identity.actor,p_key_hash:identity.keyHash,p_org:identity.keyHash?null:identity.organizationId,p_query:u.searchParams.get('query')??'',p_cursor:cursor,p_limit:limit});if(r.error)throw r.error;return {data:r.data};}
 if(path!=='/v1/envelopes' ||req.method!=='GET')return null;
 if(!identity.keyHash&&(!identity.organizationId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity.organizationId)))throw Error('INVALID_ID');
 const {data,error}=await db.rpc('al_query_envelopes',{p_actor:identity.actor,p_key_hash:identity.keyHash,p_org:identity.keyHash?null:identity.organizationId,p_filters:parseEnvelopeQuery(new URL(req.url).searchParams)});if(error)throw error;
 return {data:data.items,page:{nextCursor:encodeCursor(data.nextCursor)}};
}
