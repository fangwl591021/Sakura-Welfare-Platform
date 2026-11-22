import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {withVendorQrDashboardButton,buildVendorQrChatPlan,isVendorBranchQrChatCandidate} from '../src/vendor-branch-qr-chat.js';
import {isVendorBrandChatCandidate} from '../src/vendor-brand-chat.js';
import {resolveWorkspaceIntent,WORKSPACE_INTENTS} from '../src/workspace/intent-router.js';
import {handleDashboardSummaryIntent} from '../src/workspace/dashboard-handler.js';
import {buildWorkspaceDashboardFlex} from '../src/workspace/dashboard-flex.js';
import {editorRole} from '../src/editor-access.js';
import {editorChatCard} from '../src/editor-ui.js';

const UID='U'+'1'.repeat(32),OTHER='U'+'2'.repeat(32),origin='https://dashboard-qr.test';
const dashboard=(more={})=>({eventType:'message',messageType:'text',sourceType:'user',LINE_user_id:UID,replyToken:'synthetic',activitySignatureVerified:true,text:'儀表板',postbackData:'',...more});
const command=(data,more={})=>dashboard({eventType:'postback',messageType:'',text:'',postbackData:'action=vendor.branch_qr.'+data,...more});
const allActions=message=>{const out=[];function visit(value){if(!value||typeof value!=='object')return;if(value.action)out.push(value.action);for(const child of Object.values(value))if(child&&typeof child==='object')Array.isArray(child)?child.forEach(visit):visit(child);}visit(message);return out;};
const qrActions=message=>allActions(message).filter(action=>action.type==='postback'&&action.data==='action=vendor.branch_qr.list&page=0');
function fixture(branches=1){
 const raw=new DatabaseSync(':memory:'),queries=[];
 raw.exec(`CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contact_line_user_id TEXT,submitted_by_line_user_id TEXT,contract_end TEXT,contract_terminated_at TEXT);
 CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id));
 CREATE TABLE welfare_vendor_locations(id TEXT PRIMARY KEY,vendor_id TEXT,branch_name TEXT,address TEXT,status TEXT);
 INSERT INTO welfare_vendors VALUES('own','晴日小館','approved',0,'','','',''),('other','其他店家','approved',0,'','','','');
 INSERT INTO welfare_vendor_locations VALUES('foreign-branch','other','其他分店','其他地址','active');`);
 raw.prepare('INSERT INTO welfare_vendor_line_bindings VALUES(?,?,?)').run('own',UID,'active');
 for(let n=0;n<branches;n++)raw.prepare('INSERT INTO welfare_vendor_locations VALUES(?,?,?,?,?)').run('own-'+n,'own','本店 '+n,'示範地址 '+n,'active');
 const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a)},async first(){queries.push(sql);return raw.prepare(sql).get(...args)||null},async all(){queries.push(sql);return{success:true,results:raw.prepare(sql).all(...args)}}});
 return{raw,queries,prepare(sql){assert.match(sql.trim(),/^SELECT\b/i);return wrap(sql)},close(){raw.close()}};
}

test('authorized admin and editor cards append only own QR entry without mutating existing card or adding duplicate',async()=>{
 const db=fixture();try{
  for(const message of [buildWorkspaceDashboardFlex({vendor_pending:2},new Date('2026-11-12T00:00:00Z')),editorChatCard('activity_editor',origin)]){
   const before=structuredClone(message),oldActions=allActions(message);
   const result=await withVendorQrDashboardButton({db,item:dashboard(),message});
   assert.notEqual(result,message);assert.deepEqual(message,before);assert.equal(qrActions(result).length,1);
   for(const action of oldActions)assert.ok(allActions(result).some(value=>JSON.stringify(value)===JSON.stringify(action)));
   assert.equal(result.altText,message.altText);assert.deepEqual(result.contents.header,message.contents.header);assert.deepEqual(result.contents.body,message.contents.body);
   const again=await withVendorQrDashboardButton({db,item:dashboard(),message:result});assert.equal(qrActions(again).length,1);
   if(message.altText.includes('小編'))assert.doesNotMatch(JSON.stringify(result),/today_payable|核銷金額|portal_token/);
  }
  assert.ok(db.queries.every(sql=>!/welfare_redemptions|welfare_members|vendor_line_sessions|admin_sessions/.test(sql)));
 }finally{db.close()}
});

