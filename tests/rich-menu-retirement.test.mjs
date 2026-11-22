import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
import {planRetiredIdentityMenus,queueRetiredIdentityMenus,repairRetiredMenuForUser,repairRetiredMenuPayload} from '../src/rich-menu-retirement.js';

const id=n=>'richmenu-'+String(n).padStart(32,'0'),uid='U'+'a'.repeat(32);
const projects=[['main','guest_zh',3],['indo','indo-menu',4],['thai','new-rich-menu',5]].map(([id_,alias,n])=>({id:id_,config_json:JSON.stringify({aliasId:alias}),deployed_rich_menu_id:id(n)}));
const rules=[['twmem-menu','zh-TW',1],['taimem-menu','th',2],['indo-menu','id',4]].map(([alias,language,n])=>({target_type:'employee',language,rich_menu_alias_id:alias,rich_menu_id:id(n)}));
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE rich_menu_projects(id,config_json,deployed_rich_menu_id);CREATE TABLE rich_menu_bindings(target_type,language,rich_menu_alias_id,rich_menu_id);CREATE TABLE system_settings(setting_key PRIMARY KEY,setting_value,updated_at);');
 for(const p of projects)sql.prepare('INSERT INTO rich_menu_projects VALUES(?,?,?)').run(p.id,p.config_json,p.deployed_rich_menu_id);
 for(const r of rules)sql.prepare('INSERT INTO rich_menu_bindings VALUES(?,?,?,?)').run(r.target_type,r.language,r.rich_menu_alias_id,r.rich_menu_id);
 const db={prepare(q){const bind=(...args)=>({all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(q).run(...args).changes)}})});return {...bind(),bind};}};
 return {db,sql,env:{DB:db,LINE_CHANNEL_ACCESS_TOKEN:'synthetic-local-token'}};
}

