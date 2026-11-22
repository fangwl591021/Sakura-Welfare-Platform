import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createBranchQrSvg,renderBranchQrHtml} from '../src/branch-qr.js';

test('printable branch QR shows exact vendor/branch and safe download/return controls',()=>{
  const html=renderBranchQrHtml({vendorName:'測試廠商',branchName:'<img src=x onerror=alert(1)>',locationId:'branch&one',address:'測試地址'},'https://liff.line.me/123-fixture/branch-redemption?location_id=branch%26one');
  assert.ok(html.includes('測試廠商'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('/api/branch-redemption/qr.png?location_id=branch%26one&amp;download=1'));
  assert.ok(html.includes('返回／關閉'));
  assert.ok(html.includes('店員確認後才完成核銷'));
  assert.ok(!/qrserver|portal_token|fetch\(/.test(html));
  for(const url of ['http://liff.line.me/x','https://evil.test/x','https://liff.line.me.evil.test/x','https://liff.line.me/測試']) assert.throws(()=>createBranchQrSvg(url));
});

test('independent decoder reads each generated SVG as its exact LIFF branch URL',{skip:!process.env.QR_DECODER_PATH},()=>{
  const decode=createRequire(import.meta.url)(process.env.QR_DECODER_PATH);
  for(const id of ['branch-a','branch-b','long-branch-'+ 'a'.repeat(140)]){
    const url='https://liff.line.me/123-fixture/branch-redemption?location_id='+encodeURIComponent(id);
    const svg=createBranchQrSvg(url),size=Number(svg.match(/viewBox="0 0 (\d+) /)[1]);
    const pixels=new Uint8ClampedArray(size*size*4).fill(255);
    for(const point of svg.matchAll(/M(\d+),(\d+)l(\d+),0/g)){
      const [,x,y,c]=point.map(Number);
      for(let row=y;row<y+c;row++)for(let col=x;col<x+c;col++)for(let k=0;k<3;k++)pixels[(row*size+col)*4+k]=0;
    }
    assert.equal(decode(pixels,size,size)?.data,url);
  }
});