test('dashboard QR remains absent for unlinked, revoked, expired, hidden and unavailable associations',async()=>{
 const cases=["DELETE FROM welfare_vendor_line_bindings","UPDATE welfare_vendor_line_bindings SET status='revoked'","UPDATE welfare_vendors SET status='suspended' WHERE id='own'","UPDATE welfare_vendors SET is_hidden=1 WHERE id='own'","UPDATE welfare_vendors SET contract_end='2000-01-01' WHERE id='own'","UPDATE welfare_vendors SET contract_terminated_at='2026-01-01' WHERE id='own'"];
 for(const sql of cases){const db=fixture();try{db.raw.exec(sql);const message=buildWorkspaceDashboardFlex();const result=await withVendorQrDashboardButton({db,item:dashboard(),message});assert.deepEqual(result,message,sql);assert.equal(qrActions(result).length,0)}finally{db.close()}}
 const message=buildWorkspaceDashboardFlex();const failed=await withVendorQrDashboardButton({db:{prepare(){throw Error('database unavailable')}},item:dashboard(),message});assert.deepEqual(failed,message);
});

test('unsigned or non-private dashboard cannot query vendor data or add QR entry',async()=>{
 for(const change of [{activitySignatureVerified:false},{sourceType:'group'},{sourceType:'room'},{LINE_user_id:'not-line'},{LINE_user_id:''},{replyToken:''}]){
  let reads=0;const db={prepare(){reads++;throw Error('must not query')}};const message=buildWorkspaceDashboardFlex();
  assert.deepEqual(await withVendorQrDashboardButton({db,item:dashboard(change),message}),message);assert.equal(reads,0);
 }
});

test('one own active branch returns its QR immediately, multiple own branches retain scoped selection',async()=>{
 for(const count of [0,1,2,7]){const db=fixture(count);try{
  const result=await buildVendorQrChatPlan({db,item:command('list&page=0'),origin});const rendered=JSON.stringify(result.messages);
  assert.equal(result.authorized,true);assert.doesNotMatch(rendered,/foreign-branch|其他店家|其他分店/);
  if(count===1){assert.match(rendered,/qr\.png\?location_id=own-0/);assert.doesNotMatch(rendered,/顯示此分店 QR 碼|共 1 個分店/)}
  else if(count>1){assert.doesNotMatch(rendered,/qr\.png/);assert.equal(allActions(result.messages).filter(x=>x.data?.includes('.show&')).length,Math.min(count,5));}
  else assert.match(rendered,/目前沒有可用分店/);
 }finally{db.close()}}
});

test('single-branch fast path rechecks current branch state and still rejects foreign branch requests',async()=>{
 const db=fixture();try{
  const prepare=db.prepare.bind(db);let changed=false,rechecked=false;
  db.prepare=sql=>{if(changed&&sql.includes('WHERE l.id=?'))rechecked=true;const statement=prepare(sql);
   if(sql.includes('SELECT l.id AS locationId'))return{bind(...args){const bound=statement.bind(...args);return{async all(){const result=await bound.all();changed=true;db.raw.exec("UPDATE welfare_vendor_locations SET status='hidden' WHERE id='own-0'");return result;}}}};
   return statement;
  };
  const result=await buildVendorQrChatPlan({db,item:command('list&page=0'),origin});assert.doesNotMatch(JSON.stringify(result.messages),/qr\.png/);
  assert.equal(rechecked,true,'single branch must be rechecked after it was selected');
  const foreign=await buildVendorQrChatPlan({db,item:command('show&location_id=foreign-branch'),origin});assert.equal(foreign.authorized,false);assert.doesNotMatch(JSON.stringify(foreign.messages),/其他地址|qr\.png/);
 }finally{db.close()}
});

