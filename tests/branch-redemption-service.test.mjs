import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { handleBranchRedemptionRequest,readCheckoutBranch } from '../src/branch-redemption-service.js';

const employee='U'+'1'.repeat(32),visitor='U'+'2'.repeat(32),outsider='U'+'3'.repeat(32);
const migration=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function fixture(t){
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  sql.exec(migration('0008_sakura_welfare_core.sql'));sql.exec(migration('0010_welfare_operations.sql'));sql.exec(migration('0030_vendor_pos_discounts.sql'));
  sql.exec(`ALTER TABLE welfare_vendors ADD COLUMN is_hidden INTEGER DEFAULT 0;
    ALTER TABLE welfare_vendors ADD COLUMN contract_end TEXT DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN contract_terminated_at TEXT DEFAULT '';
    ALTER TABLE welfare_vendor_locations ADD COLUMN status TEXT DEFAULT 'active';
    ALTER TABLE welfare_members ADD COLUMN bind_status TEXT DEFAULT '';
    INSERT INTO welfare_vendors(id,name,status)VALUES('a','Test Vendor A','approved'),('b','Test Vendor B','approved');
    INSERT INTO welfare_vendor_locations(id,vendor_id,branch_name,address)VALUES('a1','a','A One','Addr1'),('a2','a','A Two','Addr2'),('b1','b','B One','Addr3');`);
  sql.prepare("INSERT INTO welfare_members(id,line_user_id,member_type,display_name,bind_status) VALUES('member1',?,'employee','Name Employee','bound')").run(employee);
  sql.exec(migration('0047_branch_redemptions.sql'));
  sql.exec(migration('0035_employee_roster.sql'));
  const f={sql,beforeBatch:null,failAt:-1,writes:[],syncs:[],reads:[]};
  const db={prepare(statement){return{statement,args:[],bind(...args){this.args=args;return this;},
    async first(){f.reads.push(statement);return sql.prepare(statement).get(...this.args)||null;},async all(){f.reads.push(statement);return{results:sql.prepare(statement).all(...this.args)};},
    async run(){f.writes.push(statement);const r=sql.prepare(statement).run(...this.args);return{success:true,meta:{changes:Number(r.changes)}};}};},
    async batch(statements){if(f.beforeBatch){const fn=f.beforeBatch;f.beforeBatch=null;await fn();}
      let results;sql.exec('BEGIN');try{results=statements.map((s,i)=>{if(i===f.failAt)throw new Error('Injected batch failure');f.writes.push(s.statement);const r=sql.prepare(s.statement).run(...s.args);return{success:true,meta:{changes:Number(r.changes)}};});sql.exec('COMMIT');}
      catch(error){sql.exec('ROLLBACK');throw error;}
      if(f.loseAfterCommit){f.loseAfterCommit=false;throw new Error('Injected lost commit response');}return results;}
  };
  f.db=db;f.deps={verifyIdentity:async(_env,token)=>token==='employee-token'?{lineUserId:employee,displayName:'LINE Employee'}:token==='visitor-token'?{lineUserId:visitor,displayName:'LINE Visitor'}:token==='outsider-token'?{lineUserId:outsider,displayName:'Another'}:null,
    syncIdentity:async(_db,_env,uid)=>{f.syncs.push(uid);},readCookie:()=>null,
    authorize:async(_db,_env,id,{portalToken})=>({success:portalToken==='token-'+id&&['a','b'].includes(id)})};
  f.call=async(body={},merchant=false,method='POST',query='')=>{const response=await handleBranchRedemptionRequest(new Request('https://fixture.test'+(merchant?'/api/vendor-pos/branch-redemptions':'/api/branch-redemption')+query,{method,...(method==='POST'?{body:JSON.stringify(body)}:{})}),db,{},f.deps);return{status:response.status,...await response.json(),headers:response.headers};};
  f.count=table=>sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  return f;
}
const startBody=(extra={})=>({action:'initiate',location_id:'a1',original_price:100,id_token:'employee-token',request_id:randomUUID(),pos_revision:'default',pos_member_type:'employee',...extra});
async function start(f,extra={}){const body=startBody(extra),result=await f.call(body);assert.equal(result.status,200,JSON.stringify(result));return{body,result};}
const confirmBody=(body,extra={})=>({action:'confirm',vendor_id:'a',portal_token:'token-a',request_id:body.request_id,confirmed:true,
  location_id:body.location_id,original_price:body.original_price,payable_price:body.pos_member_type==='employee'?80:90,pos_member_type:body.pos_member_type,pos_revision:body.pos_revision,...extra});

