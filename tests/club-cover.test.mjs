import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { clubFixture } from './club-fixture.mjs';
import { clubDefaultCover } from '../src/club-default-cover.js';

test('AI defaults are real optimized assets, auto-match clubs and do not write or call a provider on reads', async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../assets/club-default-covers/20261008-v1/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.generator,'built-in image_gen');assert.equal(manifest.assets.length,4);
 for(const asset of manifest.assets){const bytes=readFileSync(new URL('../assets/club-default-covers/20261008-v1/'+asset.file,import.meta.url));assert.equal(bytes.length,asset.bytes);assert.ok(bytes.length<250_000);assert.deepEqual([...bytes.subarray(0,3)],[255,216,255]);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);}
 assert.match(clubDefaultCover({title:'攝影社'}),/community/);assert.match(clubDefaultCover({title:'Yoga'}),/yoga/);assert.match(clubDefaultCover({title:'路跑社'}),/running/);assert.match(clubDefaultCover({title:'羽球社'}),/badminton/);
 const f=clubFixture();try{let calls=0;f.deps.callAi=async()=>{calls++;throw new Error('Unexpected AI read');};const before=f.sqlite.prepare('SELECT * FROM welfare_clubs ORDER BY id').all();
  for(const lang of ['zh','id','th']){const result=await(await f.call('/api/clubs?lang='+lang)).json();for(const club of result.clubs){assert.equal(club.cover_url,clubDefaultCover({id:club.id}));assert.equal(club.cover_is_default,true);assert.equal(club.cover_default_url,club.cover_url);}}
  assert.equal(calls,0);assert.deepEqual(f.sqlite.prepare('SELECT * FROM welfare_clubs ORDER BY id').all(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_actions').get().n,0);
 }finally{f.close();}
});

test('uploaded cover stays private until confirmed save; public cover does not expose the employee album or raw key',async()=>{
 const f=clubFixture();try{const uploaded=await(await f.upload()).json(),club=f.club('club-yoga');
  assert.equal((await f.call('/club-cover/club-yoga')).status,404);assert.equal((await f.call('/club-media/'+uploaded.id)).status,404);
  assert.equal((await f.call('/club-media/'+uploaded.id+'?manage=1',null,'test-admin')).status,200);
  const requestId=crypto.randomUUID();const data={...club,cover_media_id:uploaded.id};
  assert.equal((await f.save('club',data,1,{request_id:requestId})).status,200);assert.equal((await(await f.save('club',data,1,{request_id:requestId})).json()).replayed,true);
  const response=await f.call('/club-cover/club-yoga?v=2');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[255,216,255,217]);
  assert.equal((await f.call('/club-media/'+uploaded.id)).status,404);
  const shown=(await(await f.call('/api/clubs')).json()).clubs.find(c=>c.id===club.id);assert.equal(shown.cover_url,'/club-cover/club-yoga?v=2');assert.equal(shown.cover_is_default,false);assert.ok(!JSON.stringify(shown).includes('club_private_media_'));
  const audit=f.sqlite.prepare("SELECT * FROM welfare_club_actions WHERE kind='club'").get();assert.equal(JSON.parse(audit.after_json).cover_media_id,uploaded.id);
  assert.equal((await f.save('club',{...f.club(club.id),cover_media_id:''},2)).status,200);assert.equal((await f.call('/club-cover/club-yoga?v=2')).status,404);assert.equal(f.files.size,1);assert.equal((await f.call('/club-media/'+uploaded.id+'?manage=1',null,'test-admin')).status,200);
 }finally{f.close();}
});

test('cross-club, nonexistent, unauthorized and unconfirmed cover choices cannot publish or call AI',async()=>{
 const f=clubFixture();try{const uploaded=await(await f.upload('club-badminton')).json(),club=f.club('club-yoga');let calls=0;f.deps.callAi=async()=>{calls++;throw new Error('Unexpected provider');};
  for(const cover of [uploaded.id,'missing-media','javascript:alert(1)',null])assert.equal((await f.save('club',{...club,cover_media_id:cover},1)).status,400);
  const body={kind:'club',data:{...club,cover_media_id:uploaded.id},revision:1,confirmed:true,request_id:crypto.randomUUID()};assert.equal((await f.call('/admin-api/clubs',body,'')).status,403);assert.equal((await f.save('club',club,1,{confirmed:false})).status,400);
  assert.equal(calls,0);assert.equal(f.club(club.id).revision,1);assert.equal((await f.call('/club-cover/club-yoga')).status,404);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_club_actions WHERE kind='club'").get().n,0);
 }finally{f.close();}
});

test('legacy saves retain cover, stale saves fail, hiding or archiving club immediately blocks public cover',async()=>{
 const f=clubFixture();try{const uploaded=await(await f.upload()).json();assert.equal((await f.save('club',{...f.club('club-yoga'),cover_media_id:uploaded.id},1)).status,200);
  const legacy={...f.club('club-yoga')};delete legacy.cover_media_id;assert.equal((await f.save('club',legacy,2)).status,200);assert.equal(f.club('club-yoga').cover_media_id,uploaded.id);
  assert.equal((await f.save('club',{...legacy,cover_media_id:''},2)).status,409);assert.equal((await f.call('/club-cover/club-yoga')).status,200);
  assert.equal((await f.save('club',{...f.club('club-yoga'),published:false},3)).status,200);assert.equal((await f.call('/club-cover/club-yoga')).status,404);assert.equal((await(await f.call('/api/clubs')).json()).clubs.some(c=>c.id==='club-yoga'),false);
  assert.equal((await f.save('club',{...f.club('club-yoga'),published:true},4)).status,200);assert.equal((await f.call('/club-cover/club-yoga')).status,200);
  assert.equal((await f.save('club',{...f.club('club-yoga'),status:'archived',published:true},5)).status,200);assert.equal((await f.call('/club-cover/club-yoga')).status,404);assert.equal((await f.call('/club-media/'+uploaded.id+'?manage=1',null,'test-admin')).status,200);
 }finally{f.close();}
});

test('translation failure cannot partially publish a new cover and retry commits source, locales and cover together',async()=>{
 const f=clubFixture();try{const uploaded=await(await f.upload()).json(),before=f.club('club-yoga'),data={...before,description:'新封面介紹',cover_media_id:uploaded.id},requestId=crypto.randomUUID();
  f.deps.callAi=async()=>{throw new Error('Provider unavailable');};assert.equal((await f.save('club',data,1,{request_id:requestId})).status,503);assert.deepEqual(f.club('club-yoga'),before);assert.equal((await f.call('/club-cover/club-yoga')).status,404);
  f.deps.callAi=async (_env,m)=>({texts:JSON.parse(m[1].content).texts.map(t=>'translated: '+t)});assert.equal((await f.save('club',data,1,{request_id:requestId})).status,200);assert.equal(f.club('club-yoga').cover_media_id,uploaded.id);assert.equal(f.club('club-yoga').translations.th.description,'translated: 新封面介紹');assert.equal((await f.call('/club-cover/club-yoga')).status,200);
 }finally{f.close();}
});
