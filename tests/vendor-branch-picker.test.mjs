import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readVendorBranchSelection} from '../src/vendor-branch-picker.js';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE welfare_vendors (id TEXT PRIMARY KEY, status TEXT, is_hidden INTEGER);
    CREATE TABLE welfare_vendor_locations (id TEXT PRIMARY KEY,vendor_id TEXT,branch_name TEXT,city TEXT,district TEXT,address TEXT,google_maps_url TEXT,contact_phone TEXT,business_hours TEXT,holiday_notice TEXT,parking_info TEXT,latitude REAL,longitude REAL,status TEXT);
    INSERT INTO welfare_vendors VALUES('multi','approved',0),('other','approved',0),('single','approved',0),('none','approved',0),('pending','pending',0),('hidden','approved',1);
    INSERT INTO welfare_vendor_locations VALUES
      ('a','multi','甲店','臺中','','甲地址','','甲電話','09:00-18:00','','',NULL,NULL,'active'),
      ('b','multi','乙店','彰化','','乙地址','','乙電話','11:00-22:00','','',NULL,NULL,'active'),
      ('secret','multi','隱藏店','','','私密地址','','','','','',NULL,NULL,'hidden'),
      ('inactive','multi','停業店','','','停業地址','','','','','',NULL,NULL,'inactive'),
      ('foreign','other','另一品牌店','','','其他店地址','','','','','',NULL,NULL,'active'),
      ('only','single','唯一店','','','','','','','','',NULL,NULL,'active'),
      ('draft','pending','未核准店','','','不公開','','','','','',NULL,NULL,'active'),
      ('hidden-vendor','hidden','隱藏品牌店','','','不公開','','','','','',NULL,NULL,'active');`);
  return {sqlite,db:{prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}}}}}};
}
test('visible approved multi-branch vendor requires selection and returns only the assigned public branches',async()=>{
  const f=fixture();try{
    const result=await readVendorBranchSelection(f.db,'multi');
    assert.equal(result.success,true);assert.equal(result.data.selectionRequired,true);assert.equal(result.data.selected,null);
    assert.deepEqual(result.data.locations.map(x=>x.id).sort(),['a','b']);
    assert.equal(result.data.locations.find(x=>x.id==='a').address,'甲地址');assert.equal(result.data.locations.find(x=>x.id==='b').contact_phone,'乙電話');
    assert.ok(!JSON.stringify(result).includes('私密地址'));
    assert.ok(!('discount_policy' in result.data));assert.ok(!('offers' in result.data));
  }finally{f.sqlite.close()}
});
test('exact selected branch does not accept another vendor or unavailable location',async()=>{
  const f=fixture();try{
    const chosen=await readVendorBranchSelection(f.db,'multi','b');
    assert.equal(chosen.data.selected.id,'b');assert.equal(chosen.data.selected.address,'乙地址');
    for(const id of ['foreign','secret','inactive','missing']){
      const rejected=await readVendorBranchSelection(f.db,'multi',id);
      assert.equal(rejected.success,false);assert.equal(rejected.status,404);
      assert.ok(!JSON.stringify(rejected).includes(id));
    }
  }finally{f.sqlite.close()}
});
test('single and zero branches support legacy links without inventing branch data',async()=>{
  const f=fixture();try{
    const single=await readVendorBranchSelection(f.db,'single');assert.equal(single.data.selectionRequired,false);assert.equal(single.data.selected.id,'only');assert.equal(single.data.selected.address,'');
    const empty=await readVendorBranchSelection(f.db,'none');assert.equal(empty.data.selectionRequired,false);assert.deepEqual(empty.data.locations,[]);assert.equal(empty.data.selected,null);
    assert.equal((await readVendorBranchSelection(f.db,'none','only')).success,false);
  }finally{f.sqlite.close()}
});
test('pending and hidden vendors have no public branch access',async()=>{
  const f=fixture();try{
    for(const id of ['pending','hidden','missing','',"multi' OR 1=1--"]){const result=await readVendorBranchSelection(f.db,id);assert.equal(result.success,false);assert.equal(result.status,404);assert.equal('data' in result,false)}
  }finally{f.sqlite.close()}
});
test('all active branches remain selectable beyond the old eight-row limit',async()=>{
  const f=fixture();try{
    for(let i=0;i<12;i++)f.sqlite.prepare(`INSERT INTO welfare_vendor_locations(id,vendor_id,branch_name,status) VALUES(?,?,?,?)`).run('extra'+i,'multi','分店'+i,'active');
    const all=await readVendorBranchSelection(f.db,'multi');assert.equal(all.data.locations.length,14);
    const tail=await readVendorBranchSelection(f.db,'multi','extra11');assert.equal(tail.data.selected.id,'extra11');
  }finally{f.sqlite.close()}
});
