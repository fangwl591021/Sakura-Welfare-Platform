import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handleRichMenuChatTurn, inspectMenuImage, readMenuImage, RICH_MENU_CHAT_START, MENU_IMAGE_ERROR } from '../src/workspace/rich-menu-chat.js';
import { getWorkspaceAgentSession, saveWorkspaceAgentSession } from '../src/workspace/workspace-agent-session.js';
import { handleWorkspaceAgentTurn } from '../src/workspace/workspace-agent-entry-handler.js';

function crc(bytes) { let v = 0xffffffff; for (const b of bytes) { v ^= b; for (let j = 0; j < 8; j++) v = v & 1 ? (v >>> 1) ^ 0xedb88320 : v >>> 1; } return (v ^ 0xffffffff) >>> 0; }
export function png(width = 2500, height = 1686) {
  const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((width * 3 + 1) * height))),chunk('IEND',Buffer.alloc(0))]);
}
const GOOD = png(), WRONG = png(2500,1685);
export function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE workspace_agent_sessions(line_user_id TEXT PRIMARY KEY,agent_name TEXT,current_step TEXT,status TEXT,payload_json TEXT,created_at TEXT,updated_at TEXT,expires_at TEXT);
    CREATE TABLE admin_uid_whitelist(id INTEGER PRIMARY KEY,line_user_id TEXT,display_name TEXT,role TEXT,allowed_modules TEXT,active INTEGER,note TEXT);
    CREATE TABLE system_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT,updated_at TEXT);
    INSERT INTO admin_uid_whitelist VALUES(1,'admin','','admin','*',1,''),(2,'other-admin','','operator','line',1,''),(3,'viewer','','viewer','*',1,''),(4,'vendor-admin','','operator','vendor',1,'');`);
  const db = { prepare(sql) { const q = sqlite.prepare(sql); return { args: [],bind(...a) { this.args = a; return this; },async run() { return { meta: q.run(...this.args) }; },async all() { return { results: q.all(...this.args) }; },async first() { return q.get(...this.args) || null; } }; } };
  const projects = ['guest_zh','indo-menu','new-rich-menu'].map((aliasId,i) => ({ id: `project-${i+1}`, name: aliasId, aliasId, chatBarText: '選單', owner_uid: 'original-owner', isDefaultHome: i === 0, deployedRichMenuId: `richmenu-old-${i+1}`, config: { name: aliasId, aliasId, chatBarText: '選單', selected: true, size: { width:2500,height:1686 }, areas: [{ bounds: { x:0,y:0,width:1250,height:1686 }, action: { type:'uri',uri:'https://example.com/unchanged' } },{ bounds:{x:1250,y:0,width:1250,height:1686},action:{type:'richmenuswitch',richMenuAliasId:'indo-menu',data:'switch:indo-menu'} }] } }));
  const calls = [], order = []; let content = GOOD, fetchError = false, ack = true;
  const env = { DB:db,LINE_CHANNEL_ACCESS_TOKEN:'synthetic-test-token' };
  const options = { db,env,loadProjects:async()=>projects,loadProject:async(id)=>projects.find(p=>p.id===id),fetcher:async(url)=>{ calls.push({ type:'content',url }); if(fetchError)throw Error('synthetic');return new Response(content); },reply:async(message)=>{ order.push('ack');return {ok:ack}; },publish:async(data)=>{order.push('publish');calls.push({type:'publish',data});return {success:true,data:{richMenuId:'richmenu-new'}};} };
  const turn = (input, overrides={}) => handleRichMenuChatTurn({ ...options,item:{LINE_user_id:'admin',sourceType:'user',activitySignatureVerified:true,text:input,messageType:'text',messageId:'message-1',...overrides} });
  const select = async(slot='1',user='admin')=>{const start=await turn('',{postbackData:RICH_MENU_CHAT_START,LINE_user_id:user}); return turn('',{postbackData:start.message.quickReply.items[Number(slot)-1].action.data,LINE_user_id:user});};
  return {sqlite,db,env,projects,calls,order,options,turn,select,setContent:v=>content=v,setFetchError:v=>fetchError=v,setAck:v=>ack=v,publishes:()=>calls.filter(c=>c.type==='publish')};
}

test('PNG byte dimensions and strict size boundary reject wrong, empty, truncated and unsupported images',()=>{
  assert.equal(inspectMenuImage(GOOD).contentType,'image/png');
  for(const bytes of [WRONG,png(1686,2500),new Uint8Array(),GOOD.subarray(0,-5),new Uint8Array(1000000),Buffer.from('GIF89a')])assert.equal(inspectMenuImage(bytes),null);
  const padded=Buffer.alloc(999999);GOOD.copy(padded);assert.equal(inspectMenuImage(padded),null,'trailing garbage is not a PNG');
});
test('stream limit applies even with missing or misleading content length',async()=>{
  for(const headers of [{},{'content-length':'1'},{'content-length':'1000000'}])assert.equal(await readMenuImage({LINE_CHANNEL_ACCESS_TOKEN:'test'},'1',async()=>new Response(new Uint8Array(1000000),{headers})),null);
  assert.equal((await readMenuImage({LINE_CHANNEL_ACCESS_TOKEN:'test'},'1',async()=>new Response(GOOD,{headers:{'content-type':'application/octet-stream'}}))).width,2500);
});
test('unrelated conversations and existing activity sessions remain outside the menu handler',async()=>{
  const f=fixture();assert.equal(await f.turn('一般對話'),null);
  await saveWorkspaceAgentSession(f.db,{lineUserId:'admin',agent:'activity',step:'title'});assert.equal(await f.turn('活動名稱'),null);
  assert.equal((await getWorkspaceAgentSession(f.db,'admin')).agent,'activity');
});
test('three quick replies have fixed locale mapping and upload prompt states image requirements',async()=>{
  const f=fixture(),r=await f.turn('',{postbackData:RICH_MENU_CHAT_START});assert.deepEqual(r.message.quickReply.items.map(b=>b.action.label),['1','2','3']);
  assert.match(r.message.text,/1：中文.*2：印尼文.*3：泰文/s);
  const selected=await f.turn('',{postbackData:r.message.quickReply.items[1].action.data});assert.match(selected.message.text,/請上傳選單照片/);assert.match(selected.message.text,/2500 × 1686.*小於 1 MB/s);
  assert.equal((await getWorkspaceAgentSession(f.db,'admin')).payload.projectId,'project-2');
});
test('unsigned, grouped, unlisted, read-only and other-module actors cannot start or publish',async()=>{
  for(const override of [{activitySignatureVerified:false},{sourceType:'group'},{LINE_user_id:'unknown'},{LINE_user_id:'viewer'},{LINE_user_id:'vendor-admin'}]){const f=fixture();const r=await f.turn('',{postbackData:RICH_MENU_CHAT_START,...override});assert.match(r.message.text,/僅限/);assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_agent_sessions').get().n,0);}
});
test('invalid dimensions reply immediately, retain selection and permit correct retry without writing artwork',async()=>{
  const f=fixture();await f.select('2');f.setContent(WRONG);const r=await f.turn('',{messageType:'image'});assert.equal(r.message.text,MENU_IMAGE_ERROR);assert.equal(f.publishes().length,0);assert.equal(f.order.length,0);assert.equal((await getWorkspaceAgentSession(f.db,'admin')).step,'upload');
  f.setContent(GOOD);const good=await f.turn('',{messageType:'image',messageId:'corrected-2'});assert.match(good.completionText,/印尼文.*已更新/);assert.deepEqual(f.order,['ack','publish']);
});
test('file-size overflow rejects before fetching and fake metadata cannot bypass actual bytes',async()=>{
  const f=fixture();await f.select();let r=await f.turn('',{messageType:'file',fileSize:1000000});assert.equal(r.message.text,MENU_IMAGE_ERROR);assert.equal(f.calls.length,0);
  f.setContent(new Uint8Array(1000001));r=await f.turn('',{messageType:'file',fileSize:1,messageId:'oversize-2'});assert.equal(r.message.text,MENU_IMAGE_ERROR);assert.equal(f.publishes().length,0);
});
for(const slot of ['1','2','3'])test(`slot ${slot} preserves saved actions and alias and keeps the current visitor default`,async()=>{
  const f=fixture();await f.select(slot);const r=await f.turn('',{messageType:'file',fileName:'picture.png'});assert.equal(r.alreadyReplied,true);const data=f.publishes()[0].data,p=f.projects[Number(slot)-1];assert.equal(data.id,p.id);assert.equal(data.aliasId,p.aliasId);assert.deepEqual(data.richMenuConfig.areas,p.config.areas);assert.deepEqual(data.richMenuConfig.size,p.config.size);assert.equal(data.setDefault,slot==='1');assert.equal(data.deferUserMenuRefresh,true);assert.equal(f.publishes().length,1);
});
test('revoked permission is rechecked on the upload turn',async()=>{const f=fixture();await f.select();f.sqlite.prepare("UPDATE admin_uid_whitelist SET active=0 WHERE line_user_id='admin'").run();assert.match((await f.turn('',{messageType:'image'})).message.text,/僅限/);assert.equal(f.calls.length,0);});
test('stale quick replies and missing or ambiguous aliases cannot retarget a session',async()=>{
  const f=fixture(),old=await f.turn('',{postbackData:RICH_MENU_CHAT_START});await f.turn('',{postbackData:RICH_MENU_CHAT_START});await f.turn('',{postbackData:old.message.quickReply.items[0].action.data});assert.equal((await getWorkspaceAgentSession(f.db,'admin')).step,'choose');
  f.projects.push({...f.projects[0],id:'ambiguous'});assert.match((await f.turn('1')).message.text,/無法確認/);assert.equal(f.publishes().length,0);
});
test('changed configuration or published ID stops rather than overwriting new buttons',async()=>{for(const change of ['areas','id']){const f=fixture();await f.select();if(change==='areas')f.projects[0].config.areas[0].action.uri='https://example.com/new';else f.projects[0].deployedRichMenuId='richmenu-changed';assert.match((await f.turn('',{messageType:'image'})).message.text,/已被更新/);assert.equal(f.publishes().length,0);}});
test('same-session simultaneous uploads and webhook redelivery cannot publish twice',async()=>{
  const f=fixture();await f.select();const r=await Promise.all([f.turn('',{messageType:'image'}),f.turn('',{messageType:'image',messageId:'message-2'})]);assert.equal(f.publishes().length,1);assert.ok(r.some(v=>v.message?.text=== '這張圖片正在處理，請等待結果，勿重複上傳。'));await f.turn('',{messageType:'image'});assert.equal(f.publishes().length,1);
});
test('publication lock prevents simultaneous actors from publishing a stale selection',async()=>{
  const f=fixture();await f.select('1');await f.select('1','other-admin');let release;f.options.publish=async(data)=>{f.calls.push({type:'publish',data});await new Promise(resolve=>{release=resolve;});return {success:true,data:{richMenuId:'richmenu-new'}};};
  const pending=f.turn('',{messageType:'image'});while(!release)await new Promise(resolve=>setImmediate(resolve));const r=await f.turn('',{messageType:'image',LINE_user_id:'other-admin'});assert.match(r.message.text,/另一張選單/);release();await pending;assert.equal(f.publishes().length,1);
});
test('failed content fetch allows retry and cancellation clears only the workflow',async()=>{
  const f=fixture();await f.select();f.setFetchError(true);assert.match((await f.turn('',{messageType:'image'})).message.text,/無法取得圖片/);assert.equal(f.publishes().length,0);assert.match((await f.turn('取消')).message.text,/已取消/);assert.equal(await getWorkspaceAgentSession(f.db,'admin'),null);assert.equal(f.projects.length,3);
});
test('expired selection cannot consume an upload',async()=>{const f=fixture();await f.select();f.sqlite.prepare("UPDATE workspace_agent_sessions SET expires_at=datetime('now','-1 minute')").run();assert.equal(await f.turn('',{messageType:'image'}),null);assert.equal(f.calls.length,0);assert.match((await f.turn('',{postbackData:'action=workspace.richmenu.select&slot=1&run=stale'})).message.text,/逾時/);});
test('failed or uncertain publication is retained and never automatically repeated',async()=>{
  const f=fixture();await f.select();f.options.publish=async(data)=>{f.calls.push({type:'publish',data});throw Error('synthetic network failure');};assert.match((await f.turn('',{messageType:'image'})).completionText,/未能確認/);assert.equal((await getWorkspaceAgentSession(f.db,'admin')).status,'failed');await f.turn('',{messageType:'image',messageId:'retry'});assert.equal(f.publishes().length,1);
});
test('failed acknowledgement prevents publication',async()=>{const f=fixture();await f.select();f.setAck(false);assert.equal((await f.turn('',{messageType:'image'})).silent,true);assert.equal(f.publishes().length,0);});
test('activity runtime does not resume or clear a menu workflow when dashboard is opened',async()=>{
  const f=fixture();await f.select();assert.equal(await f.turn('儀表板'),null);let called=false;assert.equal(await handleWorkspaceAgentTurn({db:f.db,lineUserId:'admin',input:'儀表板',findAdmin:async()=>({admin:true}),runtime:{resume:async()=>{called=true;}}}),null);assert.equal(called,false);assert.equal((await getWorkspaceAgentSession(f.db,'admin')).agent,'rich_menu');
});
test('signed menu handler precedes existing agent; it uses the original publisher and one reply token',()=>{
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.ok(source.indexOf('const menuChatResult = await maybeHandleRichMenuChat')<source.indexOf('const workspaceAgentResult = await maybeHandleWorkspaceAgent'));assert.match(source,/publish: \(data\) => deployAndSaveRichMenu/);assert.match(source,/const result = await replyLineMessages/);assert.match(source,/to: item\.LINE_user_id/);assert.match(source,/signal: data\.signal/);
});
test('acknowledged publication is attached to waitUntil so mother forwarding can proceed',async()=>{
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const start=source.indexOf('async function maybeHandleRichMenuChat('),end=source.indexOf('function getWorkspaceActivityRuntime()',start);
  const tasks=[],pushes=[];let finish,replies=0;
  const scope={console,Request,URL,AbortSignal,handleRichMenuChatTurn:async({reply})=>{await reply({type:'text',text:'處理中'});await new Promise(resolve=>{finish=resolve;});return{completionText:'已更新',notificationKey:'synthetic-key'};},replyLineMessages:async()=>{replies++;return{ok:true};},fetch:async(url,init)=>{pushes.push(JSON.parse(init.body));return new Response('{}');}};
  vm.runInNewContext(source.slice(start,end),scope);
  const handled=await scope.maybeHandleRichMenuChat({}, {LINE_CHANNEL_ACCESS_TOKEN:'test'},{replyToken:'single-use',LINE_user_id:'admin'},'https://local.test',{waitUntil:task=>tasks.push(task)});
  assert.equal(handled.handled,true);assert.equal(replies,1);assert.equal(tasks.length,1);assert.equal(pushes.length,0);
  finish();await tasks[0];assert.equal(pushes.length,1);assert.equal(pushes[0].to,'admin');assert.equal(replies,1);
});
