import { readFileSync } from 'node:fs';
import { contentFixture } from './vendor-content-fixture.mjs';
import { handlePublicDocuments, servePublicDocument } from '../src/vendor-public-documents.js';

export function documentFixture() {
  const base = contentFixture(), { sqlite, db } = base;
  sqlite.exec(readFileSync(new URL('../migrations/0033_vendor_public_documents.sql', import.meta.url),'utf8'));
  const bucket = new Map(), uploads = [], deletions = [];
  let beforeBatch = null, failAudit = false;
  db.batch = async statements => {
    if (beforeBatch) { const fn=beforeBatch;beforeBatch=null;fn(); }
    sqlite.exec('BEGIN');
    try { const results=[];for(let i=0;i<statements.length;i++){if(i===1&&failAudit)throw new Error('audit unavailable');results.push(await statements[i].run());}sqlite.exec('COMMIT');return results; }
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  };
  const env={DB:db,R2_BUCKET:{
    async put(key, stream){const bytes=new Uint8Array(await new Response(stream).arrayBuffer());bucket.set(key,bytes);uploads.push(key);},
    async delete(key){bucket.delete(key);deletions.push(key);},
    async get(key){const bytes=bucket.get(key);return bytes?{body:new Blob([bytes]).stream()}:null;}
  }};
  const dependencies={
    requireAdmin:async({sessionToken})=>sessionToken==='admin'?{ok:true,user:{id:'admin-1',role:'admin'}}:sessionToken==='viewer'?{ok:true,user:{id:'viewer-1',role:'viewer'}}:{ok:false},
    verifyVendorPortalToken:async(_env,token)=>token==='token-a'?{vendor_id:'a',username:'shop-a'}:token==='token-b'?{vendor_id:'b',username:'shop-b'}:token==='stale'?{vendor_id:'a',username:'old-shop-a'}:null,
    readVendorPortalCookie:()=>null,
  };
  const handler=(request,admin=false)=>handlePublicDocuments(request,env,dependencies,admin);
  async function mutation(data, file=null, token='token-a', admin=false, vendorId='a', extraHeaders={}){
    const headers={Authorization:'Bearer '+token,...extraHeaders};let body;
    if(file){body=new FormData();Object.entries(data).forEach(([key,value])=>body.append(key,String(value)));body.append('file',file);}
    else{headers['Content-Type']='application/json';body=JSON.stringify(data);}
    const response=await handler(new Request('https://fixture.test/'+(admin?'admin-api/vendor-documents':'api/vendor-store/documents')+'?vendor_id='+vendorId,{method:'POST',headers,body}),admin);
    return {status:response.status,...await response.json()};
  }
  async function list(managing=false,token='token-a',admin=false){const response=await handler(new Request('https://fixture.test/'+(admin?'admin-api/vendor-documents':'api/vendor-store/documents')+'?vendor_id=a'+(managing?'&manage=1':''),{headers:managing?{Authorization:'Bearer '+token}:{}}),admin);return{status:response.status,...await response.json()};}
  return {...base,env,bucket,uploads,deletions,handler,mutation,list,download:(id,query='')=>servePublicDocument(new Request('https://fixture.test/vendor-document/'+id+query),env),race:fn=>beforeBatch=fn,auditFailure:value=>failAudit=value};
}
export const pdf = (name='優惠方案.pdf',size=32) => new File(['%PDF-1.7\n',new Uint8Array(Math.max(0,size-9))],name,{type:'application/pdf'});
export const requestId = () => crypto.randomUUID();