test('public branch lookup is read-only, exact and excludes unavailable branches/contracts',async t=>{
  const f=fixture(t);assert.deepEqual(await readCheckoutBranch(f.db,'a1'),{vendorId:'a',vendorName:'Test Vendor A',locationId:'a1',branchName:'A One',address:'Addr1'});
  assert.equal((await f.call({},false,'GET','?location_id=a1')).status,200);assert.equal(f.writes.length,0);
  for(const statement of ["UPDATE welfare_vendor_locations SET status='pending' WHERE id='a1'","UPDATE welfare_vendor_locations SET status='active' WHERE id='a1';UPDATE welfare_vendors SET is_hidden=1 WHERE id='a'","UPDATE welfare_vendors SET is_hidden=0,status='suspended' WHERE id='a'","UPDATE welfare_vendors SET status='approved',contract_end='2000-01-01' WHERE id='a'","UPDATE welfare_vendors SET contract_end='',contract_terminated_at='now' WHERE id='a'"]){f.sql.exec(statement);await assert.rejects(readCheckoutBranch(f.db,'a1'),e=>e.status===404);}
  await assert.rejects(readCheckoutBranch(f.db,'missing'),e=>e.status===404);
});
test('server quote derives UID/member/discount and never creates a real redemption or guest member',async t=>{
  const f=fixture(t);const q=await f.call({action:'quote',id_token:'employee-token',location_id:'a1',original_price:100,line_user_id:visitor,payable_price:1,member_type:'visitor'});
  assert.equal(q.status,200);assert.equal(q.data.memberType,'employee');assert.equal(q.data.payable,80);assert.equal(q.data.memberName,'LINE Employee');
  const v=await f.call({action:'quote',id_token:'visitor-token',location_id:'a1',original_price:100});assert.equal(v.data.payable,90);
  assert.equal(f.count('welfare_members'),1);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_offers'),0);assert.equal(f.count('welfare_branch_redemption_requests'),0);
  assert.match(q.headers.get('cache-control'),/no-store/);
});
test('invalid identity, spoofed UID, foreign origins and excessive requests cannot write',async t=>{
  const f=fixture(t);
  assert.equal((await f.call(startBody({id_token:'fake',line_user_id:employee}))).status,401);
  for(const original_price of [0,1.2,-1,10000001,'100',null])assert.equal((await f.call(startBody({original_price}))).status,400);
  const origin=new Request('https://fixture.test/api/branch-redemption',{method:'POST',headers:{Origin:'https://evil.test'},body:JSON.stringify(startBody())});
  assert.equal((await handleBranchRedemptionRequest(origin,f.db,{},f.deps)).status,403);
  const large=new Request('https://fixture.test/api/branch-redemption',{method:'POST',body:'x'.repeat(20000)});assert.equal((await handleBranchRedemptionRequest(large,f.db,{},f.deps)).status,400);
  assert.equal(f.writes.length,0);
});
test('initiation is pending only and same-key or repeated scanner requests reuse one transaction',async t=>{
  const f=fixture(t),{body,result}=await start(f);assert.equal(result.data.status,'pending');
  assert.equal((await f.call(body)).data.id,body.request_id);
  assert.equal((await f.call({...body,request_id:randomUUID()})).data.id,body.request_id);
  assert.equal(f.count('welfare_branch_redemption_requests'),1);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_offers'),0);assert.equal(f.count('welfare_audit_events'),1);
  assert.equal((await f.call({...body,original_price:200})).status,409);
  assert.equal((await f.call({...body,location_id:'a2'})).status,409);
  assert.equal((await f.call({...body,id_token:'outsider-token'})).status,404);
});
test('customer can read only own status and cannot confirm; merchant cannot inspect/confirm foreign vendor',async t=>{
  const f=fixture(t),{body}=await start(f);
  assert.equal((await f.call({action:'status',request_id:body.request_id,id_token:'outsider-token'})).status,404);
  assert.equal((await f.call({action:'confirm',request_id:body.request_id,id_token:'employee-token'})).status,400);
  assert.equal((await f.call(confirmBody(body,{portal_token:''}),true)).status,403);
  assert.equal((await f.call(confirmBody(body,{vendor_id:'b',portal_token:'token-b'}),true)).status,404);
  const list=await f.call({},true,'GET','?vendor_id=b&portal_token=token-b');assert.equal(list.data.requests.length,0);
  assert.equal((await f.call({},true,'GET','?vendor_id=a&portal_token=token-a&location_id=b1')).status,404);
  assert.equal(f.count('welfare_redemptions'),0);
});
test('merchant confirms one immutable branch transaction; sequential and simultaneous retries return same ledger',async t=>{
  const f=fixture(t),{body}=await start(f),payload=confirmBody(body);
  const results=await Promise.all([f.call(payload,true),f.call(payload,true),f.call(payload,true)]);
  for(const r of results){assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.status,'confirmed');assert.equal(r.data.redemptionId,'pos:a:'+body.request_id);}
  assert.equal((await f.call(payload,true)).duplicated,true);
  assert.equal(f.count('welfare_redemptions'),1);assert.equal(f.count('welfare_offers'),1);assert.equal(f.count('welfare_audit_events'),2);
  assert.equal(f.sql.prepare('SELECT status FROM welfare_offers').get().status,'archived');
  const ledger=f.sql.prepare('SELECT * FROM welfare_redemptions').get();assert.equal(ledger.location_id,'a1');assert.equal(ledger.line_user_id,employee);assert.equal(ledger.payable_price,80);assert.equal(ledger.point_change,0);assert.equal(ledger.qr_token,'branch:a1:'+body.request_id);
  assert.equal((await f.call({action:'status',request_id:body.request_id,id_token:'employee-token'})).data.status,'confirmed');
});
test('visitor member creation is deferred until confirmed and does not change existing employees',async t=>{
  const f=fixture(t),{body}=await start(f,{id_token:'visitor-token',pos_member_type:'visitor'});
  assert.equal(f.count('welfare_members'),1);
  const r=await f.call(confirmBody(body),true);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.payable,90);assert.equal(f.count('welfare_members'),2);
  const member=f.sql.prepare('SELECT * FROM welfare_members WHERE line_user_id=?').get(visitor);assert.equal(member.member_type,'visitor');assert.equal(member.bind_status,'unbound');
  assert.equal(f.sql.prepare("SELECT member_type FROM welfare_members WHERE id='member1'").get().member_type,'employee');
});
test('cancelled and rejected requests cannot be confirmed and preserve all ledger history',async t=>{
  const f=fixture(t),{body}=await start(f);
  assert.equal((await f.call({action:'cancel',id_token:'employee-token',request_id:body.request_id})).data.status,'cancelled');
  assert.equal((await f.call(confirmBody(body),true)).status,409);
  const next=await start(f);assert.equal((await f.call(confirmBody(next.body,{action:'reject'}),true)).data.status,'rejected');
  assert.equal((await f.call(confirmBody(next.body),true)).status,409);assert.equal(f.count('welfare_redemptions'),0);
});
test('expiry is visible and blocks confirmation; next scan may create a new pending request',async t=>{
  const f=fixture(t),{body}=await start(f);f.sql.prepare("UPDATE welfare_branch_redemption_requests SET expires_at='2000-01-01 00:00:00' WHERE id=?").run(body.request_id);
  assert.equal((await f.call({action:'status',id_token:'employee-token',request_id:body.request_id})).data.status,'expired');assert.equal((await f.call(confirmBody(body),true)).code,'request_expired');
  const next=await start(f);assert.notEqual(next.body.request_id,body.request_id);assert.equal(f.count('welfare_redemptions'),0);
});
test('missing confirmation and stale/tampered merchant amount/location/member snapshot fail closed',async t=>{
  const f=fixture(t),{body}=await start(f);
  for(const extra of [{confirmed:false},{original_price:101},{payable_price:1},{location_id:'a2'},{pos_member_type:'visitor'},{pos_revision:'wrong'}])assert.notEqual((await f.call(confirmBody(body,extra),true)).status,200);
  assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_offers'),0);
});
test('quote/member changes before staff review cannot silently alter customer price',async t=>{
  const f=fixture(t),{body}=await start(f);
  f.sql.exec("INSERT INTO welfare_vendor_pos_discounts VALUES('a',70,90,'new','now')");assert.equal((await f.call(confirmBody(body),true)).code,'quote_changed');
  f.sql.exec("DELETE FROM welfare_vendor_pos_discounts;UPDATE welfare_members SET bind_status='unbound' WHERE id='member1'");assert.equal((await f.call(confirmBody(body),true)).code,'quote_changed');assert.equal(f.count('welfare_redemptions'),0);
});
test('atomic SQL guard blocks vendor/location/member/policy races after preflight',async t=>{
  for(const mutate of ["UPDATE welfare_vendors SET status='suspended' WHERE id='a'","UPDATE welfare_vendors SET is_hidden=1 WHERE id='a'","UPDATE welfare_vendors SET contract_end='2000-01-01' WHERE id='a'","UPDATE welfare_vendors SET contract_terminated_at='now' WHERE id='a'","UPDATE welfare_vendor_locations SET status='pending' WHERE id='a1'","UPDATE welfare_vendor_locations SET vendor_id='b' WHERE id='a1'","UPDATE welfare_members SET status='inactive' WHERE id='member1'","UPDATE welfare_members SET bind_status='unbound' WHERE id='member1'","INSERT INTO welfare_vendor_pos_discounts VALUES('a',70,90,'race','now')"]){
    const f=fixture(t),{body}=await start(f);f.beforeBatch=()=>f.sql.exec(mutate);const result=await f.call(confirmBody(body),true);
    assert.equal(result.status,409,mutate+JSON.stringify(result));assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_offers'),0);assert.equal(f.sql.prepare('SELECT status FROM welfare_branch_redemption_requests').get().status,'pending');
  }
});
test('each injected confirmation write failure rolls back claim/member/offer/ledger/audit, retry succeeds',async t=>{
  for(let index=0;index<5;index++){
    const f=fixture(t),{body}=await start(f,{id_token:'visitor-token',pos_member_type:'visitor'});f.failAt=index;
    assert.equal((await f.call(confirmBody(body),true)).status,503);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_offers'),0);assert.equal(f.count('welfare_members'),1);assert.equal(f.count('welfare_audit_events'),1);
    assert.equal(f.sql.prepare('SELECT status FROM welfare_branch_redemption_requests').get().status,'pending');f.failAt=-1;assert.equal((await f.call(confirmBody(body),true)).status,200);
  }
});
test('ledger collision rolls back and cannot be treated as this branch transaction',async t=>{
  const f=fixture(t),{body}=await start(f);f.sql.exec("INSERT INTO welfare_offers(id,vendor_id,title,status) VALUES('existing','a','Existing offer','approved')");
  f.sql.prepare("INSERT INTO welfare_redemptions(id,offer_id,vendor_id,member_id,line_user_id,original_price,payable_price) VALUES(?,'existing','a','member1',?,100,80)").run('pos:a:'+body.request_id,employee);
  assert.equal((await f.call(confirmBody(body),true)).status,503);assert.equal(f.count('welfare_redemptions'),1);assert.equal(f.sql.prepare('SELECT status FROM welfare_branch_redemption_requests').get().status,'pending');
});
test('existing unrelated approved offer is preserved and internal offer never becomes public',async t=>{
  const f=fixture(t);f.sql.exec("INSERT INTO welfare_offers(id,vendor_id,title,status,original_price,employee_price,visitor_price)VALUES('promotion','a','Promotion','approved',500,200,300)");
  const {body}=await start(f);assert.equal((await f.call(confirmBody(body),true)).status,200);
  assert.equal(f.sql.prepare('SELECT offer_id FROM welfare_redemptions').get().offer_id,'branch-walkin:a');
  const publicOffers=f.sql.prepare("SELECT id FROM welfare_offers WHERE status='approved'").all();assert.deepEqual(publicOffers.map(r=>r.id),['promotion']);
  assert.equal(f.sql.prepare("SELECT original_price FROM welfare_offers WHERE id='promotion'").get().original_price,500);
});
test('reserved internal offer collision never repurposes an unrelated record',async t=>{
  const f=fixture(t),{body}=await start(f);f.sql.exec("INSERT INTO welfare_offers(id,vendor_id,title,status)VALUES('branch-walkin:a','b','Unrelated','approved')");
  assert.equal((await f.call(confirmBody(body),true)).status,409);assert.equal(f.count('welfare_redemptions'),0);
  assert.equal(f.sql.prepare("SELECT vendor_id FROM welfare_offers WHERE id='branch-walkin:a'").get().vendor_id,'b');
});
test('merchant status recovers a successful confirmation without writing or confirming again',async t=>{
  const f=fixture(t),{body}=await start(f);await f.call(confirmBody(body),true);const writes=f.writes.length;
  const result=await f.call({action:'status',vendor_id:'a',portal_token:'token-a',request_id:body.request_id},true);
  assert.equal(result.data.status,'confirmed');assert.equal(result.data.redemptionId,'pos:a:'+body.request_id);assert.equal(f.writes.length,writes);
  assert.equal((await f.call({action:'status',vendor_id:'b',portal_token:'token-b',request_id:body.request_id},true)).status,404);
});
test('different amount pending recovery returns only the authenticated owner existing request',async t=>{
  const f=fixture(t),{body}=await start(f);
  const result=await f.call(startBody({original_price:200}));assert.equal(result.status,409);assert.equal(result.code,'pending_request_exists');assert.equal(result.data.id,body.request_id);assert.equal(result.data.original,100);
  assert.equal('lineUserId' in result.data,false);assert.equal(f.count('welfare_branch_redemption_requests'),1);
});
test('concurrent initiation with same UUID and conflicting immutable snapshot cannot audit wrong payload',async t=>{
  const f=fixture(t),body=startBody();
  const results=await Promise.all([f.call(body),f.call({...body,location_id:'a2',original_price:200})]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
  assert.equal(f.count('welfare_branch_redemption_requests'),1);assert.equal(f.count('welfare_audit_events'),1);
  const row=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests').get(),audit=JSON.parse(f.sql.prepare('SELECT raw_json FROM welfare_audit_events').get().raw_json);
  assert.equal(audit.location_id,row.location_id);assert.equal(audit.original,row.original_price);assert.equal(audit.payable,row.payable_price);
});
test('concurrent new request UUIDs return the same canonical pending request and one audit',async t=>{
  const f=fixture(t),results=await Promise.all([f.call(startBody()),f.call(startBody()),f.call(startBody())]);
  for(const r of results)assert.equal(r.status,200,JSON.stringify(r));assert.equal(new Set(results.map(r=>r.data.id)).size,1);
  assert.equal(f.count('welfare_branch_redemption_requests'),1);assert.equal(f.count('welfare_audit_events'),1);
});
test('simultaneous cancel and confirm has exactly one terminal outcome, never a ghost ledger',async t=>{
  const f=fixture(t),{body}=await start(f);
  const results=await Promise.all([f.call(confirmBody(body),true),f.call({action:'cancel',id_token:'employee-token',request_id:body.request_id})]);
  const row=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests').get();assert.ok(['confirmed','cancelled'].includes(row.status));
  assert.equal(f.count('welfare_redemptions'),row.status==='confirmed'?1:0);assert.ok(results.some(r=>r.status===200));
});
test('same revision amount-policy race is still blocked by atomic fold comparison',async t=>{
  const f=fixture(t);f.sql.exec("INSERT INTO welfare_vendor_pos_discounts VALUES('a',80,90,'original','now')");const {body}=await start(f,{pos_revision:'original'});
  f.beforeBatch=()=>f.sql.exec("UPDATE welfare_vendor_pos_discounts SET employee_tenths=70 WHERE vendor_id='a'");
  assert.equal((await f.call(confirmBody(body),true)).status,409);assert.equal(f.count('welfare_redemptions'),0);
});
test('an employee appearing after visitor preflight prevents stale visitor confirmation and no member overwrite',async t=>{
  const f=fixture(t),{body}=await start(f,{id_token:'visitor-token',pos_member_type:'visitor'});
  f.beforeBatch=()=>f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,member_type,bind_status,display_name)VALUES('newemployee',?,'employee','bound','Real employee')").run(visitor);
  assert.equal((await f.call(confirmBody(body),true)).status,409);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.sql.prepare("SELECT member_type FROM welfare_members WHERE id='newemployee'").get().member_type,'employee');
});
test('landing profile returns only verified LINE name and unchanged transaction eligibility with no roster lookup or writes',async t=>{
  const f=fixture(t);f.sql.exec("UPDATE welfare_members SET employee_no='001234' WHERE id='member1';INSERT INTO employee_roster(employee_no,employee_name,department_name)VALUES('001234','Official Name','Production Dept'),('009999','Another Employee','Private Dept')");
  f.deps.syncIdentity=()=>{throw new Error('Profile must not sync');};
  const result=await f.call({action:'profile',id_token:'employee-token',line_user_id:outsider,employee_no:'009999',original_price:999});
  assert.equal(result.status,200);assert.deepEqual(result.data,{lineName:'LINE Employee',canTransact:true});
  assert.deepEqual(f.reads,['SELECT status FROM welfare_members WHERE line_user_id=?']);
  assert.equal(f.writes.length,0);assert.equal(f.syncs.length,0);assert.equal(f.count('welfare_members'),1);assert.equal(f.count('welfare_branch_redemption_requests'),0);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_offers'),0);
  assert.doesNotMatch(JSON.stringify(result.data),/employee|department|memberType|bindStatus|memberStatus|source|lineUserId|line_user_id|birthday|phone|009999|Private Dept/);
  assert.match(result.headers.get('cache-control'),/no-store/);
});
test('unknown and unbound landing profiles expose only LINE name and ignore supplied employee metadata',async t=>{
  const f=fixture(t);f.sql.exec("INSERT INTO employee_roster(employee_no,employee_name,department_name)VALUES('001234','LINE Visitor','Secret Dept');UPDATE welfare_members SET employee_no='001234',bind_status='unbound' WHERE id='member1'");
  const missing=await f.call({action:'profile',id_token:'visitor-token',employee_no:'001234',employeeName:'LINE Visitor'});
  assert.deepEqual(missing.data,{lineName:'LINE Visitor',canTransact:true});
  const unbound=await f.call({action:'profile',id_token:'employee-token'});assert.deepEqual(unbound.data,{lineName:'LINE Employee',canTransact:true});
  assert.ok(f.reads.every(query=>query==='SELECT status FROM welfare_members WHERE line_user_id=?'));
  assert.equal(f.writes.length,0);assert.equal(f.syncs.length,0);
});
test('known visitor and inactive employee expose no status metadata while preserving the existing transaction gate',async t=>{
  const f=fixture(t);f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,member_type,bind_status,status)VALUES('visitor',?,'visitor','unbound','active')").run(visitor);
  const known=await f.call({action:'profile',id_token:'visitor-token'});assert.deepEqual(known.data,{lineName:'LINE Visitor',canTransact:true});
  f.sql.exec("UPDATE welfare_members SET employee_no='001234',status='blocked' WHERE id='member1';INSERT INTO employee_roster(employee_no,employee_name)VALUES('001234','Staff Name')");
  const blocked=await f.call({action:'profile',id_token:'employee-token'});assert.deepEqual(blocked.data,{lineName:'LINE Employee',canTransact:false});
  f.sql.exec("UPDATE welfare_members SET status='inactive' WHERE id='member1'");
  const inactive=await f.call({action:'profile',id_token:'employee-token'});assert.deepEqual(inactive.data,{lineName:'LINE Employee',canTransact:false});
  assert.ok(f.reads.every(query=>query==='SELECT status FROM welfare_members WHERE line_user_id=?'));
  assert.equal(f.writes.length,0);assert.equal(f.syncs.length,0);
});
test('profile does not depend on or read the employee roster even for ambiguous employee numbers',async t=>{
  const f=fixture(t);f.sql.exec("UPDATE welfare_members SET employee_no='001234' WHERE id='member1';INSERT INTO employee_roster(employee_no,employee_name,department_name)VALUES('001234','Do not expose','Private Dept')");
  f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,member_type,employee_no,bind_status)VALUES('conflict',?,'employee','001234','bound')").run(outsider);
  f.sql.exec('DROP TABLE employee_roster');
  const result=await f.call({action:'profile',id_token:'employee-token'});assert.equal(result.status,200);assert.deepEqual(result.data,{lineName:'LINE Employee',canTransact:true});
  assert.deepEqual(f.reads,['SELECT status FROM welfare_members WHERE line_user_id=?']);assert.equal(f.writes.length,0);assert.equal(f.syncs.length,0);
});
test('profile requires server-verified LINE identity and cannot downgrade verification/database failures into guessed data',async t=>{
  const f=fixture(t);assert.equal((await f.call({action:'profile',id_token:'fake',line_user_id:employee})).status,401);
  f.deps.verifyIdentity=async()=>({lineUserId:'not-line-uid',displayName:'Forged'});assert.equal((await f.call({action:'profile',id_token:'invalid'})).status,401);
  f.deps.verifyIdentity=async()=>({lineUserId:employee,displayName:'Verified'});f.sql.exec('DROP TABLE welfare_members');
  assert.equal((await f.call({action:'profile',id_token:'verified'})).status,503);assert.equal(f.writes.length,0);assert.equal(f.syncs.length,0);
});

