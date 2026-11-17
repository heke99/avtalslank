import {supabase} from './client';
import {bounded} from './deadline';
export {bounded} from './deadline';
export async function currentSession(){const {data,error}=await bounded(supabase.auth.getSession(),'SESSION_TIMEOUT',6000);if(error)throw error;if(!data.session)throw Error('AUTH_REQUIRED');return data.session;}
