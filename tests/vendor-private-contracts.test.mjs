import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import {handlePrivateVendorContracts,hasUpdatedVendorContract,CONTRACT_MAX_BYTES,PRIVATE_CONTRACT_PREFIX} from '../src/vendor-private-contracts.js';
import {decorateVendorPrivateContractHtml} from '../src/vendor-private-contracts-ui.js';

const pdf=(name='合作合約.pdf',body='%PDF-1.7\ncontract')=>new File([body],name,{type:'application/pdf'});
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,status TEXT,is_hidden INTEGER,vendor_portal_username TEXT);INSERT INTO welfare_vendors VALUES('a','rejected',0,'account-a'),('b','pending',0,'account-b');CREATE TABLE welfare_vendor_supplements(vendor_id TEXT PRIMARY KEY,revision INTEGER,last_event_id TEXT,state TEXT);INSERT INTO welfare_vendor_supplements VALUES('a',3,'event-current','needs_supplement')");
  sqlite.exec(readFileSync(new URL('../migrations/0043_vendor_private_contracts.sql',import.meta.url),'utf8'));
  const objects=new Map(),deletes=[];let race=null;
  const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){if(sql.startsWith('INSERT INTO welfare_vendor_private_contracts')&&race){const action=race;race=null;action();}const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};}};
  const bucket={async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async get(key){const bytes=objects.get(key);return bytes?{body:new Blob([bytes]).stream()}:null;},async delete(key){deletes.push(key);objects.delete(key);}};
  const deps={readVendorPortalCookie(request){const value=request.headers.get('Cookie');return value==='test-cookie'?{portal_token:'token-a'}:{};},async verifyVendorPortalToken(env,token){return token==='token-a'?{vendor_id:'a',username:'account-a'}:token==='token-b'?{vendor_id:'b',username:'account-b'}:null;},async requireAdmin({sessionToken}){return sessionToken==='admin'?{ok:true,user:{id:'admin-1',role:'admin'}}:sessionToken==='viewer'?{ok:true,user:{id:'viewer-1',role:'viewer'}}:{ok:false};}};
  deps.authorizeAdmin=async request=>request.headers.get('Authorization')==='Bearer admin'?{id:'admin-1',role:'admin',business_units:'vendors'}:null;
  const handler=(request,admin=false)=>handlePrivateVendorContracts(request,{DB:db,R2_BUCKET:bucket},deps,admin);
  const url=(vendor='a',admin=false,id='')=>'https://contract.test'+(admin?'/admin-api/vendor-contracts':'/api/vendor-application/contracts')+'?'+new URLSearchParams({vendor_id:vendor,...(id?{id}:{})});
  const request=(method='GET',token='token-a',vendor='a',admin=false,id='',extra={})=>new Request(url(vendor,admin,id),{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...extra}});
  async function upload({token='token-a',vendor='a',admin=false,file=pdf(),revision=0,requestId=crypto.randomUUID()}={}){const form=new FormData();form.append('file',file);form.append('expected_revision',String(revision));form.append('request_id',requestId);return handler(new Request(url(vendor,admin),{method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{})},body:form}),admin);}
  return {sqlite,db,bucket,objects,deletes,deps,handler,request,url,upload,race(action){race=action;},close(){sqlite.close();}};
}

test('real multipart upload and authenticated byte download stay private to original applicant and admin',async()=>{
  const f=fixture();try{
    const uploaded=await f.upload();assert.equal(uploaded.status,200);const result=await uploaded.json(),item=result.data.items[0];
    assert.equal(result.data.revision,1);assert.equal(item.original_filename,'合作合約.pdf');assert.equal(f.objects.size,1);
    assert.doesNotMatch(JSON.stringify(result),/storage_key|vendor_private_contract_|portal_token|sha256/);
    const row=f.sqlite.prepare('SELECT * FROM welfare_vendor_private_contracts').get();assert.ok(row.storage_key.startsWith(PRIVATE_CONTRACT_PREFIX));assert.equal(row.actor_type,'vendor');assert.equal(row.uploaded_by,'account-a');
    const downloaded=await f.handler(f.request('GET','token-a','a',false,item.id));assert.equal(downloaded.status,200);assert.equal(await downloaded.text(),'%PDF-1.7\ncontract');
    assert.equal(downloaded.headers.get('Cache-Control'),'private, no-store');assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);assert.match(downloaded.headers.get('Content-Security-Policy'),/sandbox/);assert.equal(downloaded.headers.get('Access-Control-Allow-Origin'),null);
    assert.equal((await f.handler(f.request('GET','token-b','a',false,item.id))).status,403);
    assert.equal((await f.handler(f.request('GET','','a',false,item.id))).status,403);
    assert.equal((await f.handler(new Request(f.url('a',false,item.id)+'&portal_token=token-a'))).status,403);
    const admin=await f.handler(f.request('GET','admin','a',true,item.id),true);assert.equal(admin.status,200);assert.equal(await admin.text(),'%PDF-1.7\ncontract');
    assert.equal((await f.handler(f.request('GET','viewer','a',true,item.id),true)).status,403);
    assert.equal((await f.handler(f.request('GET','admin-without-vendors','a',true,item.id),true)).status,403);
    assert.equal((await f.handler(f.request('GET','token-a','a',false,item.id,{Origin:'https://evil.test'}))).status,403);
    const head=await f.handler(f.request('HEAD','token-a','a',false,item.id));assert.equal(head.status,200);assert.equal(await head.text(),'');
    const cookie=await f.handler(f.request('GET','','a',false,item.id,{Cookie:'test-cookie'}));assert.equal(cookie.status,200);
  }finally{f.close();}
});