const submitBody=(extra={})=>startBody({action:'submit',confirmed:true,payable_price:80,...extra});

test('customer submit atomically completes the existing ledger without staff confirmation or a pending row',async t=>{
  const f=fixture(t),body=submitBody({line_user_id:outsider,member_type:'admin',discount_amount:99});
  const result=await f.call(body);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'confirmed');
  assert.equal(result.data.redemptionId,'pos:a:'+body.request_id);assert.equal(result.duplicated,false);assert.equal('lineUserId' in result.data,false);
  assert.equal(f.count('welfare_branch_redemption_requests'),1);assert.equal(f.count('welfare_redemptions'),1);assert.equal(f.count('welfare_audit_events'),1);
  const request=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests').get();
  assert.equal(request.confirmed_by,'customer:'+employee);assert.ok(request.confirmation_key);assert.ok(request.confirmed_at);
  const ledger=f.sql.prepare('SELECT * FROM welfare_redemptions').get();
  assert.equal(ledger.line_user_id,employee);assert.equal(ledger.member_id,'member1');assert.equal(ledger.member_type,'employee');assert.equal(ledger.location_id,'a1');
  assert.equal(ledger.original_price,100);assert.equal(ledger.payable_price,80);assert.equal(ledger.discount_amount,20);assert.equal(ledger.point_change,0);
  assert.equal(ledger.qr_token,'branch:a1:'+body.request_id);assert.equal(ledger.offer_id,'branch-walkin:a');assert.equal(ledger.cashier_line_user_id,'');
  const audit=f.sql.prepare('SELECT * FROM welfare_audit_events').get();assert.equal(audit.event_type,'branch.redemption.submit');assert.equal(audit.actor_type,'member');assert.equal(audit.actor_id,employee);
  assert.equal((await f.call({},true,'GET','?vendor_id=a&portal_token=token-a')).data.requests.length,0);
  assert.equal((await f.call({action:'cancel',id_token:'employee-token',request_id:body.request_id})).code,'already_confirmed');assert.equal(f.count('welfare_redemptions'),1);
});