test('retirement maps only archived Chinese/Thai IDs to their current same-language projects',()=>{
 assert.deepEqual(planRetiredIdentityMenus(projects,rules),[{from:id(1),to:id(3),projectId:'main',aliasId:'guest_zh'},{from:id(2),to:id(5),projectId:'thai',aliasId:'new-rich-menu'}]);
 assert.deepEqual(planRetiredIdentityMenus(projects,[{...rules[0],target_type:'admin'},{...rules[1],language:'id'},{...rules[0],rich_menu_id:id(4)}]),[]);
});
test('ambiguous projects, conflicting sources, unpublished and malformed targets never produce links',()=>{
 assert.deepEqual(planRetiredIdentityMenus([...projects,{...projects[0],id:'duplicate'}],[rules[0]]),[]);
 assert.deepEqual(planRetiredIdentityMenus(projects,[rules[0],{...rules[1],rich_menu_id:id(1)}]),[]);
 assert.deepEqual(planRetiredIdentityMenus([{...projects[0],deployed_rich_menu_id:''}],[rules[0]]),[]);
 assert.deepEqual(planRetiredIdentityMenus(projects,[{...rules[0],rich_menu_id:'bad'}]),[]);
});
test('existing refresh queue receives only explicit same-language retired sources and preserves original source ownership',async()=>{
 const f=fixture();try{await queueRetiredIdentityMenus(f.db);await queueRetiredIdentityMenus(f.db);const rows=f.sql.prepare('SELECT setting_value FROM system_settings ORDER BY setting_key').all().map(r=>JSON.parse(r.setting_value));assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.projectId),['main','thai']);
 f.sql.prepare('UPDATE system_settings SET setting_value=? WHERE setting_key=?').run(JSON.stringify({from:id(1),projectId:'original-owner'}),'rich_menu_refresh_source_v1:'+id(1));await queueRetiredIdentityMenus(f.db);assert.equal(JSON.parse(f.sql.prepare('SELECT setting_value FROM system_settings WHERE setting_key=?').get('rich_menu_refresh_source_v1:'+id(1)).setting_value).projectId,'original-owner');
 }finally{f.sql.close();}
});
test('known old menus are repaired and read back; no LINE message, default or unlink operation is used',async()=>{
 for(const [from,to] of [[1,3],[2,5]]){const f=fixture(),calls=[],records=[];let current=id(from);try{
 const result=await repairRetiredMenuForUser(f.db,f.env,uid,{record:async r=>records.push(r),fetcher:async(url,init)=>{calls.push([url,init.method||'GET']);if(init.method==='POST'){assert.equal(url.endsWith('/'+id(to)),true);current=id(to);return new Response('{}');}return Response.json({richMenuId:current});}});
 assert.equal(result.state,'repaired');assert.equal(records[0].ok,true);assert.equal(calls.length,4);assert.equal(calls.filter(c=>c[1]==='POST').length,1);assert.ok(calls.every(c=>c[0].includes('/user/'+uid+'/richmenu')));
 }finally{f.sql.close();}}
});
test('current language selections, admin/vendor/unknown menus and missing per-user assignments are preserved',async()=>{
 for(const current of [id(3),id(4),id(5),id(999),'']){const f=fixture();let calls=0;try{const result=await repairRetiredMenuForUser(f.db,f.env,uid,{fetcher:async(_url,init)=>{calls++;assert.equal(init.method,undefined);return current?Response.json({richMenuId:current}):new Response('{}',{status:404});}});assert.equal(result.state,'preserved');assert.equal(calls,1);}finally{f.sql.close();}}
});
test('a language switch during the check cancels repair rather than overwriting the newer selection',async()=>{
 const f=fixture();let calls=0;try{const result=await repairRetiredMenuForUser(f.db,f.env,uid,{fetcher:async(_u,init)=>{assert.equal(init.method,undefined);return Response.json({richMenuId:++calls===1?id(1):id(4)});}});assert.equal(result.state,'changed');assert.equal(calls,2);}finally{f.sql.close();}
});
test('exhausted background budget defers repair without issuing a LINE request',async()=>{
 const f=fixture();try{const result=await repairRetiredMenuForUser(f.db,f.env,uid,{deadline:Date.now()-1,fetcher:async()=>{throw Error('No budget for this request');}});assert.equal(result.state,'deferred');}finally{f.sql.close();}
});
test('HTTP failures and uncertain sends never report verified or post to a fallback menu',async()=>{
 for(const failure of ['http','network','mismatch']){const f=fixture();let post=false;const records=[];try{
 const result=await repairRetiredMenuForUser(f.db,f.env,uid,{record:async r=>records.push(r),fetcher:async(_u,init)=>{if(init.method==='POST'){post=true;if(failure==='network')throw Error('unavailable');return new Response('{}',{status:failure==='http'?403:200});}return Response.json({richMenuId:post&&failure==='mismatch'?id(4):id(1)});}});
 assert.equal(result.state,failure==='network'?'deferred':'unverified');assert.ok(records.every(r=>r.ok===false));
 }finally{f.sql.close();}}
});
test('only signed private follow/message/postback subjects qualify; repeated subjects are deduplicated',async()=>{
 const f=fixture(),original=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;return Response.json({richMenuId:id(3)});};
 const event=(type,sourceType='user')=>({type,source:{type:sourceType,userId:uid}});
 await repairRetiredMenuPayload(JSON.stringify({events:[event('follow')]}),f.env,false);assert.equal(calls,0);
 await repairRetiredMenuPayload(JSON.stringify({events:[event('message','group'),event('unfollow')]}),f.env,true);assert.equal(calls,0);
 await repairRetiredMenuPayload(JSON.stringify({events:[event('follow'),event('message'),event('postback')]}),f.env,true);assert.equal(calls,1);
 }finally{globalThis.fetch=original;f.sql.close();}
});
test('cancelled page/API return 410 even for old save/seed/delete clients and never touch D1',async()=>{
 const db={prepare(){throw Error('Cancelled feature must not query or mutate D1');}};
 for(const path of ['/rich-menu-bindings','/admin-api/rich-menu-bindings'])for(const method of ['GET','POST']){
 const r=await worker.fetch(new Request('https://test'+path,{method,...(method==='POST'?{body:JSON.stringify({action:'seed'})}:{})}),{DB:db},{});
 assert.equal(r.status,410);assert.match(await r.text(),/已取消/);
 }
});
test('employee callbacks and all identity selection paths cannot link or recreate cancelled rules',async()=>{
 const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 for(const name of ['selectRichMenuBindingForIdentity','applyRichMenuForEmployeeBinding']){
 const start=source.indexOf('async function '+name+'('),end=source.indexOf('\n}',start)+2;
 const fn=vm.runInNewContext('('+source.slice(start,end)+')',{});const result=await fn(new Proxy({},{get(){throw Error('No DB/API access');}}),{},{});
 if(name.startsWith('select'))assert.equal(result,null);else{assert.equal(result.applied,false);assert.equal(result.reason,'identity_menu_retired');}
 }
});
test('admin shell keeps ordinary Rich Menu editing and removes identity-binding navigation and handlers',async()=>{
 const html=await(await worker.fetch(new Request('https://test/sakura-admin'),{},{})).text();
 assert.ok(html.includes('["rich-menu",'));assert.ok(!html.includes('["rich-bind",'));assert.ok(!html.includes('data-open-module="rich-bind"'));assert.ok(!html.includes("if(id==='rich-bind')"));
});
