import {normalizePersonalNumber} from '../../signing/src/identity.ts';
export type AccountKind='company'|'personal';
export type Registration={kind:AccountKind;fullName:string;registrationNumber?:string;companyName?:string;companyEmail?:string;personalNumber?:string;phone?:string;existingOrganizationId?:string};
export function normalizeOrganizationNumber(input:string){const n=input.replace(/[- ]/g,'');if(!/^\d{10}$/.test(n))throw Error('INVALID_REGISTRATION');const sum=[...n].reduce((s,v,i)=>{let x=Number(v)*(i%2?1:2);return s+Math.floor(x/10)+x%10;},0);if(sum%10)throw Error('INVALID_REGISTRATION');return n;}
export function registrationFromForm(f:FormData,kind:AccountKind):Registration{
 const text=(name:string)=>String(f.get(name)??'').trim();const fullName=text('fullName'),phone=text('phone');
 if(fullName.length<2||fullName.length>120||/[\x00-\x1f]/.test(fullName)||phone.length>40)throw Error('INVALID_REGISTRATION');
 if(kind==='personal')return {kind,fullName,personalNumber:normalizePersonalNumber(text('personalNumber')),phone};
 const existingOrganizationId=text('existingOrganizationId');if(existingOrganizationId)return {kind,fullName,phone,existingOrganizationId};
 const companyName=text('companyName'),companyEmail=text('companyEmail');if(companyName.length<2||companyName.length>120||(companyEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail)))throw Error('INVALID_REGISTRATION');
 return {kind,fullName,companyName,registrationNumber:normalizeOrganizationNumber(text('registrationNumber')),companyEmail,phone};
}