test('customer submit validates explicit consent, verified identity, amounts and current preview before writes',async t=>{
  const f=fixture(t);
  for(const extra of [{confirmed:false},{confirmed:undefined},{id_token:'fake'},{request_id:'invalid'},{original_price:'100'},{original_price:0},{original_price:1.5},{original_price:10000001},{payable_price:1},{payable_price:'80'},{payable_price:undefined},{pos_revision:'stale'},{pos_member_type:'visitor'}]){
    const result=await f.call(submitBody(extra));assert.notEqual(result.status,200,JSON.stringify(extra));
  }
  const foreign=new Request('https://fixture.test/api/branch-redemption',{method:'POST',headers:{Origin:'https://another.test'},body:JSON.stringify(submitBody())});
  assert.equal((await handleBranchRedemptionRequest(foreign,f.db,{},f.deps)).status,403);
  assert.equal(f.writes.length,0);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_branch_redemption_requests'),0);
});

test('customer submit same ID sequential/concurrent/reply-loss retries preserve exactly one completion and audit',async t=>{
  const f=fixture(t),body=submitBody();
  const results=await Promise.all([f.call(body),f.call(body),f.call(body),f.call(body)]);
  for(const result of results){assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'confirmed');assert.equal(result.data.redemptionId,'pos:a:'+body.request_id);}
  assert.equal(results.filter(result=>!result.duplicated).length,1);
  const writes=f.writes.length;assert.equal((await f.call(body)).duplicated,true);assert.equal(f.writes.length,writes);
  assert.equal(f.count('welfare_redemptions'),1);assert.equal(f.count('welfare_branch_redemption_requests'),1);assert.equal(f.count('welfare_audit_events'),1);
  const next=submitBody({location_id:'a2'});f.loseAfterCommit=true;const recovered=await f.call(next);
  assert.equal(recovered.status,200,JSON.stringify(recovered));assert.equal(recovered.duplicated,true);assert.equal((await f.call(next)).data.id,next.request_id);
  assert.equal(f.count('welfare_redemptions'),2);assert.equal(f.count('welfare_audit_events'),2);
});

