export const EDITOR_ROLES = Object.freeze({
  welfare_editor: Object.freeze({ label:'福利小編', unit:'welfare', modules:['welfare-content'], pages:[{label:'福利優惠內容',url:'/welfare-editor'}], description:'編寫優惠草稿、維護優惠內容與送審；不核准上架或操作款項、點數。' }),
  activity_editor: Object.freeze({ label:'活動小編', unit:'activities', modules:['activities'], pages:[{label:'活動、報名與簽到',url:'/activity-checkin-admin'},{label:'活動花絮貼文',url:'/activity-stories-admin'}], description:'管理一般活動、報名表、名冊與簽到；不操作社團活動。' }),
  club_editor: Object.freeze({ label:'社團小編', unit:'clubs', modules:['clubs'], pages:[{label:'社團與活動花絮',url:'/club-admin'},{label:'社團活動、報名與簽到',url:'/activity-checkin-admin'},{label:'活動花絮貼文',url:'/activity-stories-admin'}], description:'管理社團資料、相簿花絮及社團活動；不操作一般活動。' }),
});
export const editorRole = role => Object.hasOwn(EDITOR_ROLES,String(role||'')) ? EDITOR_ROLES[String(role)] : null;
export const editorActorRole = actor => String(actor || '').match(/^editor:(welfare_editor|activity_editor|club_editor):/)?.[1] || '';
export const editorPresets = () => Object.entries(EDITOR_ROLES).map(([role,preset])=>({role,...preset}));
export async function persistWhitelistEditorRole(db,mutation,role,uid){
  const preset=editorRole(role);
  if(!preset)return mutation.run();
  // Persist the downgrade too: deleting the whitelist later must not expose an
  // older broad admin_users role through an already-issued session.
  return db.batch([mutation,db.prepare('UPDATE admin_users SET role=?,business_units=? WHERE line_user_id=?').bind(role,preset.modules.join(','),uid)]);
}

// Resolve the current whitelist on every request. Existing sessions cannot retain
// broad access after assignment to an editor role, and disabling it revokes access.
export async function reconcileEditorSession(db,user) {
  if (!user?.line_user_id) return editorRole(user?.role) ? null : user;
  const row=await db.prepare('SELECT role,allowed_modules,active FROM admin_uid_whitelist WHERE line_user_id=? LIMIT 1').bind(user.line_user_id).first();
  if (editorRole(row?.role)) return Number(row.active)===1 ? {...user,role:row.role,business_units:editorRole(row.role).modules.join(',')} : null;
  if (editorRole(user.role)) {
    if (!row || Number(row.active)!==1) return null;
    return {...user,role:row.role==='admin'?'admin':row.role==='viewer'?'viewer':'final',business_units:String(row.allowed_modules||'*')};
  }
  return user;
}

