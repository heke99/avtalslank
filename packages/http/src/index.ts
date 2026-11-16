export class RequestError extends Error {constructor(public code:string,public requestId:string|null=null,public status:number|null=null){super(code);this.name='RequestError';}}
export async function requestJson<T=any>(url:string,init:RequestInit={},options:{timeoutMs?:number;fetcher?:typeof fetch}={}):Promise<T>{
 const run=options.fetcher??fetch;const method=(init.method??'GET').toUpperCase();const attempts=method==='GET'?2:1;
 for(let i=0;i<attempts;i++){
  const controller=new AbortController();const onAbort=()=>controller.abort();if(init.signal?.aborted)controller.abort();else init.signal?.addEventListener('abort',onAbort,{once:true});
  const timeout=setTimeout(()=>controller.abort(),options.timeoutMs??15000);
  try{const r=await run(url,{...init,signal:controller.signal});if(method==='GET'&&[502,503,504].includes(r.status)&&i===0){await r.body?.cancel();continue;}
   let result:any;try{result=await r.json();}catch{if(init.signal?.aborted)throw new RequestError('REQUEST_CANCELLED');if(controller.signal.aborted)throw new RequestError('REQUEST_TIMEOUT');throw new RequestError('INVALID_RESPONSE',r.headers.get('x-request-id'),r.status);}
   if(!result||typeof result!=='object'||Array.isArray(result))throw new RequestError('INVALID_RESPONSE',r.headers.get('x-request-id'),r.status);
   if(!r.ok)throw new RequestError(typeof result.error?.code==='string'?result.error.code:'REQUEST_FAILED',result.error?.requestId??r.headers.get('x-request-id'),r.status);
   return result as T;
  }catch(e){if(e instanceof RequestError)throw e;if(init.signal?.aborted)throw new RequestError('REQUEST_CANCELLED');if(controller.signal.aborted)throw new RequestError('REQUEST_TIMEOUT');if(method==='GET'&&i===0)continue;throw new RequestError('NETWORK_ERROR');}
  finally{clearTimeout(timeout);init.signal?.removeEventListener('abort',onAbort);}
 }
 throw new RequestError('NETWORK_ERROR');
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseEnvelopeQuery(search:URLSearchParams){
 const limit=search.has('limit')?Number(search.get('limit')):100;const status=search.get('status');const query=search.get('query')??'';
 if(!Number.isInteger(limit)||limit<1||limit>100||query.length>160||(status!==null&&!['draft','sent','in_progress','completed','declined','expired','cancelled'].includes(status)))throw Error('INVALID_QUERY');
 const dates:Record<string,string>={};for(const key of ['from','to']){const value=search.get(key);if(value!==null){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||Number(value.slice(0,4))<1||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw Error('INVALID_QUERY');dates[key]=value;}}
 if(dates.from&&dates.to&&Date.parse(dates.from)>Date.parse(dates.to))throw Error('INVALID_QUERY');
 let cursor:null|{updatedAt:string;id:string}=null;const raw=search.get('cursor');if(raw){try{if(raw.length>1024)throw Error();const v=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/')));if(typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt))||typeof v.id!=='string'||!uuid.test(v.id))throw Error();cursor={updatedAt:v.updatedAt,id:v.id};}catch{throw Error('INVALID_CURSOR');}}
 return {limit,...(status?{status}:{}),query,...dates,...(cursor?{cursor}:{})};
}
export function encodeCursor(value:unknown){return value?btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null;}