test('customer submit ID conflicts cannot expose or overwrite another user or a different immutable snapshot',async t=>{
  const f=fixture(t),body=submitBody();
  const raced=await Promise.all([f.call(body),f.call({...body,id_token:'visitor-token',pos_member_type:'visitor',payable_price:90})]);
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,404]);assert.equal(f.count('welfare_redemptions'),1);
  const row=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests').get();
  const owner=row.line_user_id===employee?body:{...body,id_token:'visitor-token',pos_member_type:'visitor',payable_price:90};
  for(const extra of [{location_id:'a2'},{original_price:200,payable_price:160},{payable_price:1},{pos_revision:'other'},{pos_member_type:'manager'}])
    assert.equal((await f.call({...owner,...extra})).status,409);
  const alternate=submitBody({location_id:'a2'});
  const outcomes=await Promise.all([f.call(alternate),f.call({...alternate,original_price:200,payable_price:160})]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);assert.equal(f.count('welfare_redemptions'),2);assert.equal(f.count('welfare_audit_events'),2);
});

test('customer submit never promotes an old pending request, including an insert race or a changed amount',async t=>{
  const f=fixture(t),old=await start(f);const before=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests').get();
  for(const body of [submitBody({request_id:old.body.request_id}),submitBody(),submitBody({original_price:180,payable_price:144})]){
    const result=await f.call(body);assert.equal(result.code,'pending_request_exists');assert.equal(result.data.id,old.body.request_id);assert.equal(result.data.original,100);
  }
  assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests').get(),before);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_audit_events'),1);
  await f.call({action:'cancel',request_id:old.body.request_id,id_token:'employee-token'});
  let raced;f.beforeBatch=async()=>{raced=await start(f,{location_id:'a2'});};
  const result=await f.call(submitBody({location_id:'a2'}));assert.equal(result.code,'pending_request_exists');assert.equal(result.data.id,raced.body.request_id);assert.equal(f.count('welfare_redemptions'),0);
});

