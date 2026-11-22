import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  readManageableVendorBrands, readManageableVendorBrand, readSelectedManagedVendor, selectManagedVendorBrand,
  searchVendorBrandManagementUsers, readVendorBrandManagementOptions, previewVendorBrandManagement,
  confirmVendorBrandManagement, getVendorBrandManagementOperation,
} from '../src/vendor-brand-access.js';
import { consumeVendorLineCode, issueVendorLineCode } from '../src/vendor-line-binding.js';

const UID = 'U'+'1'.repeat(32), OTHER = 'U'+'2'.repeat(32), ADMIN={type:'admin',id:'fixture-admin'};
const migration = name => readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function setup(t,{migrate=true}={}) {
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  for(const name of ['0008_sakura_welfare_core.sql','0010_welfare_operations.sql','0005_line_user_profiles.sql','0019_vendor_line_onboarding.sql','0046_vendor_line_bindings.sql'])sql.exec(migration(name));
  sql.exec(`ALTER TABLE welfare_vendors ADD COLUMN submitted_by_line_user_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN is_hidden INTEGER DEFAULT 0;
    ALTER TABLE welfare_vendors ADD COLUMN contract_end TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN contract_terminated_at TEXT NOT NULL DEFAULT '';`);
  const insert=sql.prepare("INSERT INTO welfare_vendors(id,name,status,vendor_portal_password,updated_at)VALUES(?,?,'approved','DO-NOT-EXPOSE','2026-11-12 00:00:00')");
  for(let n=1;n<=7;n++)insert.run('brand-'+n,'品牌 '+n);
  sql.prepare("INSERT INTO line_user_profiles(line_user_id,display_name,updated_at)VALUES(?,?,'2026-11-12 00:00:00')").run(UID,'窗口 LINE 名稱');
  sql.prepare("INSERT INTO welfare_members(id,line_user_id,member_type,display_name)VALUES('member',?,'employee','不可替代的員工姓名')").run(UID);
  if(migrate)sql.exec(migration('0048_vendor_brand_management.sql'));
  const f={sql,reads:[],writes:[],failAt:-1,beforeBatch:null,beforeRun:null,loseAfterCommit:false};
  const wrap=(query,args=[])=>({statement:query,args,bind(...next){return wrap(query,next);},
    async first(){f.reads.push(query);return sql.prepare(query).get(...args)||null;},async all(){f.reads.push(query);return{success:true,results:sql.prepare(query).all(...args)};},
    async run(){if(f.beforeRun){const callback=f.beforeRun;f.beforeRun=null;await callback();}f.writes.push(query);const r=sql.prepare(query).run(...args);return{success:true,meta:{changes:Number(r.changes)}};}});
  f.db={prepare:query=>wrap(query),async batch(statements){
    if(f.beforeBatch){const callback=f.beforeBatch;f.beforeBatch=null;await callback();}
    let result;sql.exec('BEGIN');try{result=statements.map((s,i)=>{if(i===f.failAt)throw new Error('Injected batch failure');f.writes.push(s.statement);const r=sql.prepare(s.statement).run(...s.args);return{success:true,meta:{changes:Number(r.changes)}};});sql.exec('COMMIT');}
    catch(error){sql.exec('ROLLBACK');throw error;}
    if(f.loseAfterCommit){f.loseAfterCommit=false;throw new Error('Injected missing commit acknowledgement');}return result;
  }};
  f.bind=(id,management=0,status='active',uid=UID)=>sql.prepare("INSERT INTO welfare_vendor_line_bindings(vendor_id,line_user_id,status,source,created_at,updated_at,management_enabled)VALUES(?,?,?,'shared_code','original-created','original-updated',?)").run(id,uid,status,management);
  f.preview=(ids=['brand-1'],uid=UID)=>previewVendorBrandManagement(f.db,{lineUserId:uid,vendorIds:ids});
  f.confirm=preview=>confirmVendorBrandManagement(f.db,{...preview,confirmed:true},ADMIN);
  f.count=table=>sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
  return f;
}

test('additive migration leaves existing bindings, source and timestamps unchanged with no management grant',t=>{
  const f=setup(t,{migrate:false});
  f.sql.prepare("INSERT INTO welfare_vendor_line_bindings VALUES(?,?,'active','shared_code','created','updated')").run('brand-1',UID);
  f.sql.prepare("INSERT INTO welfare_vendor_line_bindings VALUES(?,?,'revoked','admin','created2','updated2')").run('brand-2',UID);
  const before=f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings ORDER BY vendor_id').all();
  f.sql.exec(migration('0048_vendor_brand_management.sql'));
  const after=f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings ORDER BY vendor_id').all();
  assert.deepEqual(after.map(({management_enabled,...row})=>row),before.map(row=>({...row})));assert.ok(after.every(row=>row.management_enabled===0));
  assert.throws(()=>f.sql.exec('UPDATE welfare_vendor_line_bindings SET management_enabled=2'),/CHECK/);
});

