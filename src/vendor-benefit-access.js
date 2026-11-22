import { decorateBenefitLogin } from './vendor-benefit-ui.js';

const COOKIE = 'sakura_benefit_session';
const TTL = 900;
const apiPaths = new Set(['/api/partner-stores','/api/featured-partner-stores','/api/medical-providers','/api/vendor-store','/api/vendor-directory','/api/vendor-nearby','/api/member-app']);
const pagePath = path => /^\/(?:vendor-store|demo-store|member-app|(?:featured-)?partner-stores(?:-id|-th|-vi)?|current-offers(?:-id|-th)?|medical-providers(?:-th|-vi)?|vendor-nearby)$/.test(path);
const json = (value, status = 200, cookie = '') => Response.json(value, { status, headers: { 'Cache-Control':'private, no-store', Vary:'Cookie, X-Line-Id-Token, Authorization', ...(cookie ? {'Set-Cookie':cookie} : {}) } });
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const bytes = value => new TextEncoder().encode(value);
const secret = env => env.LINE_CHANNEL_SECRET || env.VENDOR_PORTAL_SECRET;
async function key(env) {
  if (!secret(env)) throw new Error('Benefit session signing is unavailable');
  return crypto.subtle.importKey('raw', bytes(secret(env)), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
async function issue(env, uid) {
  const payload = encode({ purpose:COOKIE, uid, exp:Math.floor(Date.now()/1000)+TTL });
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), bytes(payload)));
  return payload+'.'+Array.from(signature,n=>n.toString(16).padStart(2,'0')).join('');
}
export async function verifiedBenefitCookieUid(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1) || '';
  const [payload,signature,extra] = raw.split('.');
  if (!payload || !/^[0-9a-f]{64}$/.test(signature || '') || extra) return '';
  try {
    if (!await crypto.subtle.verify('HMAC', await key(env), Uint8Array.from(signature.match(/../g),v=>parseInt(v,16)), bytes(payload))) return '';
    const data = JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
    return data.purpose === COOKIE && data.exp > Date.now()/1000 && data.exp <= Date.now()/1000+TTL+5 && /^U[0-9A-Za-z_-]{20,128}$/.test(data.uid || '') ? data.uid : '';
  } catch { return ''; }
}
export function activeBenefitEmployee(row) {
  return row?.status === 'active' && row.bind_status === 'bound' && ['employee','foreign_employee','manager'].includes(row.member_type);
}
export async function benefitIdentity(request, env, deps, synchronize = false) {
  const token = request.headers.get('X-Line-Id-Token');
  const identity = token ? await deps.verifyLine(env, token) : null;
  const uid = token ? identity?.lineUserId || '' : await verifiedBenefitCookieUid(request,env);
  if (!uid) return {employee:false,uid:''};
  // The cookie proves LINE identity only. Eligibility is read again on every
  // request, so suspension/unbinding takes effect without waiting for expiry.
  if (synchronize) await deps.ensureBinding(uid);
  const row = await env.DB.prepare('SELECT member_type,status,bind_status FROM welfare_members WHERE line_user_id=?').bind(uid).first();
  return {employee:activeBenefitEmployee(row),uid};
}
async function operator(request, env, deps, vendorId) {
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const admin = await deps.requireAdmin({sessionToken:bearer},env.DB);
    if (admin?.ok && admin.user?.role === 'admin') return true;
  }
  const session = deps.readVendorPortalCookie(request) || {};
  const url = new URL(request.url);
  const token = session.portal_token || url.searchParams.get('portal_token') || url.searchParams.get('token') || url.searchParams.get('vendor_portal_token') || '';
  if (!token) return false;
  const portal = await deps.verifyVendorPortalToken(env,token);
  if (!portal || portal.vendor_id !== vendorId) return false;
  const row = await env.DB.prepare("SELECT vendor_portal_username FROM welfare_vendors WHERE id=? AND status IN ('approved','pending','rejected') AND COALESCE(is_hidden,0)=0").bind(vendorId).first();
  return Boolean(row && row.vendor_portal_username === portal.username);
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [name,item] of Object.entries(value)) {
    if (['offers','showcases','carouselItems'].includes(name)) result[name] = [];
    else if (name === 'redemptionSummary') result[name] = {};
    else if (['discountPolicy','discount_policy','employee_price','employee_discount_label','offerTitle','offerSummary'].includes(name)) result[name] = '';
    else if (!['flex','contact_line_user_id','submitted_by_line_user_id','vendor_portal_username'].includes(name)) result[name] = redact(item);
  }
  return result;
}
async function privateAssetOwner(path, env) {
  if (path.startsWith('/vendor-document/')) {
    return env.DB.prepare("SELECT d.vendor_id,1 AS published FROM welfare_vendor_public_documents d JOIN welfare_vendors v ON v.id=d.vendor_id WHERE d.id=? AND d.status='published' AND v.status='approved' AND COALESCE(v.is_hidden,0)=0").bind(path.slice('/vendor-document/'.length)).first();
  }
  const storageKey = decodeURIComponent(path.slice('/file/'.length));
  if (storageKey.startsWith('vendor_carousel_')) return env.DB.prepare("SELECT c.vendor_id,CASE WHEN v.status='approved' THEN 1 ELSE 0 END AS published FROM welfare_vendor_carousel_items c JOIN welfare_vendors v ON v.id=c.vendor_id WHERE c.storage_key=? AND c.status='active' AND v.status IN ('approved','pending','rejected') AND COALESCE(v.is_hidden,0)=0").bind(storageKey).first();
  return env.DB.prepare("SELECT s.vendor_id,CASE WHEN s.status='approved' AND v.status='approved' THEN 1 ELSE 0 END AS published FROM welfare_vendor_showcase_assets s JOIN welfare_vendors v ON v.id=s.vendor_id WHERE s.storage_key=? AND s.status IN ('approved','draft','pending_review') AND v.status IN ('approved','pending','rejected') AND COALESCE(v.is_hidden,0)=0").bind(storageKey).first();
}
async function legacyBody(request){
  if(Number(request.headers.get('Content-Length')||0)>16384)throw Object.assign(new Error('Body too large'),{status:413});
  const reader=request.body?.getReader();if(!reader)return{};let length=0;const chunks=[];
  while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>16384){await reader.cancel();throw Object.assign(new Error('Body too large'),{status:413});}chunks.push(item.value);}
  const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(buffer)||'{}');
}
export async function handleVendorBenefitAccess(request, env, deps, next) {
  const url = new URL(request.url), path = url.pathname;
  // Retire the static demonstration price sheet in favour of the same guarded
  // storefront used for every other store.
  if (request.method === 'GET' && path === '/demo-store') return new Response(null,{status:302,headers:{Location:'/vendor-store?vendor_id=demo-vendor-sakura-001','Cache-Control':'no-store'}});
  // Older application reads accepted a claimed UID without a signature. A
  // guessed owner UID is not proof of merchant access to benefit content.
  if (request.method==='GET' && path==='/api/vendor-apply') {
    try {
      const portalToken=(deps.readVendorPortalCookie(request)||{}).portal_token || url.searchParams.get('portal_token') || url.searchParams.get('token') || url.searchParams.get('vendor_portal_token');
      const portal=portalToken?await deps.verifyVendorPortalToken(env,portalToken):null;
      const id=url.searchParams.get('vendor_id') || url.searchParams.get('id') || portal?.vendor_id || '';
      const uid=url.searchParams.get('uid') || url.searchParams.get('line_user_id') || '';
      const sig=url.searchParams.get('sig') || url.searchParams.get('vendor_apply_sig') || '';
      const vendor=id?await env.DB.prepare('SELECT vendor_portal_username FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0').bind(id).first():null;
      const portalOK=vendor&&portal?.vendor_id===id&&portal.username===vendor.vendor_portal_username;
      const signatureOK=vendor&&uid&&sig&&await deps.verifyApplicationSignature(env,id,uid,sig);
      if(!portalOK&&!signatureOK)return json({success:false,message:'請使用店家帳密登入，或由官方聊天室的專屬申請連結進入。'},403);
      return next(request);
    }catch{return json({success:false,message:'暫時無法驗證店家身分。'},503);}
  }
  // Keep the old QR workflow, but never let a client-selected UID/demo role
  // grant employee identity or expose another member's employee quotation.
  if (['/api/demo-redemption-token','/api/demo-redeem'].includes(path)) {
    try {
      let body={};
      if(request.method==='POST')body=await legacyBody(request);
      const access=await benefitIdentity(request,env,deps);
      if(path==='/api/demo-redemption-token'&&request.method==='POST'){
        if(!access.employee)return json({success:false,message:'目前無法使用此優惠。'},403);
        body={offer_id:body.offer_id||body.offerId,LINE_user_id:access.uid};
      }else{
        const token=url.searchParams.get('token')||body.token||'';
        const row=await env.DB.prepare('SELECT vendor_id,line_user_id FROM welfare_redemption_tokens WHERE token=?').bind(token).first();
        if(!row)return json({success:false,message:'查無核銷碼。'},404);
        const ownEmployee=path==='/api/demo-redemption-token'&&request.method==='GET'&&access.employee&&access.uid===row.line_user_id;
        if(!ownEmployee&&!await operator(request,env,deps,row.vendor_id))return json({success:false,message:'請使用所屬店家帳號登入。'},403);
      }
      const changedHeaders=new Headers(request.headers);changedHeaders.delete('Content-Length');changedHeaders.set('Content-Type','application/json');
      const current=request.method==='POST'?new Request(request.url,{method:'POST',headers:changedHeaders,body:JSON.stringify(body)}):request;
      const response=await next(current),headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');headers.set('Vary','Cookie, X-Line-Id-Token, Authorization');return new Response(response.body,{status:response.status,headers});
    }catch(error){return json({success:false,message:'暫時無法驗證身分，請重試。'},error.status===413?413:503);}
  }
  if (path === '/api/vendor-benefits/session') {
    if (!['GET','POST'].includes(request.method)) return json({success:false},405);
    if (request.method === 'POST' && ((request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return json({success:false},403);
    try {
      if (!env.DB) return json({success:false,message:'暫時無法確認員工資格，請重試。'},503);
      if (request.method === 'POST' && !request.headers.get('X-Line-Id-Token')) return json({success:false,message:'請先登入 LINE。'},403);
      const access = await benefitIdentity(request,env,deps,request.method==='POST');
      if (request.method === 'POST' && !access.uid) return json({success:false,message:'LINE 登入已失效，請重新登入。'},403);
      const cookie = request.method==='POST' ? COOKIE+'='+await issue(env,access.uid)+'; Path=/; Max-Age='+TTL+'; Secure; HttpOnly; SameSite=Lax' : '';
      return json({success:true,employee:access.employee,identified:Boolean(access.uid)},200,cookie);
    } catch { return json({success:false,message:'暫時無法確認員工資格，請重試。'},503); }
  }
  if (request.method === 'GET' && pagePath(path)) {
    const response = await next(request);
    if (!(response.headers.get('Content-Type') || '').includes('text/html')) return response;
    return new Response(decorateBenefitLogin(await response.text(),deps.liffId),{status:response.status,headers:response.headers});
  }
  const documentList = path === '/api/vendor-store/documents' && url.searchParams.get('manage') !== '1';
  const privateAsset = path.startsWith('/vendor-document/') || /^\/file\/(?:vendor_carousel_|vendor_showcase_)/.test(decodeURIComponent(path));
  if (!['GET','HEAD'].includes(request.method) || (!apiPaths.has(path) && !documentList && !privateAsset)) return next(request);
  try {
    if (!env.DB) return json({success:false,message:'暫時無法確認員工資格，請重試。'},503);
    const access = await benefitIdentity(request,env,deps);
    if (privateAsset) {
      const owner = await privateAssetOwner(path,env);
      if (!owner) return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
      if (!(access.employee && Number(owner.published)===1) && !await operator(request,env,deps,owner.vendor_id)) return json({success:false,code:'employee_required',message:'無法開啟此附件。'},403);
      const response = await next(request), headers = new Headers(response.headers);
      headers.set('Cache-Control','private, no-store');headers.set('Vary','Cookie, X-Line-Id-Token, Authorization');
      return new Response(response.body,{status:response.status,headers});
    }
    if (documentList && !access.employee && !await operator(request,env,deps,url.searchParams.get('vendor_id'))) return json({success:true,data:{items:[],editable:false},employeeBenefits:false});
    if (path === '/api/member-app') {
      if (!access.uid) return json({success:true,employeeBenefits:false,data:{member:{member_type:'visitor'},memberTypeLabel:'一般用戶',offers:[],redemptions:[]}});
      url.searchParams.set('uid',access.uid);url.searchParams.set('line_user_id',access.uid);url.searchParams.delete('demo');
      request = new Request(url,request);
    }
    const response = await next(request,{employee:access.employee});
    if (!response.ok || !(response.headers.get('Content-Type') || '').includes('json')) return response;
    let data = await response.json();
    const ownStore = path === '/api/vendor-store' && data.data?.canEdit === true;
    if(path==='/api/vendor-store'&&data.data?.vendor&&!ownStore){
      const vendor=await env.DB.prepare('SELECT status,is_hidden FROM welfare_vendors WHERE id=?').bind(data.data.vendor.id).first();
      if(!vendor||Number(vendor.is_hidden)||!['approved','active'].includes(vendor.status))return json({success:false,message:'此店家目前未公開。'},404);
    }
    if (!access.employee && !ownStore && !documentList) data = redact(data);
    // Published employee content never includes AI drafts awaiting review.
    if (!ownStore && data.data?.showcases) data.data.showcases = data.data.showcases.filter(row=>row.status==='approved');
    return json({...data,employeeBenefits:access.employee || ownStore || documentList});
  } catch { return json({success:false,message:'暫時無法確認員工資格，請重試。'},503); }
}