const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function extract(name,async=false){const code=source.match(new RegExp(`${async?'async ':''}function ${name}\\([^]*?\\n\\}`))?.[0];assert.ok(code,name);return code;}
function dispatcher(db,replies,role='admin'){
 const deps={withVendorQrDashboardButton,isVendorBranchQrChatCandidate,isVendorBrandChatCandidate,buildVendorQrChatPlan,resolveWorkspaceIntent,WORKSPACE_INTENTS,handleDashboardSummaryIntent,editorRole,editorChatCard,
  vendorBrandPlan:async()=>({handled:false,authorized:false,messages:[]}),withVendorBrandSwitchButton:async({message})=>message,
  findAdminUidWhitelistRowReadOnly:async()=>editorRole(role)?{role}:null,
  resolveWorkspaceIdentity:async()=>({identity:{admin:role==='admin'}}),getWorkspaceDashboardSummary:async()=>({vendor_pending:2}),buildLiffUrl:()=>origin,
  buildVendorLineDashboardFlex:async()=>({type:'text',text:'legacy-financial-summary'}),
  replyLineMessages:async(_env,token,messages)=>{replies.push({token,messages});return{ok:true,status:200}},
 };
 const helpers=['getLineItemText','getLineItemWorkspaceInput','getLineItemUserId','getLineDashboardSubcommand','isLineDashboardCommandCandidate'].map(name=>extract(name)).join('\n');
 const run=Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${helpers};return (${extract('maybeHandleLineDashboardCommand',true)});`)(deps);
 return ev=>run(db,{LINE_CHANNEL_ACCESS_TOKEN:'synthetic'},ev,origin);
}

test('actual existing dashboard command retains each role and presents QR only for its active vendor link',async()=>{
 for(const role of ['admin','activity_editor','none']){const db=fixture(),replies=[];try{
  const run=dispatcher(db,replies,role);const result=await run(dashboard());assert.equal(replies.length,1);assert.equal(qrActions(replies[0].messages).length,1);
  assert.equal(result.role,role==='admin'?'owner':role==='none'?'vendor_qr':role);
  if(role!=='admin')assert.doesNotMatch(JSON.stringify(replies[0].messages),/今日核銷金額|legacy-financial-summary/);
  await run(command('list&page=0'));assert.equal(replies.length,2);assert.match(JSON.stringify(replies[1].messages),/qr\.png\?location_id=own-0/);
  db.raw.exec("UPDATE welfare_vendor_line_bindings SET status='revoked'");await run(command('list&page=0'));assert.equal(replies.length,3);assert.doesNotMatch(JSON.stringify(replies[2].messages),/qr\.png/);
  if(role!=='none'){await run(dashboard());assert.equal(replies.length,4);assert.equal(qrActions(replies[3].messages).length,0);}
 }finally{db.close()}}
});

test('QR home returns the existing role dashboard with one reply and does not recurse or broaden merchant authority',async()=>{
 for(const role of ['admin','activity_editor','none']){const db=fixture(),replies=[];try{
  const result=await dispatcher(db,replies,role)(command('home'));assert.equal(replies.length,1);assert.equal(result.role,role==='admin'?'owner':role==='none'?'vendor_qr':role);
  assert.equal(qrActions(replies[0].messages).length,1);if(role!=='admin')assert.doesNotMatch(JSON.stringify(replies[0].messages),/今日核銷金額|legacy-financial-summary/);
  for(const change of [{activitySignatureVerified:false},{sourceType:'group'},{sourceType:'room'},{LINE_user_id:'invalid'}]){await dispatcher(db,replies,role)(command('home',change));assert.equal(replies.length,1);}
 }finally{db.close()}}
});

test('actual child dispatch claims home token once and never falls through after uncertain reply result',async()=>{
 const db=fixture(),replies=[],logs=[];let attempts=0;try{
  const runDashboard=dispatcher(db,replies,'admin');
  const deps={redactVendorBindingPayload:v=>v,lifeInfoStationItemLanguage:()=>'',isWelfareShopCommand:()=>false,isVendorBindingCommand:()=>false,isMotherOnlyLineKeyword:()=>false,isVendorBranchQrChatCandidate,isVendorBrandChatCandidate,getPublicOrigin:()=>origin,
   buildFastLineEvent:ev=>({...ev,activitySignatureVerified:false}),storeLineWebhookEvent:async()=>logs.push('event'),storeLineThreadMessage:async()=>logs.push('thread'),
   maybeHandleLineDashboardCommand:async(_db,_env,ev)=>{attempts++;await runDashboard(ev);throw Error('reply accepted, acknowledgement unavailable')},
   maybeHandleRichMenuChat:async()=>{throw Error('home cannot fall through to another reply owner')},
  };
  const run=Function('deps',`const {${Object.keys(deps).join(',')}}=deps;return (${extract('processLineChildPayload',true)});`)(deps);
  await run(JSON.stringify({events:[command('home'),command('home')]}),{DB:db,LINE_CHANNEL_ACCESS_TOKEN:'synthetic'},{signatureVerified:true,origin});
  assert.equal(attempts,1);assert.equal(replies.length,1);assert.equal(qrActions(replies[0].messages).length,1);assert.equal(logs.length,4);
 }finally{db.close()}
});