test('management list includes all granted or direct brands but excludes shared-only, revoked and ineligible brands',async t=>{
  const f=setup(t);f.bind('brand-1',1);f.bind('brand-2',0);f.bind('brand-3',1,'revoked');
  f.sql.prepare("UPDATE welfare_vendors SET contact_line_user_id=? WHERE id IN('brand-3','brand-4')").run(UID);
  f.sql.prepare("UPDATE welfare_vendors SET submitted_by_line_user_id=? WHERE id='brand-5'").run(UID);
  f.bind('brand-6',1);f.sql.exec("UPDATE welfare_vendors SET status='pending' WHERE id='brand-6'");
  const rows=await readManageableVendorBrands(f.db,UID);assert.deepEqual(rows.map(row=>row.id),['brand-1','brand-4','brand-5']);
  assert.equal(rows[0].management_source,'admin');assert.equal(rows[1].management_source,'direct');
  assert.equal(await readManageableVendorBrand(f.db,UID,'brand-2'),null);assert.equal(await readManageableVendorBrand(f.db,OTHER,'brand-1'),null);
  assert.equal(f.writes.length,0);assert.ok(f.reads.every(query=>!query.includes('welfare_members')));
});

test('six-brand administrator grant lists all six without changing the seventh or another user',async t=>{
  const f=setup(t),ids=Array.from({length:6},(_,n)=>'brand-'+(n+1));f.bind('brand-7',0);f.bind('brand-1',0,'active',OTHER);
  const unselected=f.sql.prepare("SELECT * FROM welfare_vendor_line_bindings WHERE vendor_id='brand-7' OR line_user_id=? ORDER BY vendor_id,line_user_id").all(OTHER);
  const members=f.sql.prepare('SELECT * FROM welfare_members').all(),vendors=f.sql.prepare('SELECT * FROM welfare_vendors ORDER BY id').all();
  const preview=await f.preview([...ids].reverse());assert.deepEqual(preview.vendorIds,ids);assert.equal(f.writes.length,0);
  const result=await f.confirm(preview);assert.equal(result.appliedCount,6);assert.equal(result.duplicated,false);
  assert.deepEqual((await readManageableVendorBrands(f.db,UID)).map(row=>row.id),ids);assert.equal(f.count('welfare_audit_events'),1);
  assert.deepEqual(f.sql.prepare("SELECT * FROM welfare_vendor_line_bindings WHERE vendor_id='brand-7' OR line_user_id=? ORDER BY vendor_id,line_user_id").all(OTHER),unselected);
  assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_members').all(),members);assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_vendors ORDER BY id').all(),vendors);
});

