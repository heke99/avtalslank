export function normalizePersonalNumber(input: string) {
 const p=input.replace(/[- +]/g,'');if(!/^\d{12}$/.test(p))throw Error('INVALID_SIGNER_IDENTITY');
 const y=Number(p.slice(0,4)),m=Number(p.slice(4,6)),d=Number(p.slice(6,8));const date=new Date(Date.UTC(y,m-1,d));
 if(y<1800||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d||date.getTime()>Date.now())throw Error('INVALID_SIGNER_IDENTITY');
 const sum=[...p.slice(2)].reduce((s,v,i)=>{const n=Number(v)*(i%2===0?2:1);return s+Math.floor(n/10)+n%10;},0);
 if(sum%10)throw Error('INVALID_SIGNER_IDENTITY');return p;
}
// This header can be client-influenced; never promote it to verified identity evidence.
export function forwardedNetwork(headers: Headers) {
 const ip=headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'';
 const v4=ip.split('.');const valid4=v4.length===4&&v4.every(v=>/^\d{1,3}$/.test(v)&&Number(v)<=255);
 const valid6=ip.includes(':')&&/^[a-fA-F0-9:]{2,45}$/.test(ip);
 return (valid4||valid6)?{ip,source:'forwarded_unverified'}:{ip:null,source:'unavailable'};
}