test('customer submit preserves closed/expired IDs and completed staff transactions without rewriting history',async t=>{
  const f=fixture(t),cancelled=await start(f);await f.call({action:'cancel',id_token:'employee-token',request_id:cancelled.body.request_id});
  const rejected=await start(f);await f.call(confirmBody(rejected.body,{action:'reject'}),true);
  const expired=await start(f);f.sql.prepare("UPDATE welfare_branch_redemption_requests SET expires_at='2000-01-01 00:00:00' WHERE id=?").run(expired.body.request_id);
  const before=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests ORDER BY id').all();
  for(const old of [cancelled,rejected,expired])assert.equal((await f.call(submitBody({request_id:old.body.request_id}))).status,409);
  assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests ORDER BY id').all(),before);assert.equal(f.count('welfare_redemptions'),0);
  const completed=await start(f,{location_id:'a2'});await f.call(confirmBody(completed.body),true);
  const snapshot=f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests WHERE id=?').get(completed.body.request_id),writes=f.writes.length;
  assert.equal((await f.call(submitBody({location_id:'a2',request_id:completed.body.request_id}))).duplicated,true);assert.equal(f.writes.length,writes);
  assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_branch_redemption_requests WHERE id=?').get(completed.body.request_id),snapshot);
  const next=await f.call(submitBody());assert.equal(next.status,200);assert.equal(f.sql.prepare('SELECT status FROM welfare_branch_redemption_requests WHERE id=?').get(expired.body.request_id).status,'pending');
});

