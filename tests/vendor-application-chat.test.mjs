import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {isPrivateVendorApplicationCandidate, buildVendorApplicationStatusFlex} from '../src/vendor-application-chat.js';
import {resolveWorkspaceIntent, WORKSPACE_INTENTS} from '../src/workspace/intent-router.js';
import {handleWorkspaceChatCardIntent} from '../src/workspace/workspace-chat-card-handler.js';
import {isVendorBranchQrChatCandidate} from '../src/vendor-branch-qr-chat.js';
import {isVendorBrandChatCandidate} from '../src/vendor-brand-chat.js';

const UID = 'U' + '1'.repeat(32), OTHER = 'U' + '2'.repeat(32);
const origin = 'https://vendor.test';
const vendor = {id:'vendor-own', name:'測試店家', status:'rejected', is_hidden:0, submitted_by_line_user_id:UID, contact_line_user_id:''};
const projected = {...vendor, status:'needs_supplement', supplement_items:['營業登記','保險文件'], supplement:{items:['營業登記','保險文件'],note:'保險文件已到期，請提供有效版本。'}};
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function extract(name, async = false) {
  const declaration = source.match(new RegExp(`${async ? 'async ' : ''}function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(declaration, name + ' must exist');
  return declaration;
}

function harness({row=vendor, application=projected, projectionError=null, proof=true}={}) {
  const calls = {proof:[],projection:[],replies:[],portal:0,login:0,session:0,logs:[]};
  const builder = Function('deps', `const {isPrivateVendorApplicationCandidate,hasVerifiedVendorNotificationIdentity,projectVendorSupplement,buildVendorApplicationStatusFlex}=deps;return (${extract('buildVendorApplicationStatusForLine',true)});`)({
    isPrivateVendorApplicationCandidate, buildVendorApplicationStatusFlex,
    hasVerifiedVendorNotificationIdentity:async(db,id,uid)=>{calls.proof.push({id,uid});return proof;},
    projectVendorSupplement:async(db, found)=>{calls.projection.push(found.id);if(projectionError)throw projectionError;return application;},
  });
  const deps = {
    resolveWorkspaceIntent, WORKSPACE_INTENTS, handleWorkspaceChatCardIntent, isVendorBranchQrChatCandidate, isVendorBrandChatCandidate,
    vendorBrandPlan:async()=>({handled:false,authorized:false,messages:[]}),
    findAdminUidWhitelistRowReadOnly:async()=>null,
    editorRole:()=>false,
    resolveWorkspaceIdentity:async()=>{throw Error('Unexpected admin lookup');},
    findVisibleVendorByLineUserId:async()=>row,
    buildVendorApplicationStatusForLine:builder,
    buildVendorPortalFlex:async()=>{calls.portal++;return {type:'flex',altText:'UNCHANGED_APPROVED_PORTAL',contents:{type:'bubble'}};},
    buildVendorPortalLoginFlex:async()=>{calls.login++;return {type:'flex',altText:'GENERIC_LOGIN',contents:{type:'bubble'}};},
    replyLineMessages:async(env,token,messages)=>{calls.replies.push({token,messages});return {ok:true,status:200};},
    isVendorLineOnboardingText:Function(`return (${extract('isVendorLineOnboardingText')});`)(),
    recordLineSystemOutboundMessage:async(db,entry)=>{calls.logs.push(entry);},
    upsertVendorLineSession:async()=>{calls.session++;},
  };
  const helpers=['getLineItemText','getLineItemWorkspaceInput','getLineItemUserId','getLineDashboardSubcommand','isLineDashboardCommandCandidate'].map(name=>extract(name)).join('\n');
  const workspace=Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${helpers};return (${extract('maybeHandleLineDashboardCommand',true)});`)(deps);
  const legacy=Function('deps',`const {${Object.keys(deps).join(',')}}=deps;return (${extract('maybeHandleVendorLineOnboarding',true)});`)(deps);
  const item={text:'廠商專區',messageType:'text',LINE_user_id:UID,replyToken:'reply-only-once',source:{type:'user',userId:UID}};
  return {calls,builder,run:overrides=>workspace({}, {LINE_CHANNEL_ACCESS_TOKEN:'synthetic'}, {...item,...overrides}, origin),
    legacy:overrides=>legacy({}, {LINE_CHANNEL_ACCESS_TOKEN:'synthetic'}, {...item,text:'店家專區',...overrides}, origin)};
}

test('private application candidate requires an exact master UID and is not itself ownership proof',()=>{
  assert.equal(isPrivateVendorApplicationCandidate(vendor,{LINE_user_id:UID}),true);
  assert.equal(isPrivateVendorApplicationCandidate({...vendor,submitted_by_line_user_id:'',contact_line_user_id:UID},{LINE_user_id:UID}),true);
  for(const [row,item] of [
    [vendor,{LINE_user_id:OTHER}], [vendor,{LINE_user_id:'0912345678'}],
    [{...vendor,submitted_by_line_user_id:''},{LINE_user_id:UID}],
    [{...vendor,is_hidden:1},{LINE_user_id:UID}], [{...vendor,status:'approved'},{LINE_user_id:UID}],
    [vendor,{LINE_user_id:UID,sourceGroupId:'G_PRIVATE'}], [vendor,{LINE_user_id:UID,sourceRoomId:'R_PRIVATE'}],
    [vendor,{LINE_user_id:UID,source:{type:'group'}}], [null,{LINE_user_id:UID}],
  ])assert.equal(isPrivateVendorApplicationCandidate(row,item),false);
});

test('needs-supplement card shows requested items and reason with a credential-only login destination',()=>{
  const card=buildVendorApplicationStatusFlex({...projected,vendor_portal_password:'SECRET_SENTINEL',private_key:'SECRET_SENTINEL'},origin);
  const body=JSON.stringify(card);
  for(const value of ['需補件','營業登記','保險文件','保險文件已到期'])assert.ok(body.includes(value));
  assert.doesNotMatch(body,/SECRET_SENTINEL|portal_token|vendor-pos|uid=|sig=/);
  const button=card.contents.footer.contents[0];assert.equal(button.action.label,'登入補件');
  assert.equal(button.action.uri,origin+'/vendor-login?next=supplement');
  assert.deepEqual([...new URL(button.action.uri).searchParams.keys()],['next']);
});

test('pending after resubmission hides old supplement instructions and remains pending',()=>{
  const card=buildVendorApplicationStatusFlex({...projected,status:'pending'},origin),body=JSON.stringify(card);
  assert.match(body,/待審核/);assert.doesNotMatch(body,/保險文件已到期|補件原因|補件項目/);
  assert.equal(card.contents.footer.contents[0].action.label,'登入查看申請');
});

test('actual workspace dispatcher replies once with own supplement details and grants no workbench authority',async()=>{
  const h=harness(),result=await h.run();
  assert.equal(result.ok,true);assert.equal(result.role,'none');
  assert.deepEqual(h.calls.proof,[{id:'vendor-own',uid:UID}]);
  assert.deepEqual(h.calls.projection,['vendor-own']);assert.equal(h.calls.portal,0);assert.equal(h.calls.login,0);
  assert.equal(h.calls.replies.length,1);assert.equal(h.calls.replies[0].messages.length,1);
  assert.equal(h.calls.replies[0].messages[0].altText,'廠商申請狀態：需補件');
});

test('legacy portal aliases use the same private application card without upgrading the session',async()=>{
  const h=harness(),result=await h.legacy();
  assert.equal(result.denied,true);assert.equal(h.calls.session,0);assert.equal(h.calls.portal,0);
  assert.equal(h.calls.replies.length,1);assert.equal(h.calls.logs.length,1);
  assert.equal(h.calls.replies[0].messages[0].altText,'廠商申請狀態：需補件');
});

test('approved vendor still receives the original work card and never reads supplement data',async()=>{
  const h=harness({row:{...vendor,status:'approved'}});await h.run();
  assert.equal(h.calls.portal,1);assert.equal(h.calls.login,0);assert.deepEqual(h.calls.proof,[]);assert.deepEqual(h.calls.projection,[]);
  assert.equal(h.calls.replies.length,1);assert.equal(h.calls.replies[0].messages[0].altText,'UNCHANGED_APPROVED_PORTAL');
});

test('matching a UID supplied through a public form does not disclose details without verified identity proof',async()=>{
  const h=harness({proof:false});await h.run();
  assert.deepEqual(h.calls.proof,[{id:'vendor-own',uid:UID}]);assert.deepEqual(h.calls.projection,[]);
  assert.equal(h.calls.portal,0);assert.equal(h.calls.login,1);assert.equal(h.calls.replies.length,1);
  assert.equal(h.calls.replies[0].messages[0].altText,'GENERIC_LOGIN');
  const legacy=harness({proof:false});await legacy.legacy();assert.deepEqual(legacy.calls.projection,[]);assert.equal(legacy.calls.login,1);
});

test('unbound, unrelated, hidden or group users receive only generic login, without reading supplement details',async()=>{
  for(const row of [null,{...vendor,submitted_by_line_user_id:OTHER},{...vendor,submitted_by_line_user_id:''},{...vendor,is_hidden:1}]){
    const h=harness({row});await h.run();assert.equal(h.calls.portal,0);assert.equal(h.calls.login,1);assert.deepEqual(h.calls.projection,[]);assert.equal(h.calls.replies.length,1);
  }
  const h=harness();await h.run({sourceGroupId:'group',source:{type:'group',userId:UID}});assert.equal(h.calls.login,1);assert.deepEqual(h.calls.projection,[]);
});

test('supplement read failure fails closed with one generic reply',async()=>{
  const h=harness({projectionError:Error('PRIVATE_DATABASE_DETAIL')});await h.run();
  assert.equal(h.calls.portal,0);assert.equal(h.calls.replies.length,1);
  assert.deepEqual(h.calls.replies[0].messages,[{type:'text',text:'廠商專區暫時無法開啟，請稍後再試。'}]);
});
