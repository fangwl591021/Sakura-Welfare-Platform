import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validatePublicDocument, DOCUMENT_MAX_BYTES } from '../src/vendor-public-documents.js';
import { documentFixture,pdf,requestId } from './vendor-public-documents-fixture.mjs';

const payload=(extra={})=>({action:'upload',request_id:requestId(),title:'Employee PDF',...extra});
async function create(f,extra={}){const result=await f.mutation(payload(extra),pdf());assert.equal(result.success,true);return result.data.items[0];}

test('public documents default hidden; explicit publication gives safe customer preview/download',async()=>{
 const f=documentFixture();try{
 const previous=f.row().discount_policy;const item=await create(f);
 assert.equal(item.status,'hidden');assert.equal((await f.list()).data.items.length,0);assert.equal((await f.download(item.id)).status,404);
 assert.equal((await f.mutation({action:'update',request_id:requestId(),id:item.id,revision:item.revision,status:'published'})).status,400);
 const result=await f.mutation({action:'update',request_id:requestId(),id:item.id,revision:item.revision,status:'published',confirmed:true,title:'<script>safe text</script>'});assert.equal(result.success,true);
 const publicRows=(await f.list()).data.items;assert.equal(publicRows.length,1);assert.equal(publicRows[0].storage_key,undefined);
 const preview=await f.download(item.id);assert.equal(preview.status,200);assert.equal(preview.headers.get('Content-Type'),'application/pdf');assert.match(preview.headers.get('Content-Disposition'),/^inline/);
 const download=await f.download(item.id,'?download=1');assert.match(download.headers.get('Content-Disposition'),/^attachment/);assert.match(download.headers.get('Content-Disposition'),/filename\*=UTF-8/);assert.equal(download.headers.get('Cache-Control'),'no-store');assert.equal(download.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(f.row().discount_policy,previous);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_vendor_public_document_actions').get().n,2);
 }finally{f.close();}
});

test('both store state and file state are checked on every direct download',async()=>{
 const f=documentFixture();try{const item=await create(f,{status:'published',confirmed:true});
 for(const status of ['suspended','pending','rejected']){f.sqlite.prepare('UPDATE welfare_vendors SET status=? WHERE id=?').run(status,'a');assert.equal((await f.download(item.id)).status,404);assert.equal((await f.list()).status,404);}
 f.sqlite.exec("UPDATE welfare_vendors SET status='approved',is_hidden=1 WHERE id='a'");assert.equal((await f.download(item.id)).status,404);
 f.sqlite.exec("UPDATE welfare_vendors SET is_hidden=0 WHERE id='a'");assert.equal((await f.download(item.id)).status,200);
 const result=await f.mutation({action:'archive',request_id:requestId(),id:item.id,revision:item.revision});assert.equal(result.success,true);assert.equal((await f.download(item.id)).status,404);assert.equal(f.bucket.size,1);assert.equal((await f.list(true)).data.items.length,0);
 }finally{f.close();}
});

test('upload retry is idempotent; conflicting reuse and cross-vendor changes are denied',async()=>{
 const f=documentFixture();try{const data=payload(),file=pdf();const first=await f.mutation(data,file),second=await f.mutation(data,file);assert.equal(second.duplicate,true);assert.equal(f.uploads.length,1);assert.equal(first.data.items[0].id,second.data.items[0].id);
 assert.equal((await f.mutation({...data,title:'other'},file)).status,409);
 assert.equal((await f.mutation(payload(),file,'token-b')).status,403);
 const item=first.data.items[0];assert.equal((await f.mutation({action:'update',request_id:requestId(),id:item.id,revision:1,title:'steal'},null,'token-b',false,'b')).status,404);
 }finally{f.close();}
});

for(const token of ['','bad','stale','token-b'])test('invalid portal identity denied before upload: '+token,async()=>{const f=documentFixture();try{assert.equal((await f.mutation(payload(),pdf(),token)).status,403);assert.equal(f.uploads.length,0);}finally{f.close();}});
for(const token of ['','bad','viewer'])test('invalid admin role denied: '+token,async()=>{const f=documentFixture();try{assert.equal((await f.mutation(payload(),pdf(),token,true)).status,403);assert.equal(f.uploads.length,0);}finally{f.close();}});

test('valid admin shares the same records and cross-origin requests cannot write',async()=>{const f=documentFixture();try{const result=await f.mutation(payload(),pdf(),'admin',true);assert.equal(result.success,true);assert.equal((await f.list(true)).data.items.length,1);assert.equal(f.sqlite.prepare('SELECT actor_type FROM welfare_vendor_public_document_actions').get().actor_type,'admin');assert.equal((await f.mutation(payload(),pdf(),'admin',true,'a',{Origin:'https://evil.test'})).status,403);}finally{f.close();}});

test('replacement preserves record, old original and audit; stale edits conflict',async()=>{const f=documentFixture();try{let item=await create(f,{status:'published',confirmed:true});const original=f.sqlite.prepare('SELECT storage_key FROM welfare_vendor_public_documents').get().storage_key;
 const result=await f.mutation({action:'replace',request_id:requestId(),id:item.id,revision:item.revision,status:'hidden',title:'Replacement'},pdf('新版.pdf'));assert.equal(result.success,true);assert.equal(result.data.items[0].id,item.id);assert.equal(result.data.items[0].revision,2);assert.equal(f.bucket.has(original),true);assert.equal(f.bucket.size,2);assert.equal((await f.download(item.id)).status,404);
 assert.equal((await f.mutation({action:'update',request_id:requestId(),id:item.id,revision:1,title:'stale'})).status,409);
 }finally{f.close();}});

test('atomic audit failure rolls back metadata and cleans only newly uploaded object',async()=>{const f=documentFixture();try{f.auditFailure(true);assert.equal((await f.mutation(payload(),pdf())).status,503);assert.equal(f.bucket.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendor_public_documents').get().n,0);assert.equal(f.deletions.length,1);}finally{f.close();}});
test('concurrent suspension prevents publication and cleans provisional upload',async()=>{const f=documentFixture();try{f.race(()=>f.sqlite.exec("UPDATE welfare_vendors SET status='suspended' WHERE id='a'"));assert.equal((await f.mutation(payload({status:'published',confirmed:true}),pdf())).status,409);assert.equal(f.bucket.size,0);}finally{f.close();}});
test('count, request size, order and revision constraints do not create extra documents',async()=>{const f=documentFixture();try{for(let i=0;i<20;i++)await create(f);assert.equal((await f.mutation(payload(),pdf())).status,409);assert.equal(f.bucket.size,20);
 assert.equal((await f.mutation(payload({display_order:0}),pdf())).status,400);
 const response=await f.handler(new Request('https://fixture.test/api/vendor-store/documents?vendor_id=a',{method:'POST',headers:{Authorization:'Bearer token-a','Content-Type':'multipart/form-data; boundary=x','Content-Length':String(DOCUMENT_MAX_BYTES+200000)},body:'x'}));assert.equal(response.status,413);
 }finally{f.close();}});

test('file allowlist validates nonempty size, MIME and signatures; 50 MB PDF accepted',async()=>{
 assert.equal(await validatePublicDocument(pdf()),'application/pdf');
 assert.equal(await validatePublicDocument(pdf('large.pdf',DOCUMENT_MAX_BYTES)),'application/pdf');
 for(const file of [new File(['x'],'bad.pdf',{type:'application/pdf'}),new File(['%PDF-x'],'bad.html',{type:'text/html'}),new File(['%PDF-x'],'bad.pdf',{type:'text/html'}),new File([],'empty.pdf'),pdf('too-large.pdf',DOCUMENT_MAX_BYTES+1),new File(['PK\x03\x04hello'],'not-word.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})])await assert.rejects(()=>validatePublicDocument(file));
 assert.equal(await validatePublicDocument(new File([new Uint8Array([255,216,255,0])],'x.jpg',{type:'image/jpeg'})),'image/jpeg');
 assert.equal(await validatePublicDocument(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'x.png',{type:'image/png'})),'image/png');
 assert.equal(await validatePublicDocument(new File([new Uint8Array([208,207,17,224,161,177,26,225])],'x.doc',{type:'application/msword'})),'application/msword');
});
test('legacy raw file route blocks new storage prefix; sharing and hours integration are retained',()=>{const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(source,/fileName\.startsWith\("vendor_public_document_"\)/);assert.match(source,/id="shareBtn"/);assert.match(source,/window\.SakuraVendorDocuments\.owner/);assert.match(source,/window\.SakuraVendorDocuments\.application/);assert.match(source,/handlePublicDocuments\(request, env, \{ requireAdmin, verifyVendorPortalToken, readVendorPortalCookie \}/);});

test('streaming without content length remains bounded and invalid JSON fails safely',async()=>{const f=documentFixture();try{
 for(const [body,expected] of [['x'.repeat(70000),413],['{',400]]){
  const request=new Request('https://fixture.test/api/vendor-store/documents?vendor_id=a',{method:'POST',headers:{Authorization:'Bearer token-a','Content-Type':'application/json'},body:new Blob([body]).stream(),duplex:'half'});assert.equal((await f.handler(request)).status,expected);
 }
 assert.equal(f.uploads.length,0);
 }finally{f.close();}
});

test('DOCX central directory must contain both Word document and content-type entries',async()=>{
 const names=['[Content_Types].xml','word/document.xml'];const local=[],central=[];let offset=0;
 for(const name of names){const filename=new TextEncoder().encode(name),header=new Uint8Array(30+filename.length+1),view=new DataView(header.buffer);view.setUint32(0,0x04034b50,true);view.setUint32(18,1,true);view.setUint32(22,1,true);view.setUint16(26,filename.length,true);header.set(filename,30);header[header.length-1]=32;local.push(header);const directory=new Uint8Array(46+filename.length),entry=new DataView(directory.buffer);entry.setUint32(0,0x02014b50,true);entry.setUint32(20,1,true);entry.setUint32(24,1,true);entry.setUint16(28,filename.length,true);entry.setUint32(42,offset,true);directory.set(filename,46);central.push(directory);offset+=header.length;}
 const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,2,true);view.setUint16(10,2,true);view.setUint32(12,central.reduce((n,x)=>n+x.length,0),true);view.setUint32(16,offset,true);
 assert.equal(await validatePublicDocument(new File([...local,...central,end],'預約.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
