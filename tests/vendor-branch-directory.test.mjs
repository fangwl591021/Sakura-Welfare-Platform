import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSelectedBrandCards,branchCountLabel,filterSelectedBrandDirectoryRows} from '../src/vendor-branch-directory.js';

test('only intended vendor IDs are grouped and branch filter does not create a fake address',()=>{
  const original=[{id:'a',vendorId:'skylark-group-v1-grazie',name:'古拉爵',branchName:'中友',address:'A',storeUrl:'/vendor-store?vendor_id=skylark-group-v1-grazie'},
    {id:'b',vendorId:'skylark-group-v1-grazie',name:'古拉爵',branchName:'豐原',address:'B'},
    {id:'c',vendorId:'other',name:'其他',branchName:'甲',address:'C'},
    {id:'d',vendorId:'other',name:'其他',branchName:'乙',address:'D'}];
  const cards=groupSelectedBrandCards(original);
  assert.equal(cards.length,3);assert.equal(cards[0].name,'古拉爵');assert.equal(cards[0].branchCount,2);
  assert.equal(cards[0].address,'');assert.equal(cards[0].branchName,'');assert.equal(cards[0].phone,'');
  assert.equal(cards[1],original[2]);assert.equal(cards[2],original[3]);
  const searched=groupSelectedBrandCards([original[1]],original);
  assert.equal(searched[0].branchCount,2);assert.equal(searched[0].branchName,'');
  assert.equal(original[0].address,'A');assert.match(cards[0].storeUrl,/vendor_id=skylark-group-v1-grazie/);
});
test('draft brand fallbacks and inactive branches cannot become directory cards',()=>{
  const v='skylark-group-v1-grazie';
  const rows=[{id:null,vendor_id:v,status:'active'},{id:'1',vendor_id:v,status:'hidden'},{id:'2',vendor_id:v,status:'inactive'},{id:'3',vendor_id:v,status:'active'},{id:null,vendor_id:'other',status:'active'}];
  assert.deepEqual(filterSelectedBrandDirectoryRows(rows),[rows[3],rows[4]]);
});
test('branch count labels support the three existing locales',()=>{
  assert.equal(branchCountLabel(2,'zh'),'共 2 間分店');
  assert.equal(branchCountLabel(2,'id'),'Total 2 cabang');
  assert.equal(branchCountLabel(2,'th'),'รวม 2 สาขา');
});