export async function resolveAdminPrincipal(request,db,env,deps,data={},diagnostic=null) {
  const bearer=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]||'';
  const token=bearer||String(data.sessionToken||'');
  if (token) { const auth=await deps.requireAdmin({sessionToken:token},db); if(auth?.ok)return {...auth.user,actor:editorRole(auth.user.role)?'editor:'+auth.user.role+':'+auth.user.id:'admin:'+auth.user.id}; }
  const lineToken=request.headers.get('X-Line-Id-Token');
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const sameOrigin=(!request.headers.get('Origin')||request.headers.get('Origin')===url.origin)&&request.headers.get('Sec-Fetch-Site')!=='cross-site';
  const accessRoute=sameOrigin&&((path==='/admin-api/line-segment-push'&&['GET','POST'].includes(method))||(path==='/admin-api/activity-stories'&&['GET','POST'].includes(method))||(path==='/admin-api/activity-story-media'&&method==='POST')||(path==='/admin-api/segment-push-image'&&method==='POST')||(path==='/admin-api/ai-ads-push-assets'&&method==='GET')||(method==='GET'&&/^\/admin-api\/ai-ads\/assets\/aia_[a-f0-9]{32}\/content$/.test(path))||(method==='GET'&&/^\/activity-story-media\/[^/]+$/.test(path)&&url.searchParams.get('manage')==='1'));
  const welfareShopAccess=sameOrigin&&(
    (['/admin-api/welfare-shop','/admin-api/welfare-shop/settings'].includes(path)&&['GET','POST'].includes(method))||
    (path==='/admin-api/welfare-shop/photo'&&method==='GET')
  );
  const accessToken=accessRoute||welfareShopAccess?request.headers.get('X-Line-Access-Token'):null;
  if (!lineToken&&!accessToken) return null;
  let identity=null;
  const lineDiagnostic=diagnostic||(accessToken?{}:null);
  if(lineToken){identity=await deps.verifyLine(env,lineToken,lineDiagnostic);if(!identity?.lineUserId&&(!accessToken||lineDiagnostic?.reason!=='LINE_TOKEN_EXPIRED')){if(diagnostic&&!diagnostic.reason)diagnostic.reason='LINE_IDENTITY_UNVERIFIED';return null;}}
  if(!identity?.lineUserId&&accessToken&&typeof deps.verifyLineAccess==='function')identity=await deps.verifyLineAccess(env,accessToken);
  if(!identity?.lineUserId){if(diagnostic&&!diagnostic.reason)diagnostic.reason='LINE_IDENTITY_UNVERIFIED';return null;}
  const row=await deps.findAdmin(db,identity.lineUserId); if(!row||Number(row.active)!==1){if(diagnostic)diagnostic.reason='LINE_ADMIN_UNCONFIRMED';return null;}
  return {id:identity.lineUserId,role:row.role,actor:editorRole(row.role)?'editor:'+row.role+':'+identity.lineUserId:'line:'+identity.lineUserId};
}
const activityPaths=new Set(['/admin-api/activity-checkin','/admin-api/activity-form','/admin-api/activity-import','/admin-api/activity-qr-checkin','/admin-api/activity-lottery']);
const clubPaths=new Set(['/admin-api/clubs','/admin-api/club-media']);
const commonPaths=new Set(['/admin-api/editor-context']);
export function editorMayAccess(role,path,method='GET') {
  if (!editorRole(role)) return false;
  if(commonPaths.has(path))return method==='GET';
  if(['activity_editor','club_editor'].includes(role)&&['/admin-api/activity-stories','/admin-api/activity-story-media'].includes(path))return ['GET','POST'].includes(method);
  if(role==='welfare_editor')return path==='/admin-api/editor-welfare'&&['GET','POST'].includes(method);
  if(activityPaths.has(path))return ['GET','POST'].includes(method);
  if(role==='club_editor'&&clubPaths.has(path))return ['GET','POST'].includes(method);
  return path==='/workspace-api/upload'&&method==='POST';
}
const rootAdminActions=new Set(['WELFARE_MEMBER_VERIFY','WELFARE_REDEMPTION_CREATE','WELFARE_POINTS_QUERY','WELFARE_KNOWLEDGE_SAVE','WELFARE_OFFER_DRAFT','WELFARE_POINTS_INSERT','getAll','updateStatus','delete','getActivityLogs','logActivity','getPermissionConfig','savePermissionUser']);
export function isManagedRequest(path,action='') {
  if(path==='/admin-api/rich-menu-bindings'||path==='/admin-api/employee-binding-sync')return false;
  if(path.startsWith('/admin-api/'))return true;
  if(path.startsWith('/workspace-api/')&&path!=='/workspace-api/login')return true;
  if(path==='/api/admin-access-check')return true;
  if(path.startsWith('/api/line-oa/'))return true;
  return path==='/api'&&(action.startsWith('RICH_MENU_')||action==='DEPLOY_RICH_MENU'||rootAdminActions.has(action));
}
const deny=(status,message)=>Response.json({success:false,code:status===401?'ADMIN_LOGIN_REQUIRED':'EDITOR_SCOPE_DENIED',message},{status,headers:{'Cache-Control':'no-store'}});
export async function readBoundedAdminJson(request,limit=65000){
  if(Number(request.headers.get('Content-Length'))>limit)throw Object.assign(Error('內容過大。'),{status:413});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(Error('缺少資料。'),{status:400});
  const decoder=new TextDecoder();let size=0,text='';
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){void reader.cancel().catch(()=>{});throw Object.assign(Error('內容過大。'),{status:413});}text+=decoder.decode(value,{stream:true});}
  return JSON.parse(text+decoder.decode());
}
export async function guardAdminRequest(request,db,env,deps) {
  const url=new URL(request.url); let action='',data={};
  if(url.pathname==='/api'&&request.method==='POST') {try{const body=await readBoundedAdminJson(request.clone(),16000000);action=String(body.action||'');data=body.data||body.payload||{};}catch(error){return error.status===413?deny(413,error.message):null;}}
  if(!isManagedRequest(url.pathname,action))return null;
  if(!db)return deny(503,'後台暫時無法驗證權限。');
  if((request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return deny(403,'請由管理後台操作。');
  try {
    const pushDiagnostic=['/admin-api/line-segment-push','/admin-api/activity-stories'].includes(url.pathname)&&request.method==='GET'&&request.headers.get('X-Line-Id-Token')?{}:null;
    const principal=await resolveAdminPrincipal(request,db,env,deps,data,pushDiagnostic);
    if(!principal){
      if(pushDiagnostic?.reason)return Response.json({success:false,code:'EDITOR_SCOPE_DENIED',message:'請先登入管理後台。',authReason:pushDiagnostic.reason},{status:403,headers:{'Cache-Control':'no-store'}});
      return deny(403,'請先登入管理後台。');
    }
    if(editorRole(principal.role)&&!editorMayAccess(principal.role,url.pathname,request.method))return deny(403,'此功能不在您的小編管理範圍。');
    if(editorRole(principal.role)&&activityPaths.has(url.pathname)&&url.pathname!=='/admin-api/activity-import'){
      let eventId=url.searchParams.get('event_id')||'';
      if(request.method==='POST'){const body=await readBoundedAdminJson(request.clone());eventId=body.event_id||body.data?.id||body.id||eventId;}
      if(eventId&&!await editorCanReadEvent(db,principal.actor,String(eventId)))return deny(403,'此活動不在您的單位管理範圍。');
    }
    if(url.pathname==='/admin-api/admin-uid-whitelist'&&principal.role!=='admin')return deny(403,'只有管理員可以設定白名單。');
    return null;
  }catch(error){return error.status===413?deny(413,error.message):deny(503,'暫時無法驗證管理權限，請稍後再試。');}
}
export function activityScopeSql(actor,alias='e') {
  const role=editorActorRole(actor);if(!['activity_editor','club_editor'].includes(role))return '';
  return `${role==='activity_editor'?'NOT ':''}EXISTS(SELECT 1 FROM welfare_activity_club_links editor_link WHERE editor_link.id=${alias}.id)`;
}
export async function editorCanReadEvent(db,actor,id) {
  const scope=activityScopeSql(actor);if(!scope)return true;
  return Boolean(await db.prepare(`SELECT e.id FROM welfare_activity_events e WHERE e.id=? AND ${scope}`).bind(id).first());
}
export async function filterEditorEvents(db,actor,events) {
  const scope=activityScopeSql(actor);if(!scope)return events;
  const ids=new Set((await db.prepare(`SELECT e.id FROM welfare_activity_events e WHERE ${scope}`).all()).results.map(r=>r.id));
  return events.filter(e=>ids.has(e.id));
}
