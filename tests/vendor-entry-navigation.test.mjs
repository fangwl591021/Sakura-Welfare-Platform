import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.js';
import {buildLifeInfoStationMessage} from '../src/life-info-station.js';
for(const [suffix,locale,title,directory] of [['','zh','特約店家','特約店家'],['-id','id','Toko Mitra','Toko Mitra'],['-th','th','ร้านค้าสวัสดิการ','ร้านค้าสวัสดิการ']]) {
 const quickLabels=buildLifeInfoStationMessage(locale,'https://test.invalid',path=>'https://liff.line.me/test'+path).quickReply.items.map(item=>item.action.label);
 test('information-station tabs and title preserve '+(suffix||'zh')+' directory and scripts',async()=>{
  for(const alias of ['/featured-partner-stores','/current-offers']){
   const response=await worker.fetch(new Request('https://test.invalid'+alias+suffix),{},{});assert.equal(response.status,200);const html=await response.text();
   assert.ok(html.includes('<title>'+quickLabels[0]+'</title>'));assert.ok(html.includes('aria-label="'+directory+'"'));
   if(!suffix)for(const label of ['本期優惠','特約店家','活動專區','社團資訊'])assert.ok(html.includes('aria-label="'+label+'"'),label);
   const ids=['fa-tab-stores','fa-tab-directory','fa-tab-activities','fa-tab-clubs'];for(let i=1;i<ids.length;i++)assert.ok(html.indexOf('id="'+ids[i-1]+'"')<html.indexOf('id="'+ids[i]+'"'));
   for(const [,script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
   assert.match(html,/\/api\/featured-partner-stores/);assert.match(html,/\/api\/partner-stores/);
   assert.match(html,/version!==storeReadVersion/);assert.match(html,/new URLSearchParams\(location.search\).get\("view"\)!=="directory"/);
  }
 });
 test('existing standalone partner URL remains available '+(suffix||'zh'),async()=>{
  const html=await(await worker.fetch(new Request('https://test.invalid/partner-stores'+suffix),{},{})).text();assert.ok(html.includes('<title>'+title+'</title>'));assert.doesNotMatch(html,/id="fa-tab-directory"/);
 });
}
