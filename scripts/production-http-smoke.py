"""Read-only and invalid-input production checks. No accounts, valid signatures or messages."""
import json, time, urllib.request, urllib.error
from pathlib import Path
base='https://ykddnagtuacflilbchwx.supabase.co/functions/v1/avtalslank-api'
cases=[('health','GET','/health',None,{},200,None),('unauthenticated','GET','/v1/envelopes',None,{},401,'AUTH_REQUIRED'),('forged_session','GET','/v1/envelopes',None,{'Authorization':'Bearer synthetic-invalid-release-token'},401,'AUTH_REQUIRED'),('forbidden_origin','GET','/health',None,{'Origin':'https://invalid.example'},403,'ORIGIN_DENIED'),('invalid_link','POST','/v1/signer/view',{'token':'0'*64},{},401,'INVALID_SIGNING_LINK'),('malformed_link','POST','/v1/signer/view',{'token':'bad'},{},401,'INVALID_SIGNING_LINK'),('malformed_json','POST','/v1/signer/view',b'{',{},400,'INVALID_JSON'),('bounded_body','POST','/v1/signer/view',{'token':'0'*64,'oversized':'x'*17000},{},400,'BODY_TOO_LARGE'),('missing_decision','POST','/v1/signer/decide',{'token':'0'*64},{},400,'INVALID_DECISION')]
results=[]
for name,method,path,body,headers,expected,code in cases:
 req=urllib.request.Request(base+path,data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json',**headers})
 started=time.monotonic()
 try:r=urllib.request.urlopen(req,timeout=20)
 except urllib.error.HTTPError as e:r=e
 except Exception as e:results.append({'id':name,'result':'BLOCKED','error':type(e).__name__});continue
 raw=r.read();data=json.loads(raw);actual=data.get('error',{}).get('code');ok=r.status==expected and (code is None or actual==code) and r.headers.get('Cache-Control')=='no-store'
 results.append({'id':name,'result':'PASS' if ok else 'FAIL','status':r.status,'code':actual,'ms':round((time.monotonic()-started)*1000),'requestId':r.headers.get('X-Request-Id'),'cacheControl':r.headers.get('Cache-Control')})
print(json.dumps(results,indent=2))
Path('/tmp/al-production-http-results.json').write_text(json.dumps(results,indent=2))
raise SystemExit(0 if all(x['result']=='PASS' for x in results) else 1)
