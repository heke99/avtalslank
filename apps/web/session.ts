import {supabase} from './client';
export async function bounded<T>(operation:PromiseLike<T>,code='REQUEST_TIMEOUT',ms=12000):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([Promise.resolve(operation),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]);}finally{clearTimeout(timer!);}}
export async function currentSession(){const {data,error}=await bounded(supabase.auth.getSession(),'SESSION_TIMEOUT',6000);if(error)throw error;if(!data.session)throw Error('AUTH_REQUIRED');return data.session;}
