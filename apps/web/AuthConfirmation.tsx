import React,{useState} from 'react';
import type {EmailOtpType} from '@supabase/supabase-js';
import {supabase,displayError} from './client';
const types=['email','signup','recovery','invite','magiclink','email_change'];
export default function AuthConfirmation(){
 const [link]=useState(()=>{const q=new URLSearchParams(location.hash.slice(1)||location.search.slice(1));const token=q.get('token_hash')??'';const type=q.get('type')??'';history.replaceState(null,'','/auth/confirm');return {token,type};});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const valid=link.token.length>=32&&link.token.length<=512&&/^[a-zA-Z0-9_-]+$/.test(link.token)&&types.includes(link.type);
 return <main className="auth-layout"><section className="auth-main"><a href="/" className="public-brand">avtalslänk</a><div className="auth-form"><h1>{link.type==='recovery'?'Återställ ditt lösenord':'Bekräfta din e-postadress'}</h1><p>{valid?'Klicka nedan för att fortsätta. Länken kan användas en gång och fungerar även på en annan enhet.':'Länken saknas eller är ogiltig. Begär ett nytt mejl via inloggningssidan.'}</p>{error&&<p role="alert">{error}</p>}{valid&&<button className="primary full" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const r=await supabase.auth.verifyOtp({token_hash:link.token,type:link.type as EmailOtpType});if(r.error)throw r.error;location.replace(link.type==='recovery'?'/reset-password':'/');}catch(e){setError(displayError(e)+' Länken kan ha gått ut eller redan använts. Begär i så fall ett nytt mejl.');setBusy(false);}}}>{busy?'Bekräftar…':link.type==='recovery'?'Fortsätt till nytt lösenord':'Bekräfta e-postadress'}</button>}<p><a href="/login">Till inloggningen</a></p></div></section></main>;
}
