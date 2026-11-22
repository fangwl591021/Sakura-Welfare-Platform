import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { handleVendorSupplementMonitor, decorateVendorSupplementMonitor } from '../src/vendor-supplement-monitor.js';

const url='https://example.test/admin-api/vendor-supplement-monitor';
const request = ()=>new Request(url,{headers:{Authorization:'Bearer test'}});
const admin = scope => async()=>({id:'1',role:'admin',business_units:scope});
function database(rows=[],error=null){let captured='';return {get sql(){return captured},prepare(sql){captured=sql;return {bind(n){assert.equal(n,50);return {async all(){if(error)throw error;return {results:rows}}}}}}}}

test('requires both vendor and LINE scope, denies without querying',async()=>{
  for(const scope of ['vendors','line','','activities,line']){
    const db=database();const result=await handleVendorSupplementMonitor(request(),db,{authorizeVendorAdmin:admin(scope)});assert.equal(result.status,403);assert.equal(db.sql,'');
  }
  const result=await handleVendorSupplementMonitor(request(),database(),{authorizeVendorAdmin:async()=>null});assert.equal(result.status,403);
});

test('returns only minimum fields and uses snapshot UID for the recorded event',async()=>{
  const uid='U'+'a'.repeat(32);const db=database([{event_id:'event',vendor_name:'廠商甲',created_at:'2026-11-04T00:00:00Z',notification_state:'accepted',recipient_uid:uid,note:'SECRET',retry_key:'SECRET',submitted_by_line_user_id:'U'+'b'.repeat(32)},{event_id:'2',notification_state:'sending',recipient_uid:'bad'}]);
  const res=await handleVendorSupplementMonitor(request(),db,{authorizeVendorAdmin:admin('vendors,line')});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  const json=await res.json();assert.deepEqual(json.records[0],{id:'event',createdAt:'2026-11-04T00:00:00Z',vendorName:'廠商甲',state:'accepted',recipientUid:uid});assert.equal(json.records[1].state,'unknown');assert.equal(json.records[1].recipientUid,'');assert(!JSON.stringify(json).includes('SECRET'));assert.match(db.sql,/e\.recipient_uid/);assert(!/\b(?:UPDATE|INSERT|DELETE)\b/i.test(db.sql));
});

test('accepts wildcard, handles an absent event table, hides internal errors',async()=>{
  const absent=await handleVendorSupplementMonitor(request(),database([],new Error('D1_ERROR: no such table: welfare_vendor_review_events')),{authorizeVendorAdmin:admin('*')});assert.equal(absent.status,200);assert.equal((await absent.json()).schemaUnavailable,true);
  const broken=await handleVendorSupplementMonitor(request(),database([],new Error('SECRET')),{authorizeVendorAdmin:admin('*')});assert.equal(broken.status,503);assert(!JSON.stringify(await broken.json()).includes('SECRET'));
});

test('monitor decoration supplies inert, compilable UI with safe DOM rendering',()=>{
  const html=decorateVendorSupplementMonitor('<html><body><div id="threadList"></div></body></html>');assert.match(html,/廠商補件推播紀錄/);assert.match(html,/textContent=row.vendorName/);assert.match(html,/recipientUid/);const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(script));assert(!script.includes('innerHTML'));
});
