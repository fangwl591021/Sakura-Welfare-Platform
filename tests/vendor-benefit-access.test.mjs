import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleVendorBenefitAccess,activeBenefitEmployee} from '../src/vendor-benefit-access.js';
import {documentFixture,pdf,requestId} from './vendor-public-documents-fixture.mjs';

const UID='U'+'1'.repeat(32), OTHER='U'+'2'.repeat(32), ORIGIN='https://fixture.test';
function fixture(){
  const f=documentFixture();
  const columns=f.sqlite.prepare('PRAGMA table_info(welfare_members)').all().map(x=>x.name);
  if(!columns.includes('bind_status'))f.sqlite.exec("ALTER TABLE welfare_members ADD COLUMN bind_status TEXT DEFAULT 'unbound'");
  f.sqlite.prepare("INSERT INTO welfare_members(id,line_user_id,display_name,member_type,status,bind_status) VALUES('emp',?,'Employee','employee','active','bound'),('guest',?,'Visitor','visitor','active','unbound')").run(UID,OTHER);
  const env={...f.env,LINE_CHANNEL_SECRET:'isolated-test-secret'}, deps={readVendorPortalCookie:()=>null,verifyVendorPortalToken:f.context.verifyVendorPortalToken,requireAdmin:async({sessionToken})=>sessionToken==='admin'?{ok:true,user:{role:'admin'}}:{ok:false},liffId:'123-fixture',verifyLine:async(_env,token)=>token==='employee'?{lineUserId:UID}:token==='visitor'?{lineUserId:OTHER}:null,ensureBinding:async()=>{}};
  let calls=0;
  const next=async request=>{
    calls++;
    const url=new URL(request.url);
    if(url.pathname==='/api/vendor-store/documents')return f.handler(request);
    if(url.pathname.startsWith('/vendor-document/'))return f.download(url.pathname.split('/').pop(),url.search);
    if(url.pathname==='/api/vendor-store')return Response.json(await f.context.getVendorStorefront(f.db,url,env));
    if(url.pathname==='/api/member-app')return Response.json({success:true,data:{queriedUID:url.searchParams.get('line_user_id'),offers:[{employee_price:88}],redemptions:[]}});
    return Response.json({success:true,stores:[{name:'Public name',address:'Public address',discountPolicy:'EMPLOYEE_SECRET',employee_price:88}],locations:[{offerTitle:'EMPLOYEE_SECRET',offerSummary:'EMPLOYEE_SECRET'}],flex:{text:'EMPLOYEE_SECRET'}});
  };
  const run=(path,headers={},method='GET')=>handleVendorBenefitAccess(new Request(ORIGIN+path,{method,headers}),env,deps,next);
  const session=async token=>{const response=await run('/api/vendor-benefits/session',{'X-Line-Id-Token':token},'POST');return{response,body:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};};
  return {...f,env,deps,run,session,calls:()=>calls};
}

for(const role of ['employee','foreign_employee','manager'])test('only active bound employee class is eligible: '+role,()=>{
  assert.equal(activeBenefitEmployee({member_type:role,status:'active',bind_status:'bound'}),true);
  for(const status of ['inactive','suspended',''])assert.equal(activeBenefitEmployee({member_type:role,status,bind_status:'bound'}),false);
  assert.equal(activeBenefitEmployee({member_type:role,status:'active',bind_status:'unbound'}),false);
});
for(const role of ['visitor','admin','vendor_approved','employee_pending'])test('other role is not employee proof: '+role,()=>assert.equal(activeBenefitEmployee({member_type:role,status:'active',bind_status:'bound'}),false));