test('customer submit rechecks branch, contract, member and same-revision policy inside the atomic insert',async t=>{
  const mutations=["UPDATE welfare_vendor_locations SET status='hidden' WHERE id='a1'","UPDATE welfare_vendors SET is_hidden=1 WHERE id='a'","UPDATE welfare_vendors SET status='suspended' WHERE id='a'","UPDATE welfare_vendors SET contract_end='2000-01-01' WHERE id='a'","UPDATE welfare_vendors SET contract_terminated_at='now' WHERE id='a'","UPDATE welfare_members SET status='inactive'","UPDATE welfare_members SET bind_status='unbound'","UPDATE welfare_vendor_pos_discounts SET employee_tenths=70 WHERE vendor_id='a'","UPDATE welfare_vendor_pos_discounts SET revision='changed' WHERE vendor_id='a'"];
  for(const mutation of mutations)await t.test(mutation,async st=>{
    const f=fixture(st);f.sql.exec("INSERT INTO welfare_vendor_pos_discounts VALUES('a',80,90,'preview','now')");
    f.beforeBatch=()=>f.sql.exec(mutation);const result=await f.call(submitBody({pos_revision:'preview'}));
    assert.equal(result.status,409,JSON.stringify(result));assert.equal(f.count('welfare_branch_redemption_requests'),0);assert.equal(f.count('welfare_redemptions'),0);assert.equal(f.count('welfare_audit_events'),0);assert.equal(f.count('welfare_offers'),0);
  });
});

test('customer visitor completion is atomic and a new employee appearing during submit is not overwritten',async t=>{
  const f=fixture(t),body=submitBody({id_token:'visitor-token',pos_member_type:'visitor',payable_price:90});
  assert.equal((await f.call(body)).data.payable,90);assert.equal(f.count('welfare_members'),2);
  assert.equal(f.sql.prepare('SELECT member_type FROM welfare_members WHERE line_user_id=?').get(visitor).member_type,'visitor');
  const other=submitBody({id_token:'outsider-token',pos_member_type:'visitor',payable_price:90});
  f.beforeBatch=()=>f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,member_type,bind_status)VALUES('other',?,'employee','bound')").run(outsider);
  assert.equal((await f.call(other)).status,409);assert.equal(f.count('welfare_redemptions'),1);
  assert.equal(f.sql.prepare("SELECT member_type FROM welfare_members WHERE id='other'").get().member_type,'employee');
});

test('customer submit rollback at every atomic write leaves no request/member/offer/ledger/audit residue and same ID retry succeeds',async t=>{
  for(let step=0;step<5;step++)await t.test('batch step '+step,async st=>{
    const f=fixture(st),body=submitBody({id_token:'visitor-token',pos_member_type:'visitor',payable_price:90});f.failAt=step;
    assert.equal((await f.call(body)).status,503);assert.equal(f.count('welfare_members'),1);
    for(const table of ['welfare_branch_redemption_requests','welfare_redemptions','welfare_offers','welfare_audit_events'])assert.equal(f.count(table),0,table);
    f.failAt=-1;assert.equal((await f.call(body)).status,200);assert.equal(f.count('welfare_redemptions'),1);assert.equal(f.count('welfare_audit_events'),1);
  });
});