test('old contracts cannot satisfy a new supplement event; new upload proves exact event and survives resubmission',async()=>{
  const f=fixture();try{
    assert.equal(await hasUpdatedVendorContract(f.db,'a',{revision:3,last_event_id:'event-current'}),false);
    await f.upload();assert.equal(await hasUpdatedVendorContract(f.db,'a',{revision:3,last_event_id:'event-current'}),true);
    f.sqlite.exec("UPDATE welfare_vendor_supplements SET revision=4,last_event_id='event-next' WHERE vendor_id='a'");
    assert.equal(await hasUpdatedVendorContract(f.db,'a',{revision:4,last_event_id:'event-next'}),false);
    const second=await f.upload({revision:1,file:pdf('補交.pdf','%PDF-1.7\nupdated')});assert.equal(second.status,200);
    assert.equal(await hasUpdatedVendorContract(f.db,'a',{revision:4,last_event_id:'event-next'}),true);
    f.sqlite.exec("UPDATE welfare_vendors SET status='pending' WHERE id='a';UPDATE welfare_vendor_supplements SET state='pending' WHERE vendor_id='a'");
    const listed=await(await f.handler(f.request())).json();assert.equal(listed.data.items.length,2);assert.equal(f.objects.size,2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendors').get().n,2);assert.equal(f.sqlite.prepare('SELECT previous_document_id FROM welfare_vendor_private_contracts WHERE revision=2').get().previous_document_id,listed.data.items[1].id);
  }finally{f.close();}
});

test('same operation retries do not upload again; conflicting payload and stale revision do not replace contracts',async()=>{
  const f=fixture();try{
    const requestId=crypto.randomUUID();const first=await f.upload({requestId});assert.equal(first.status,200);
    const repeat=await f.upload({requestId});assert.equal(repeat.status,200);assert.equal((await repeat.json()).duplicate,true);assert.equal(f.objects.size,1);
    assert.equal((await f.upload({requestId,file:pdf('different.pdf')})).status,409);
    assert.equal((await f.upload({revision:0})).status,409);assert.equal(f.objects.size,1);
  }finally{f.close();}
});

test('recheck vendor and supplement state atomically before saving an uploaded object',async()=>{
  const f=fixture();try{
    f.race(()=>f.sqlite.exec("UPDATE welfare_vendor_supplements SET revision=4,last_event_id='concurrent-event' WHERE vendor_id='a'"));
    assert.equal((await f.upload()).status,409);assert.equal(f.objects.size,0);assert.equal(f.deletes.length,1);
    f.race(()=>f.sqlite.exec("UPDATE welfare_vendors SET status='suspended' WHERE id='a'"));
    assert.equal((await f.upload()).status,409);assert.equal(f.objects.size,0);
  }finally{f.close();}
});

test('only matching current username can upload and read; anonymous and another vendor cannot store files',async()=>{
  const f=fixture();try{
    for(const token of ['','bad','token-b'])assert.equal((await f.upload({token})).status,403);
    assert.equal((await f.upload({token:'admin',admin:true})).status,200);
    f.sqlite.exec("UPDATE welfare_vendors SET vendor_portal_username='changed' WHERE id='a'");
    assert.equal((await f.handler(f.request())).status,403);assert.equal((await f.upload({revision:1})).status,403);
    assert.equal(f.objects.size,1);
  }finally{f.close();}
});

test('file size, extension, declared MIME and magic bytes are checked before storage',async()=>{
  const f=fixture();try{
    for(const file of [new File(['not-pdf'],'bad.pdf',{type:'application/pdf'}),new File(['%PDF-x'],'bad.html',{type:'text/html'}),new File(['%PDF-x'],'bad.pdf',{type:'text/html'}),new File([],'empty.pdf',{type:'application/pdf'})])assert.equal((await f.upload({file})).status,400);
    assert.equal((await f.upload({file:new File([new Uint8Array(CONTRACT_MAX_BYTES+1)],'large.pdf',{type:'application/pdf'})})).status,413);
    const request=new Request(f.url(),{method:'POST',headers:{Authorization:'Bearer token-a','Content-Type':'multipart/form-data; boundary=x','Content-Length':String(CONTRACT_MAX_BYTES+200000)},body:'x'});assert.equal((await f.handler(request)).status,413);
    assert.equal(f.objects.size,0);
  }finally{f.close();}
});

test('raw file route denies the private prefix and both edit surfaces mount an isolated contract UI',()=>{
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(source,/fileName\.startsWith\("vendor_private_contract_"\)/);
  assert.match(source,/authorizeAdmin: current => authorizeVendorSupplementAdmin\(current, DB, \{ requireAdmin \}\)/);
  assert.match(source,/decorateVendorPrivateContractHtml\(decorateVendorDocumentsHtml\(renderVendorApplyHtml\(\)\)\)/);
  assert.match(source,/decorateVendorPrivateContractHtml\(renderVendorManagementHtml\(\)\)/);
  const html=decorateVendorPrivateContractHtml('<html><head></head><body></body></html>');
  for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  assert.match(html,/form="vendor-private-contract-form"/);assert.match(html,/expected_revision',String\(attempt.expectedRevision\)/);
  assert.doesNotMatch(html,/vendor_private_contract_|storage_key/);
});