test('preview binds cached LINE name, exact UID and add/enable/restore/unchanged actions without exposing credentials',async t=>{
  const f=setup(t);f.bind('brand-1',0);f.bind('brand-2',1,'revoked');f.bind('brand-3',1);
  const options=await readVendorBrandManagementOptions(f.db,UID);assert.equal(options.lineDisplayName,'窗口 LINE 名稱');assert.equal(options.brands.find(b=>b.id==='brand-1').canManage,false);
  const preview=await f.preview(['brand-1','brand-2','brand-3','brand-4']);
  assert.deepEqual(preview.brands.map(row=>row.action),['enable','restore','unchanged','add']);assert.equal(preview.lineUserId,UID);assert.match(preview.revision,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(preview).includes('DO-NOT-EXPOSE'));assert.ok(!JSON.stringify(options).includes('DO-NOT-EXPOSE'));assert.ok(!JSON.stringify(preview).includes('不可替代的員工姓名'));
  const before=f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings ORDER BY vendor_id').all();
  const result=await f.confirm(preview);assert.equal(result.appliedCount,3);
  for(const original of before){const row=f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings WHERE vendor_id=? AND line_user_id=?').get(original.vendor_id,UID);assert.equal(row.source,original.source);assert.equal(row.created_at,original.created_at);assert.equal(row.management_enabled,1);assert.equal(row.status,'active');}
  assert.equal(f.sql.prepare("SELECT updated_at FROM welfare_vendor_line_bindings WHERE vendor_id='brand-3'").get().updated_at,'original-updated');
});

test('selected brand is a revalidated cache and selecting preserves unrelated onboarding state',async t=>{
  const f=setup(t);f.bind('brand-1',1);f.bind('brand-2',1);f.bind('brand-3',0);
  assert.equal(await readSelectedManagedVendor(f.db,UID),null);
  f.sql.prepare("INSERT INTO welfare_vendor_line_sessions(line_user_id,vendor_id,current_step,last_intent,last_document_type,last_message,created_at,updated_at)VALUES(?,'brand-1','upload','insurance','insurance','old message','old-created','old-updated')").run(UID);
  assert.equal((await selectManagedVendorBrand(f.db,UID,'brand-2')).id,'brand-2');assert.equal((await readSelectedManagedVendor(f.db,UID)).id,'brand-2');
  const row=f.sql.prepare('SELECT * FROM welfare_vendor_line_sessions').get();assert.equal(row.current_step,'upload');assert.equal(row.last_message,'old message');assert.equal(row.created_at,'old-created');
  await assert.rejects(selectManagedVendorBrand(f.db,UID,'brand-3'),e=>e.status===403);
  f.sql.exec("UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='brand-2'");assert.equal(await readSelectedManagedVendor(f.db,UID),null);
  assert.equal(f.sql.prepare('SELECT vendor_id FROM welfare_vendor_line_sessions').get().vendor_id,'brand-2');
  f.beforeRun=()=>f.sql.exec("UPDATE welfare_vendor_line_bindings SET management_enabled=0 WHERE vendor_id='brand-1'");
  await assert.rejects(selectManagedVendorBrand(f.db,UID,'brand-1'),e=>e.code==='selection_changed');assert.equal(f.sql.prepare('SELECT vendor_id FROM welfare_vendor_line_sessions').get().vendor_id,'brand-2');
});

test('search reads only cached exact UIDs and escaped names, truncates and never uses member names',async t=>{
  const f=setup(t);f.sql.prepare("INSERT INTO line_user_profiles(line_user_id,display_name)VALUES(?,?)").run(OTHER,'窗口 LINE 名稱');
  const same=await searchVendorBrandManagementUsers(f.db,'窗口');assert.deepEqual(same.users.map(row=>row.lineUserId).sort(),[UID,OTHER]);
  assert.deepEqual((await searchVendorBrandManagementUsers(f.db,UID)).users,[{lineUserId:UID,lineDisplayName:'窗口 LINE 名稱'}]);
  assert.equal((await searchVendorBrandManagementUsers(f.db,'%')).users.length,0);assert.equal((await searchVendorBrandManagementUsers(f.db,'不可替代')).users.length,0);
  const insert=f.sql.prepare('INSERT INTO line_user_profiles(line_user_id,display_name)VALUES(?,?)');for(let n=10;n<35;n++)insert.run('U'+String(n).padStart(32,'0'),'共同名稱 '+n);
  const many=await searchVendorBrandManagementUsers(f.db,'共同');assert.equal(many.users.length,20);assert.equal(many.truncated,true);
  assert.equal(f.writes.length,0);assert.ok(f.reads.every(query=>query.includes('line_user_profiles')&&!query.includes('welfare_members')));
});

test('unknown cached UID cannot receive a grant and employee data cannot substitute for LINE profile evidence',async t=>{
  const f=setup(t),preview=await f.preview();f.sql.prepare('DELETE FROM line_user_profiles WHERE line_user_id=?').run(UID);
  await assert.rejects(readVendorBrandManagementOptions(f.db,UID),e=>e.code==='line_profile_not_found');
  await assert.rejects(f.preview(),e=>e.code==='line_profile_not_found');
  await assert.rejects(f.confirm(preview),e=>e.code==='line_profile_not_found');
  assert.equal(f.writes.length,0);assert.equal(f.count('welfare_vendor_line_bindings'),0);assert.equal(f.count('welfare_audit_events'),0);
  f.sql.prepare("INSERT INTO line_user_profiles(line_user_id,display_name)VALUES(?,'')").run(UID);
  const knownBlank=await f.preview();assert.equal(knownBlank.lineDisplayName,'');assert.equal(knownBlank.lineUserId,UID);
  assert.equal((await f.confirm(knownBlank)).lineDisplayName,'');
});

test('shared-code use stays QR-only after migration and cannot restore a revoked management association',async t=>{
  const f=setup(t),issued=await issueVendorLineCode(f.db,'brand-1');
  const item={text:issued.data.code,LINE_user_id:UID,eventType:'message',messageType:'text',sourceType:'user'};
  assert.equal((await consumeVendorLineCode(f.db,item,true)).success,true);assert.equal((await readManageableVendorBrands(f.db,UID)).length,0);
  const binding=f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings').get();assert.equal(binding.management_enabled,0);assert.equal(binding.source,'shared_code');
  await f.confirm(await f.preview());f.sql.exec("UPDATE welfare_vendor_line_bindings SET status='revoked'");
  assert.equal((await consumeVendorLineCode(f.db,item,true)).success,false);assert.equal((await readManageableVendorBrands(f.db,UID)).length,0);
});

test('confirmation requires explicit consent, admin actor, exact preview UID/brands/revision and valid operation ID',async t=>{
  const f=setup(t),preview=await f.preview();
  for(const extra of [{confirmed:false},{operationId:'invalid'},{revision:'x'},{revision:'0'.repeat(64)},{lineUserId:OTHER},{vendorIds:['brand-2']},{vendorIds:[]},{vendorIds:['brand-1','brand-1']}])
    await assert.rejects(confirmVendorBrandManagement(f.db,{...preview,confirmed:true,...extra},ADMIN));
  await assert.rejects(confirmVendorBrandManagement(f.db,{...preview,confirmed:true},{type:'vendor',id:'someone'}),e=>e.status===403);
  await assert.rejects(f.preview(['missing']),e=>e.status===409);await assert.rejects(f.preview(['brand-1'],'bad-uid'),e=>e.status===400);
  assert.equal(f.writes.length,0);assert.equal(f.count('welfare_vendor_line_bindings'),0);assert.equal(f.count('welfare_audit_events'),0);
});

test('same operation and payload sequential/concurrent/lost-response replay creates one audit and never regrants later revocation',async t=>{
  const f=setup(t),preview=await f.preview(['brand-1','brand-2']);
  const results=await Promise.all([f.confirm(preview),f.confirm(preview),f.confirm(preview)]);
  assert.equal(results.filter(r=>!r.duplicated).length,1);assert.equal(f.count('welfare_audit_events'),1);assert.equal(f.count('welfare_vendor_line_bindings'),2);
  const writes=f.writes.length;assert.equal((await f.confirm(preview)).duplicated,true);assert.equal(f.writes.length,writes);
  const receipt=await getVendorBrandManagementOperation(f.db,preview.operationId,preview);assert.equal(receipt.appliedCount,2);
  await assert.rejects(getVendorBrandManagementOperation(f.db,preview.operationId,{...preview,vendorIds:['brand-3']}),e=>e.code==='operation_conflict');
  f.sql.exec("UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='brand-1'");await f.confirm(preview);
  assert.equal(f.sql.prepare("SELECT status FROM welfare_vendor_line_bindings WHERE vendor_id='brand-1'").get().status,'revoked');
  const next=await f.preview(['brand-3']);f.loseAfterCommit=true;assert.equal((await f.confirm(next)).duplicated,true);assert.equal(f.count('welfare_audit_events'),2);
});

test('same operation ID with competing selections cannot write or acknowledge the losing payload',async t=>{
  const f=setup(t),first=await f.preview(['brand-1']),second=await f.preview(['brand-2']);second.operationId=first.operationId;
  const results=await Promise.allSettled([f.confirm(first),f.confirm(second)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected.reason.code,'operation_conflict');
  assert.equal(f.count('welfare_audit_events'),1);assert.equal(f.count('welfare_vendor_line_bindings'),1);
  const stored=f.sql.prepare('SELECT raw_json FROM welfare_audit_events').get();const receipt=JSON.parse(stored.raw_json);
  assert.equal(f.sql.prepare('SELECT vendor_id FROM welfare_vendor_line_bindings').get().vendor_id,receipt.vendorIds[0]);
});

test('different operations using the same stale preview do not duplicate grants or audits',async t=>{
  const f=setup(t),first=await f.preview(['brand-1','brand-2']),second=await f.preview(['brand-1','brand-2']);
  assert.equal(first.revision,second.revision);
  const results=await Promise.allSettled([f.confirm(first),f.confirm(second)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'preview_changed');
  assert.equal(f.count('welfare_audit_events'),1);assert.equal(f.count('welfare_vendor_line_bindings'),2);
});

test('preview version changes block the entire batch before writes',async t=>{
  for(const mutation of ["UPDATE line_user_profiles SET display_name='Changed'","UPDATE line_user_profiles SET updated_at='changed'","UPDATE welfare_vendors SET name='Changed' WHERE id='brand-2'","UPDATE welfare_vendors SET updated_at='changed' WHERE id='brand-2'"])
    await t.test(mutation,async st=>{const f=setup(st),preview=await f.preview(['brand-1','brand-2']);f.sql.exec(mutation);await assert.rejects(f.confirm(preview),e=>e.code==='preview_changed');assert.equal(f.writes.length,0);assert.equal(f.count('welfare_audit_events'),0);});
});

test('atomic SQL rechecks all brands, bindings and cached LINE name after preview/preflight',async t=>{
  const mutations=["UPDATE welfare_vendors SET name='Renamed' WHERE id='brand-2'","UPDATE welfare_vendors SET is_hidden=1 WHERE id='brand-2'","UPDATE welfare_vendors SET status='pending' WHERE id='brand-2'","UPDATE welfare_vendors SET contract_end='2000-01-01' WHERE id='brand-2'","UPDATE welfare_vendors SET contract_terminated_at='now' WHERE id='brand-2'","UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='brand-2'","UPDATE welfare_vendor_line_bindings SET management_enabled=1 WHERE vendor_id='brand-2'","UPDATE welfare_vendor_line_bindings SET source='other' WHERE vendor_id='brand-2'","UPDATE line_user_profiles SET display_name='Changed'","DELETE FROM line_user_profiles"];
  for(const mutation of mutations)await t.test(mutation,async st=>{
    const f=setup(st);f.bind('brand-2');const preview=await f.preview(['brand-1','brand-2']);f.beforeBatch=()=>f.sql.exec(mutation);
    await assert.rejects(f.confirm(preview),e=>e.code==='preview_changed');assert.equal(f.count('welfare_audit_events'),0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM welfare_vendor_line_bindings WHERE vendor_id='brand-1'").get().n,0);
    assert.equal(await getVendorBrandManagementOperation(f.db,preview.operationId,preview),null);
  });
});

test('failure at audit or any selected binding update rolls back every grant, restoration and audit',async t=>{
  for(let step=0;step<4;step++)await t.test('statement '+step,async st=>{
    const f=setup(st);f.bind('brand-1',0);f.bind('brand-2',1,'revoked');const preview=await f.preview(['brand-1','brand-2','brand-3']);
    const before=f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings ORDER BY vendor_id').all();f.failAt=step;
    await assert.rejects(f.confirm(preview),e=>e.code==='grant_unavailable');assert.equal(f.count('welfare_audit_events'),0);
    assert.deepEqual(f.sql.prepare('SELECT * FROM welfare_vendor_line_bindings ORDER BY vendor_id').all(),before);assert.equal(await getVendorBrandManagementOperation(f.db,preview.operationId,preview),null);
    f.failAt=-1;assert.equal((await f.confirm(preview)).appliedCount,3);assert.equal((await readManageableVendorBrands(f.db,UID)).length,3);
  });
});

test('each management read excludes hidden, expired, terminated, revoked and not-approved brands immediately',async t=>{
  const f=setup(t);for(let n=1;n<=6;n++)f.bind('brand-'+n,1);
  f.sql.exec("UPDATE welfare_vendors SET is_hidden=1 WHERE id='brand-1';UPDATE welfare_vendors SET contract_end='2000-01-01' WHERE id='brand-2';UPDATE welfare_vendors SET contract_terminated_at='now' WHERE id='brand-3';UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='brand-4';UPDATE welfare_vendors SET status='pending' WHERE id='brand-5';UPDATE welfare_vendors SET contract_end='2026-02-30' WHERE id='brand-6'");
  assert.deepEqual(await readManageableVendorBrands(f.db,UID),[]);
  const options=await readVendorBrandManagementOptions(f.db,UID);assert.deepEqual(options.brands.map(row=>row.id),['brand-4','brand-7']);
  for(const id of ['brand-1','brand-2','brand-3','brand-5','brand-6'])await assert.rejects(f.preview([id]),e=>e.code==='brands_changed');
});

test('database or missing migration failures cannot fall back to guessed management access',async t=>{
  const f=setup(t,{migrate:false});f.sql.prepare("UPDATE welfare_vendors SET contact_line_user_id=? WHERE id='brand-1'").run(UID);
  await assert.rejects(readManageableVendorBrands(f.db,UID));await assert.rejects(readManageableVendorBrand(f.db,UID,'brand-1'));
  assert.equal(f.writes.length,0);
});
