import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {registerSegmentInsights,segmentPushPayload,normalizeLineInsights,syncDueSegmentInsights} from '../src/segment-push-insights.js';

test('LINE insight snapshots deduplicate URLs, preserve missing values and exclude sensitive query parameters',()=>{
  const result=normalizeLineInsights({
    overview:{uniqueImpression:300,uniqueClick:40},
    clicks:[
      {url:'https://example.test/x?secret=value',click:36,uniqueClickOfRequest:26},
      {url:'https://example.test/x?secret=value',click:24,uniqueClickOfRequest:26},
      {url:'https://example.test/x?campaign=b',click:null,uniqueClickOfRequest:null},
      {url:'javascript:alert(1)',click:25,uniqueClickOfRequest:20}
    ]
  });
  assert.deepEqual(result,{opens:300,clickers:40,links:[
    {label:'https://example.test/x',clicks:60,people:26},
    {label:'https://example.test/x',clicks:null,people:null}
  ]});
  assert.throws(()=>normalizeLineInsights({overview:{uniqueImpression:'300',uniqueClick:null},clicks:[]}));
  assert.deepEqual(normalizeLineInsights({overview:{uniqueImpression:null,uniqueClick:null},clicks:[]}),{opens:null,clickers:null,links:[]});
});

test('registers future pushes only and safely polls LINE with UTC+9, leases, and retained snapshots',async t=>{
  const sql=new DatabaseSync(':memory:');
  t.after(()=>sql.close());
  for(const name of ['0012_line_segment_push.sql','0051_segment_push_insights.sql']){
    sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  const db={prepare(stmt){return{bind(...params){return{
    all:async()=>({results:sql.prepare(stmt).all(...params)}),
    first:async()=>sql.prepare(stmt).get(...params),
    run:async()=>({meta:sql.prepare(stmt).run(...params)})
  };}};}};
  const start=Date.parse('2026-11-21T15:10:00Z'), day=86400000;
  const id='ce2c9998-5cbd-46ed-b3fd-a8e4c43c4be1';
  sql.prepare("INSERT INTO welfare_push_campaigns(id,status,success_count) VALUES (?, 'sent', 500),('legacy','sent',500)").run(id);
  const unit=await registerSegmentInsights(db,id,start);
  assert.match(unit,/^sp_[a-f0-9]{27}$/);
  assert.equal(await registerSegmentInsights(db,id,start+1000),unit);
  assert.equal(sql.prepare('SELECT count(*) n FROM welfare_push_insights').get().n,1);
  assert.deepEqual(segmentPushPayload('fixture',[],unit),{to:'fixture',messages:[],customAggregationUnits:[unit]});
  assert.deepEqual(segmentPushPayload('fixture',[],null),{to:'fixture',messages:[]});
  assert.equal(await registerSegmentInsights({prepare(){throw Error('synthetic offline');}},id,start),null);
  let calls=0, transient=false;
  const wire=async (url,opts)=>{
    calls++;
    const u=new URL(url);
    assert.equal(u.origin,'https://api.line.me');
    assert.equal(u.pathname,'/v2/bot/insight/message/event/aggregation');
    assert.equal(opts.method,'GET');
    assert.equal(u.searchParams.get('customAggregationUnit'),unit);
    assert.equal(u.searchParams.get('from'),'20261122');
    if(transient)return new Response(null,{status:429});
    return Response.json({overview:{uniqueImpression:300,uniqueClick:null},clicks:[{url:'https://example.test/x',click:30,uniqueClickOfRequest:22}]});
  };
  assert.equal(await syncDueSegmentInsights(db,'fixture',start+day-1,wire),0);
  assert.equal(calls,0);
  await Promise.all([1,2].map(()=>syncDueSegmentInsights(db,'fixture',start+day,wire)));
  assert.equal(calls,1);
  const snapshot=()=>sql.prepare("SELECT * FROM welfare_push_insights WHERE campaign_id=?").get(id);
  assert.equal(snapshot().unique_opens,300);
  assert.equal(snapshot().unique_clickers,null);
  assert.equal(JSON.parse(snapshot().links_json)[0].people,22);
  transient=true;
  await syncDueSegmentInsights(db,'fixture',snapshot().next_sync_at,wire);
  assert.equal(snapshot().unique_opens,300);
  assert.equal(snapshot().sync_failed,1);
  transient=false;
  await syncDueSegmentInsights(db,'fixture',start+15*day,wire);
  assert.equal(snapshot().next_sync_at,null);
  assert.equal(snapshot().sync_failed,0);
});
