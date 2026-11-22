import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorFixture,roleUid} from './editor-roles.test.mjs';
import {documentFixture} from './vendor-public-documents-fixture.mjs';
import worker from '../src/index.js';
import {ensureKnownSchema,requestEnvironment,requestWork} from '../src/request-work.js';

function count(db) {
  const queries=[],prepare=db.prepare.bind(db);
  db.prepare=sql=>{queries.push(sql);return prepare(sql);};
  return queries;
}
test('admin authorization is reused only within one request; whitelist disable still revokes the next request',async()=>{
 const f=editorFixture(),queries=count(f.env.DB);
 try {
  assert.equal((await f.call('/admin-api/editor-context','activity_editor')).status,200);
  assert.equal(queries.filter(q=>q.includes('JOIN admin_users')).length,1);
  assert.equal(queries.filter(q=>q.includes('FROM admin_user_permissions')).length,1);
  f.sqlite.prepare('UPDATE admin_uid_whitelist SET active=0 WHERE line_user_id=?').run(roleUid('activity_editor'));
  assert.equal((await f.call('/admin-api/editor-context','activity_editor')).status,403);
  assert.equal(queries.filter(q=>q.includes('JOIN admin_users')).length,2);
 } finally {f.close();}
});
test('existing activity schema is not repeatedly initialized on dashboard reads',async()=>{
 const f=editorFixture(),queries=count(f.env.DB);
 try {
  for(let i=0;i<2;i++)assert.equal((await f.call('/admin-api/activity-checkin','activity_editor')).status,200);
  assert.equal(queries.filter(q=>/^\s*(CREATE|ALTER)/i.test(q)).length,0);
 }finally{f.close();}
});
test('public store reads skip employee offers, DM and redemption summaries',async()=>{
 const f=documentFixture();
 try{
  for(const name of ['0018_vendor_showcase_assets','0028_vendor_store_dm_carousel'])f.sqlite.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
  const queries=count(f.db),r=await worker.fetch(new Request('https://fixture.test/api/vendor-store?vendor_id=a'),f.env,{}),data=await r.json();
  assert.equal(r.status,200);assert.equal(data.employeeBenefits,false);assert.deepEqual(data.data.offers,[]);
  assert.equal(queries.filter(q=>/FROM welfare_(offers|redemptions|vendor_showcase_assets|vendor_carousel_items)\b/.test(q)).length,0);
 }finally{f.close();}
});
test('request scopes never share pending identity I/O, including simultaneous requests',async()=>{
 const db={prepare(){}};const a=requestEnvironment({DB:db}),b=requestEnvironment({DB:db});let calls=0;
 const run=async()=>{calls++;return calls;};
 const [x,y,z]=await Promise.all([requestWork(a.DB,'identity','uid',run),requestWork(a.DB,'identity','uid',run),requestWork(b.DB,'identity','uid',run)]);
 assert.equal(x,y);assert.notEqual(x,z);assert.equal(calls,2);
});
test('schema fallback initializes only a missing schema; transient errors are not hidden or cached',async()=>{
 let initialized=0,failed=true,probes=0;
 const db={prepare:()=>({all:async()=>{probes++;if(failed)throw Error('D1 unavailable');return {results:[]};}})};
 await assert.rejects(ensureKnownSchema(db,'test','SELECT 1',async()=>initialized++),/D1 unavailable/);
 assert.equal(initialized,0);failed=false;
 await ensureKnownSchema(db,'test','SELECT 1',async()=>initialized++);await ensureKnownSchema(db,'test','SELECT 1',async()=>initialized++);
 assert.equal(probes,2);assert.equal(initialized,0);
 let missing=true;
 const legacy={prepare:()=>({all:async()=>{if(missing)throw Error('no such table: test');return {results:[]};}})};
 await ensureKnownSchema(legacy,'legacy','SELECT 1',async()=>{initialized++;missing=false;});
 assert.equal(initialized,1);
});
