import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {handlePushHistory} from '../src/push-history.js';
import {pushHistoryHtml} from '../src/push-history-ui.js';

test('history is scoped and read-only, preserves scheduled failures, and strips raw recipient diagnostics',async t=>{
  const sql=new DatabaseSync(':memory:');
  t.after(()=>sql.close());
  for(const name of ['0012_line_segment_push.sql','0037_segment_push_safety.sql','0039_segment_push_schedules.sql','0051_segment_push_insights.sql']){
    sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  const run=(stmt,...args)=>sql.prepare(stmt).run(...args);
  const campaign=(id,title,status,recipients,accepted=0,failed=0,created='2026-11-20T08:00:00Z')=>
    run('INSERT INTO welfare_push_campaigns(id,title,status,recipient_count,success_count,failed_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      id,title,status,recipients,accepted,failed,created,created);
  const preview=(id,actor)=>run("INSERT INTO welfare_push_previews VALUES(?,? ,?, 'rev','title','text','{}','[]','[]',0,1)",id,actor,id);
  const due=Date.parse('2026-11-21T00:30:00+08:00');
  const schedule=(id,actor,reason)=>run("INSERT INTO welfare_push_schedules VALUES(?,?,?,?,?,?,'needs_review',?,?,?,?)",
    id,id,actor,id,'rev',due,due,due,due,reason);
  const reviewUid='U'+'a'.repeat(32);
  const delivery=(id,status,code,reason)=>run("INSERT INTO welfare_push_deliveries(id,campaign_id,line_user_id,display_name,status,response_status,response_body) VALUES(?,'mix',?,?,?,?,?)",
    id,id==='c'?reviewUid:'SECRET_UID',id==='c'?'需核對的合成使用者':'SECRET_NAME',status,code,reason);
  campaign('blocked','受眾變更','needs_review',437);schedule('blocked','line:other','受眾資格或名冊已變更，預約未發送。');
  campaign('unknown','結果待確認','needs_review',19);schedule('unknown','line:me','發送結果待確認，未自動重送。');
  campaign('mix','本期員工優惠','partial',5,1,1);preview('mix','line:me');
  delivery('a','accepted',200,'SECRET_RAW_DATA');delivery('b','failed',400,'SECRET_RAW_DATA');
  delivery('c','not_sent',0,'無法重新確認受眾資格，未發送。');delivery('d','unknown',0,'SECRET_RAW_DATA');
  campaign('legacy','舊推播','sent',19,19);
  const reads=[];
  const db={prepare(stmt){
    assert.match(stmt,/^SELECT /);
    reads.push(stmt);
    return {bind(...params){return {
      all:async()=>({results:sql.prepare(stmt).all(...params)}),
      first:async()=>sql.prepare(stmt).get(...params)
    };}};
  }};
  const call=(q='',principal={role:'admin',actor:'line:me'},init)=>handlePushHistory(new Request('https://shop.test/admin-api/line-push-history'+q,init),db,async()=>principal);
  const full={role:'admin',actor:'line:me',canReadAllPushHistory:true};
  assert.equal((await call('',null)).status,403);
  assert.equal((await call('',{role:'viewer',actor:'line:me'})).status,403);
  assert.equal((await call('',full,{method:'POST'})).status,405);
  assert.equal((await call('',full,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal(reads.length,0);
  assert.deepEqual((await (await call()).json()).items.map(x=>x.id),['unknown','mix']);
  assert.equal((await call('?id=blocked')).status,404);
  assert.equal((await call('?id=legacy')).status,404);
  const blocked=(await (await call('?id=blocked',full)).json()).data;
  assert.equal(blocked.recipient_count,437);
  assert.equal(blocked.recorded,0);
  assert.equal(blocked.totals.not_sent,437);
  assert.equal(blocked.outcomes[0].reason,'受眾資格或名冊已變更，預約未發送。');
  const unknown=(await (await call('?id=unknown')).json()).data;
  assert.equal(unknown.totals.not_sent,0);
  assert.match(unknown.reason,/待確認/);
  const mixResponse=await call('?id=mix');
  assert.match(mixResponse.headers.get('cache-control'),/no-store/);
  const raw=await mixResponse.text();
  assert.doesNotMatch(raw,/SECRET_UID|SECRET_NAME|SECRET_RAW_DATA/);
  const mix=JSON.parse(raw).data;
  assert.deepEqual(mix.insights,{state:'untracked',updatedAt:null,opens:null,clickers:null,openRate:null});
  assert.equal(mix.recorded,4);
  assert.deepEqual(mix.totals,{accepted:1,failed:1,not_sent:1,unknown:1,sending:0,other:0});
  assert.ok(mix.outcomes.some(x=>x.reason==='LINE API 拒絕（HTTP 400）。'));
  assert.ok(mix.outcomes.some(x=>x.reason==='無法重新確認受眾資格，未發送。'));
  assert.deepEqual(mix.recipientIssues,[{line_user_id:reviewUid,display_name:'需核對的合成使用者',reason:'無法重新確認受眾資格，未發送。'}]);
  run("INSERT INTO welfare_push_insights(campaign_id,unit_name,started_at,next_sync_at,synced_at,unique_opens,unique_clickers,links_json) VALUES('mix','test',1,1,2,1,NULL,?)",
    JSON.stringify([{label:'https://example.test/benefit',people:null,clicks:33}]));
  const measured=(await (await call('?id=mix')).json()).data.insights;
  assert.deepEqual(measured,{state:'synced',updatedAt:2,opens:1,clickers:null,openRate:100,links:[{label:'https://example.test/benefit',people:null,clicks:33}]});
  assert.equal((await (await call('?q=員工')).json()).items[0].insights.links,undefined);
  run("INSERT INTO welfare_push_insights(campaign_id,unit_name,started_at,next_sync_at) VALUES('unknown','pending',1,1)");
  assert.equal((await (await call('?id=unknown')).json()).data.insights.state,'pending');
  assert.deepEqual((await (await call('?type=scheduled&from=2026-11-21&to=2026-11-21',full)).json()).items.map(x=>x.id),['unknown','blocked']);
  assert.deepEqual((await (await call('?status=partial&q=員工',full)).json()).items.map(x=>x.id),['mix']);
  for(const q of ['?from=2026-02-29','?status=injected','?page=-1','?type=disabled']){
    assert.equal((await call(q,full)).status,400);
  }
  for(let i=0;i<28;i++)campaign('old-'+i,'往期','sent',1,1,0,'2026-11-01 01:00:00');
  const firstPage=await (await call('',full)).json(), secondPage=await (await call('?page=2',full)).json();
  assert.equal(firstPage.items.length,25);
  assert.equal(firstPage.hasMore,true);
  assert.equal(secondPage.items.length,7);
  assert.equal(secondPage.hasMore,false);
  assert.equal(new Set([...firstPage.items,...secondPage.items].map(item=>item.id)).size,32);
});

test('history browser script parses and exposes the filter and detail controls',()=>{
  for(const [,script] of pushHistoryHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  for(const label of ['推播紀錄與成效','發送明細','傳送方式'])assert.ok(pushHistoryHtml.includes(label));
});
