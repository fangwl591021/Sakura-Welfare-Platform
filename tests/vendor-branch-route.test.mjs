import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {documentFixture} from './vendor-public-documents-fixture.mjs';
import {handleVendorBenefitAccess} from '../src/vendor-benefit-access.js';
import {readVendorBranchSelection} from '../src/vendor-branch-picker.js';

const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const start=source.indexOf('    if (request.method === "GET" && url.pathname === "/api/vendor-store") {');
const end=source.indexOf('    if (request.method === "POST" && url.pathname === "/api/vendor-store/profile") {',start);
assert.ok(start>=0&&end>start,'actual vendor store route is present');
const runRoute=new (Object.getPrototypeOf(async function(){}).constructor)('request','url','DB','env','corsJson','getVendorStorefront','applyVendorPortalCookieToUrl','readVendorBranchSelection','googleMapsSearchUrl',source.slice(start,end));
const ORIGIN='https://fixture.test',UID='U'+'1'.repeat(32);
function setup(){
  const f=documentFixture();
  f.sqlite.exec(`ALTER TABLE welfare_members ADD COLUMN bind_status TEXT DEFAULT 'unbound';
    INSERT INTO welfare_members(id,line_user_id,display_name,member_type,status,bind_status) VALUES('emp','${UID}','員工','employee','active','bound');
    UPDATE welfare_vendors SET company_address='品牌地址',phone='品牌電話' WHERE id='a';
    INSERT INTO welfare_vendor_locations(id,vendor_id,branch_name,address,contact_phone,business_hours,status) VALUES
      ('a-one','a','甲店','甲地址','甲電話','星期一 09:00','active'),
      ('a-two','a','乙店','','','星期二 10:00','active'),
      ('a-hidden','a','隱藏店','不公開地址','','','hidden'),
      ('b-one','b','其他品牌','其他地址','','','active');`);
  const env={...f.env,LINE_CHANNEL_SECRET:'synthetic-secret'};
  const deps={readVendorPortalCookie:()=>null,verifyVendorPortalToken:f.context.verifyVendorPortalToken,requireAdmin:async()=>({ok:false}),liffId:'fixture',verifyLine:async(_env,token)=>token==='employee'?{lineUserId:UID}:null,ensureBinding:async()=>{}};
  const next=(req,access)=>runRoute(req,new URL(req.url),f.db,{...env,benefitRead:access},Response.json,f.context.getVendorStorefront,(_r,url)=>url,readVendorBranchSelection,q=>'https://maps.google.com/?q='+encodeURIComponent(q));
  const read=(path,headers={})=>handleVendorBenefitAccess(new Request(ORIGIN+path,{headers}),env,deps,next);
  return {...f,read};
}
test('real store route scopes branches and preserves benefit visibility and owner editing data',async()=>{
 const f=setup();try{
  let response=await f.read('/api/vendor-store?vendor_id=a');let j=await response.json();
  assert.equal(response.status,200);assert.equal(j.data.branchSelection.selectionRequired,true);assert.equal(j.data.vendor.address,'');assert.equal(j.data.vendor.phone,'');assert.equal(j.data.vendor.map_url,'');assert.equal(j.data.vendor.discount_policy,'');assert.deepEqual(j.data.offers,[]);assert.deepEqual(j.data.locations.map(x=>x.id).sort(),['a-one','a-two']);
  response=await f.read('/api/vendor-store?vendor_id=a&location_id=a-two',{'X-Line-Id-Token':'employee'});j=await response.json();
  assert.equal(j.data.branchSelection.selected.id,'a-two');assert.equal(j.data.vendor.address,'');assert.equal(j.data.vendor.phone,'');assert.equal(j.data.vendor.map_url,'');assert.equal(j.data.vendor.discount_policy,'Legacy policy');
  response=await f.read('/api/vendor-store?vendor_id=a&location_id=a-one&portal_token=token-a');j=await response.json();
  assert.equal(j.data.canEdit,true);assert.equal(j.data.vendor.address,'甲地址');assert.equal(j.data.vendor.phone,'甲電話');assert.equal(j.data.vendor.editing_phone,'品牌電話');assert.ok(j.data.editorLocations.some(x=>x.id==='a-hidden'));
  for(const id of ['b-one','a-hidden','not-found']){response=await f.read('/api/vendor-store?vendor_id=a&location_id='+id,{'X-Line-Id-Token':'employee'});assert.equal(response.status,404);assert.equal((await response.json()).success,false)}
  f.sqlite.exec("UPDATE welfare_vendors SET status='pending' WHERE id='a'");response=await f.read('/api/vendor-store?vendor_id=a',{'X-Line-Id-Token':'employee'});assert.equal(response.status,404);
  assert.ok(f.queries.every(sql=>!/^\s*(UPDATE|INSERT|DELETE|ALTER|CREATE)/i.test(sql)));
 }finally{f.close()}
});