test('customer submit reserved offer and ledger collisions never overwrite or reuse unrelated data',async t=>{
  const f=fixture(t),body=submitBody();f.sql.exec("INSERT INTO welfare_offers(id,vendor_id,title,status)VALUES('branch-walkin:a','b','Unrelated','approved')");
  const original=f.sql.prepare('SELECT * FROM welfare_offers').get();assert.equal((await f.call(body)).status,409);assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_offers').get(),original);
  assert.equal(f.count('welfare_branch_redemption_requests'),0);assert.equal(f.count('welfare_redemptions'),0);
  f.sql.exec("DELETE FROM welfare_offers;INSERT INTO welfare_offers(id,vendor_id,title,status)VALUES('legacy','a','Legacy','approved')");
  f.sql.prepare("INSERT INTO welfare_redemptions(id,offer_id,vendor_id,member_id,line_user_id,original_price,payable_price)VALUES(?,'legacy','a','member1',?,100,80)").run('pos:a:'+body.request_id,employee);
  const ledger=f.sql.prepare('SELECT * FROM welfare_redemptions').get();assert.equal((await f.call(body)).status,503);
  assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_redemptions').get(),ledger);assert.equal(f.count('welfare_branch_redemption_requests'),0);assert.equal(f.count('welfare_audit_events'),0);
});

test('customer submit retry fails closed when the completed request ledger is missing or mismatched',async t=>{
  const mutations=["DELETE FROM welfare_redemptions","UPDATE welfare_redemptions SET location_id='a2'","UPDATE welfare_redemptions SET vendor_id='b'","UPDATE welfare_redemptions SET original_price=101","UPDATE welfare_redemptions SET payable_price=79","UPDATE welfare_redemptions SET discount_amount=21","UPDATE welfare_redemptions SET offer_id='another'","UPDATE welfare_redemptions SET qr_token='other'","UPDATE welfare_redemptions SET member_id='othermember'","UPDATE welfare_redemptions SET line_user_id='U33333333333333333333333333333333'"];
  for(const mutation of mutations)await t.test(mutation,async st=>{
    const f=fixture(st),body=submitBody();assert.equal((await f.call(body)).status,200);
    f.sql.exec("INSERT INTO welfare_members(id,line_user_id,member_type)VALUES('othermember','U44444444444444444444444444444444','visitor');INSERT INTO welfare_offers(id,vendor_id,title)VALUES('another','b','Another')");
    f.sql.exec(mutation);const writes=f.writes.length;const result=await f.call(body);
    assert.equal(result.status,503);assert.equal(result.code,'submission_unavailable');assert.equal(f.writes.length,writes);
    const status=await f.call({action:'status',id_token:'employee-token',request_id:body.request_id});
    assert.equal(status.status,503);assert.equal(status.code,'submission_unavailable');assert.equal(f.writes.length,writes);
  });
});

test('customer completed submit appears once in the unchanged member consumption query alongside existing history',async t=>{
  const f=fixture(t),source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const memberFunction=source.slice(source.indexOf('async function getMemberRedemptions('),source.indexOf('async function getVendorPosDashboard('));
  const numericFunction=source.slice(source.indexOf('function normalizeNumericRow('),source.indexOf('async function listFlexTemplates('));
  const {getMemberRedemptions}=vm.runInNewContext(numericFunction+'\n'+memberFunction+'\n({getMemberRedemptions})',{ensureActivityCheckinTables:async()=>{},resolveLineDisplayName:async()=> 'LINE Employee'});
  f.sql.exec(`CREATE TABLE welfare_activity_checkins(id TEXT,event_id TEXT,line_user_id TEXT,checked_at TEXT,checkin_status TEXT);
    CREATE TABLE welfare_activity_events(id TEXT,title TEXT,description TEXT,location TEXT,start_at TEXT,end_at TEXT,checkin_start_at TEXT,checkin_end_at TEXT,status TEXT,audience_scope TEXT,created_at TEXT);
    INSERT INTO welfare_offers(id,vendor_id,title,status)VALUES('history','a','Existing history','approved');`);
  const insert=f.sql.prepare("INSERT INTO welfare_redemptions(id,offer_id,vendor_id,member_id,line_user_id,original_price,payable_price,discount_amount,status,redeemed_at)VALUES(?,'history','a','member1',?,50,40,10,'confirmed',datetime('now'))");
  for(let n=0;n<8;n++)insert.run('history-'+n,employee);
  const historyBefore=f.sql.prepare("SELECT * FROM welfare_redemptions WHERE offer_id='history' ORDER BY id").all();
  const body=submitBody();assert.equal((await f.call(body)).status,200);
  const url=new URL('https://fixture.test/api/member/redemptions?line_user_id='+employee);
  for(let n=0;n<2;n++){
    const result=await getMemberRedemptions(f.db,url);assert.equal(result.success,true);
    assert.equal(result.data.summary.total_count,9);assert.equal(result.data.summary.original_total,500);assert.equal(result.data.summary.payable_total,400);assert.equal(result.data.summary.discount_total,100);
    assert.equal(result.data.rows.length,9);assert.equal(result.data.rows.filter(row=>row.id==='pos:a:'+body.request_id).length,1);
    assert.equal((await f.call(body)).duplicated,true);
  }
  assert.deepEqual(f.sql.prepare("SELECT * FROM welfare_redemptions WHERE offer_id='history' ORDER BY id").all(),historyBefore);
});