for(const path of ['/api/partner-stores','/api/featured-partner-stores','/api/vendor-directory','/api/vendor-nearby'])test('public endpoint strips benefits but keeps store basics: '+path,async()=>{
  const f=fixture();try{const r=await f.run(path+'?uid='+UID+'&member_type=employee&demo=1');const data=await r.json();assert.equal(data.stores[0].name,'Public name');assert.equal(data.employeeBenefits,false);assert.doesNotMatch(JSON.stringify(data),/EMPLOYEE_SECRET|"employee_price":88/);assert.equal(data.flex,undefined);assert.match(r.headers.get('Cache-Control'),/no-store/);assert.match(r.headers.get('Vary'),/Cookie/);}finally{f.close();}
});
test('verified employee sees benefits; verified visitor does not; no request state leaks',async()=>{
 const f=fixture();try{
  const employee=await f.session('employee'),guest=await f.session('visitor');assert.equal(employee.body.employee,true);assert.equal(guest.body.employee,false);assert.match(employee.response.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);
  const results=await Promise.all([f.run('/api/partner-stores',{Cookie:employee.cookie}),f.run('/api/partner-stores',{Cookie:guest.cookie}),f.run('/api/partner-stores')]);
  assert.match(JSON.stringify(await results[0].json()),/EMPLOYEE_SECRET/);for(const r of results.slice(1))assert.doesNotMatch(JSON.stringify(await r.json()),/EMPLOYEE_SECRET/);
 }finally{f.close();}
});
test('cookie is signed; expired/tampered and invalid ID tokens fail closed',async()=>{
 const f=fixture();try{const {cookie}=await f.session('employee');
  const raw=cookie.split('=')[1],payload=JSON.parse(Buffer.from(raw.split('.')[0],'base64url').toString());payload.exp=1;
  for(const headers of [{Cookie:cookie+'x'},{Cookie:cookie.split('=')[0]+'='+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+raw.split('.')[1]},{Cookie:cookie,'X-Line-Id-Token':'bad'}])assert.equal((await(await f.run('/api/partner-stores',headers)).json()).employeeBenefits,false);
  assert.equal((await f.session('bad')).response.status,403);
 }finally{f.close();}
});
test('suspension or unbinding revokes next request even with previously issued cookie',async()=>{
 const f=fixture();try{const {cookie}=await f.session('employee');for(const sql of ["UPDATE welfare_members SET status='blocked' WHERE id='emp'","UPDATE welfare_members SET status='active',bind_status='unbound' WHERE id='emp'"]){f.sqlite.exec(sql);assert.equal((await(await f.run('/api/partner-stores',{Cookie:cookie})).json()).employeeBenefits,false);}}finally{f.close();}
});
test('store policy and offers are hidden while own merchant editing remains available',async()=>{
 const f=fixture();try{
  const guest=await(await f.run('/api/vendor-store?vendor_id=a')).json();assert.equal(guest.data.vendor.name,'Fixture Store');assert.equal(guest.data.vendor.discount_policy,'');assert.deepEqual(guest.data.offers,[]);assert.equal(guest.data.canEdit,false);
  const employee=await(await f.run('/api/vendor-store?vendor_id=a',{'X-Line-Id-Token':'employee'})).json();assert.equal(employee.data.vendor.discount_policy,'Legacy policy');
  const owner=await(await f.run('/api/vendor-store?vendor_id=a&portal_token=token-a')).json();assert.equal(owner.data.canEdit,true);assert.equal(owner.data.vendor.discount_policy,'Legacy policy');
  const other=await(await f.run('/api/vendor-store?vendor_id=a&portal_token=token-b')).json();assert.equal(other.data.canEdit,false);assert.equal(other.data.vendor.discount_policy,'');
  assert.equal(f.queries.some(sql=>/^\s*(INSERT|UPDATE|CREATE|ALTER|DELETE)\b/i.test(sql)),false);
 }finally{f.close();}
});
test('pending or hidden vendor storefront stays unavailable even for a verified employee',async()=>{
 const f=fixture();try{
  for(const update of ["UPDATE welfare_vendors SET status='pending',is_hidden=0 WHERE id='a'","UPDATE welfare_vendors SET status='approved',is_hidden=1 WHERE id='a'"]){
   f.sqlite.exec(update);
   for(const headers of [{},{'X-Line-Id-Token':'employee'}]){
    const response=await f.run('/api/vendor-store?vendor_id=a',headers);
    assert.equal(response.status,404);
    const body=await response.json();assert.equal(body.success,false);assert.equal(body.data,undefined);
   }
  }
 }finally{f.close();}
});
test('published document names and direct GET/HEAD require employee or scoped operator',async()=>{
 const f=fixture();try{
  const created=await f.mutation({action:'upload',request_id:requestId(),title:'EMPLOYEE_SECRET',status:'published',confirmed:true},pdf());const id=created.data.items[0].id;
  assert.equal((await(await f.run('/api/vendor-store/documents?vendor_id=a')).json()).data.items.length,0);
  const before=f.calls();for(const method of ['GET','HEAD'])assert.equal((await f.run('/vendor-document/'+id,{},method)).status,403);assert.equal(f.calls(),before);
  const {cookie}=await f.session('employee');assert.equal((await f.run('/vendor-document/'+id,{Cookie:cookie})).status,200);
  assert.equal((await f.run('/vendor-document/'+id,{Authorization:'Bearer admin'})).status,200);
  assert.equal((await(await f.run('/api/vendor-store/documents?vendor_id=a&manage=1',{Authorization:'Bearer token-a'})).json()).data.editable,true);
  f.sqlite.exec("UPDATE welfare_members SET status='blocked' WHERE id='emp'");assert.equal((await f.run('/vendor-document/'+id,{Cookie:cookie})).status,403);
 }finally{f.close();}
});
test('member app ignores claimed UID and never creates a demo member for anonymous reads',async()=>{
 const f=fixture();try{const before=f.calls();const anon=await(await f.run('/api/member-app?uid='+UID+'&demo=1')).json();assert.equal(anon.employeeBenefits,false);assert.deepEqual(anon.data.offers,[]);assert.equal(f.calls(),before);
 const guest=await(await f.run('/api/member-app?uid='+UID+'&demo=1',{'X-Line-Id-Token':'visitor'})).json();assert.equal(guest.data.queriedUID,OTHER);assert.deepEqual(guest.data.offers,[]);
 }finally{f.close();}
});
test('sync failure returns retryable failure, never employee content; cross-site session rejected',async()=>{
 const f=fixture();try{f.deps.ensureBinding=async()=>{throw new Error('offline');};assert.equal((await f.session('employee')).response.status,503);assert.equal((await f.run('/api/vendor-benefits/session',{'X-Line-Id-Token':'employee',Origin:'https://other.test'},'POST')).status,403);assert.equal((await f.run('/api/vendor-benefits/session',{},'POST')).status,403);}finally{f.close();}
});
test('legacy application read cannot use a guessed owner UID as authentication',async()=>{
 const f=fixture();try{
  f.deps.verifyApplicationSignature=async(_env,id,uid,sig)=>id==='a'&&uid===UID&&sig==='valid-signature';
  assert.equal((await f.run('/api/vendor-apply?vendor_id=a&uid='+UID)).status,403);
  assert.equal((await f.run('/api/vendor-apply?uid='+UID)).status,403);
  assert.equal((await f.run('/api/vendor-apply?vendor_id=a&portal_token=token-b')).status,403);
  assert.equal((await f.run('/api/vendor-apply?vendor_id=a&portal_token=token-a')).status,200);
  assert.equal((await f.run('/api/vendor-apply?vendor_id=a&uid='+UID+'&sig=valid-signature')).status,200);
 }finally{f.close();}
});
test('legacy QR creation needs verified employee and ignores all claimed identity/profile fields',async()=>{
 const f=fixture();try{
  const request=token=>new Request(ORIGIN+'/api/demo-redemption-token',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Line-Id-Token':token}:{})},body:JSON.stringify({LINE_user_id:OTHER,member_type:'employee',demo:true,employee_no:'FAKE',birthday_mmdd:'0101',display_name:'FAKE',offer_id:'offer-a'})});
  let calls=0;const next=async r=>{calls++;return Response.json(await r.json());};
  for(const token of ['', 'visitor','invalid'])assert.equal((await handleVendorBenefitAccess(request(token),f.env,f.deps,next)).status,403);
  assert.equal(calls,0);const employee=await handleVendorBenefitAccess(request('employee'),f.env,f.deps,next);assert.deepEqual(await employee.json(),{offer_id:'offer-a',LINE_user_id:UID});
  const oversized=new Request(ORIGIN+'/api/demo-redemption-token',{method:'POST',body:'x'.repeat(17000)});assert.equal((await handleVendorBenefitAccess(oversized,f.env,f.deps,next)).status,413);
 }finally{f.close();}
});
test('legacy token preview requires the employee owner or its merchant; redemption requires merchant',async()=>{
 const f=fixture();try{
  f.sqlite.exec('CREATE TABLE welfare_redemption_tokens(token TEXT,vendor_id TEXT,line_user_id TEXT)');f.sqlite.prepare("INSERT INTO welfare_redemption_tokens VALUES('fixture-token','a',?)").run(UID);
  assert.equal((await f.run('/api/demo-redemption-token?token=fixture-token')).status,403);
  assert.equal((await f.run('/api/demo-redemption-token?token=fixture-token',{'X-Line-Id-Token':'visitor'})).status,403);
  assert.equal((await f.run('/api/demo-redemption-token?token=fixture-token',{'X-Line-Id-Token':'employee'})).status,200);
  const request=new Request(ORIGIN+'/api/demo-redeem',{method:'POST',body:JSON.stringify({token:'fixture-token'})});assert.equal((await handleVendorBenefitAccess(request,f.env,f.deps,()=>Response.json({success:true}))).status,403);
 }finally{f.close();}
});
test('direct carousel/showcase URLs require eligibility; draft and pending previews remain merchant-scoped',async()=>{
 const f=fixture();try{
  f.sqlite.exec("CREATE TABLE welfare_vendor_carousel_items(storage_key TEXT,vendor_id TEXT,status TEXT);CREATE TABLE welfare_vendor_showcase_assets(storage_key TEXT,vendor_id TEXT,status TEXT);INSERT INTO welfare_vendor_carousel_items VALUES('vendor_carousel_fixture','a','active');INSERT INTO welfare_vendor_showcase_assets VALUES('vendor_showcase_fixture','a','draft');");
  f.deps.readVendorPortalCookie=request=>({portal_token:request.headers.get('Cookie')==='owner-a'?'token-a':request.headers.get('Cookie')==='owner-b'?'token-b':''});
  for(const path of ['/file/vendor_carousel_fixture','/file/vendor_showcase_fixture','/file/%76endor_carousel_fixture'])assert.equal((await f.run(path)).status,403);
  assert.equal((await f.run('/file/vendor_carousel_fixture',{'X-Line-Id-Token':'employee'})).status,200);
  assert.equal((await f.run('/file/vendor_showcase_fixture',{'X-Line-Id-Token':'employee'})).status,403);
  assert.equal((await f.run('/file/vendor_showcase_fixture',{Cookie:'owner-a'})).status,200);
  assert.equal((await f.run('/file/vendor_showcase_fixture',{Cookie:'owner-b'})).status,403);
  f.sqlite.exec("UPDATE welfare_vendors SET status='pending' WHERE id='a'");assert.equal((await f.run('/file/vendor_carousel_fixture',{'X-Line-Id-Token':'employee'})).status,403);assert.equal((await f.run('/file/vendor_carousel_fixture',{Cookie:'owner-a'})).status,200);
  f.sqlite.exec("UPDATE welfare_vendors SET is_hidden=1 WHERE id='a'");assert.equal((await f.run('/file/vendor_carousel_fixture',{Cookie:'owner-a'})).status,404);
 }finally{f.close();}
});
