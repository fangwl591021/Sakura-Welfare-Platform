import { quotePersonalQr } from './vendor-pos-discounts.js';
import { vendorPublicEligibleSql } from './vendor-contract-policy.js';

const clean = value => typeof value === 'string' ? value.trim() : '';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff' } });
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const sqlNow = () => new Date().toISOString().slice(0,19).replace('T',' ');
const rowById = (db, id) => db.prepare('SELECT * FROM welfare_branch_redemption_requests WHERE id=?').bind(id).first();
const branchGate = `EXISTS (SELECT 1 FROM welfare_vendor_locations l JOIN welfare_vendors v ON v.id=l.vendor_id
  WHERE l.id=? AND l.vendor_id=? AND l.status='active' AND ${vendorPublicEligibleSql('v')})`;
const memberGate = `(EXISTS (SELECT 1 FROM welfare_members m WHERE m.line_user_id=? AND m.status='active'
  AND CASE WHEN m.member_type IN ('employee','foreign_employee','manager') AND m.bind_status='bound' THEN 'employee' ELSE 'visitor' END=?)
  OR (?='visitor' AND NOT EXISTS (SELECT 1 FROM welfare_members m WHERE m.line_user_id=?)))`;
const policyGate = `((?='default' AND ?=CASE WHEN ?='employee' THEN 8 ELSE 9 END
    AND NOT EXISTS (SELECT 1 FROM welfare_vendor_pos_discounts WHERE vendor_id=?))
  OR EXISTS (SELECT 1 FROM welfare_vendor_pos_discounts WHERE vendor_id=? AND revision=?
    AND CASE WHEN ?='employee' THEN employee_tenths ELSE visitor_tenths END=?*10))`;
const gateArgs = row => [row.location_id,row.vendor_id,row.line_user_id,row.member_type,row.member_type,row.line_user_id,
  row.policy_revision,row.fold,row.member_type,row.vendor_id,row.vendor_id,row.policy_revision,row.member_type,row.fold];
const INTERNAL_OFFER_DESCRIPTION='branch_redemption_internal_v1';
const internalOfferGate=`NOT EXISTS(SELECT 1 FROM welfare_offers WHERE id=? AND
  (vendor_id<>? OR status<>'archived' OR description<>'${INTERNAL_OFFER_DESCRIPTION}' OR discount_type<>'fixed_price'
    OR original_price<>0 OR employee_price<>0 OR visitor_price<>0))`;

export async function readCheckoutBranch(db, locationId) {
  const id=clean(locationId);
  if(!id || id.length>200) throw fail(404,'branch_unavailable','此分店目前無法進行核銷。');
  const row=await db.prepare(`SELECT l.id,l.vendor_id,l.branch_name,l.address,v.name AS vendor_name
    FROM welfare_vendor_locations l JOIN welfare_vendors v ON v.id=l.vendor_id
    WHERE l.id=? AND l.status='active' AND ${vendorPublicEligibleSql('v')}`).bind(id).first();
  if(!row) throw fail(404,'branch_unavailable','此分店目前無法進行核銷。');
  return {vendorId:row.vendor_id,vendorName:row.vendor_name,locationId:row.id,
    branchName:clean(row.branch_name)||row.vendor_name,address:clean(row.address)};
}

function publicRequest(row, merchant=false) {
  const status=row.status==='pending' && row.expires_at<=sqlNow() ? 'expired' : row.status;
  return {id:row.id,vendorId:row.vendor_id,vendorName:row.vendor_name,locationId:row.location_id,
    branchName:row.branch_name,address:row.branch_address,memberName:row.member_name||'LINE 使用者',memberType:row.member_type,
    original:Number(row.original_price),payable:Number(row.payable_price),discount:Number(row.discount_amount),
    revision:row.policy_revision,fold:Number(row.fold),status,createdAt:row.created_at,expiresAt:row.expires_at,
    confirmedAt:row.confirmed_at,redemptionId:row.redemption_id,...(merchant?{lineUserId:row.line_user_id}:{})};
}

async function jsonBody(request) {
  if(Number(request.headers.get('Content-Length'))>16384) throw fail(400,'invalid_body','資料過長，請重新操作。');
  const reader=request.body?.getReader();
  if(!reader) throw fail(400,'invalid_body','缺少操作資料。');
  const parts=[];let size=0;
  try { while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>16384){await reader.cancel();throw fail(400,'invalid_body','資料過長，請重新操作。');}parts.push(value);} }
  finally {reader.releaseLock();}
  try { const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;
  }catch{throw fail(400,'invalid_body','操作資料格式不正確。');}
}

async function customerIdentity(env,data,deps) {
  const token=clean(data.id_token);
  if(!token||token.length>12000)throw fail(401,'line_login_required','請從 LINE 登入後再操作。');
  const identity=await deps.verifyIdentity(env,token);
  if(!identity||!/^U[0-9a-f]{32}$/i.test(identity.lineUserId||''))throw fail(401,'line_login_required','LINE 登入已失效，請重新開啟。');
  return identity;
}

// This landing-page projection is informational only. It does not synchronize
// identity, grant an employee discount, create a member, or begin a transaction.
async function readCustomerProfile(db,identity) {
  const member=await db.prepare('SELECT status FROM welfare_members WHERE line_user_id=?').bind(identity.lineUserId).first();
  return {lineName:clean(identity.displayName)||'LINE 使用者',canTransact:!member||member.status==='active'};
}

async function currentQuote(db,env,locationId,identity,original,deps) {
  const branch=await readCheckoutBranch(db,locationId);
  if(!Number.isSafeInteger(original)||original<1||original>10000000)throw fail(400,'invalid_amount','消費金額須為 1 到 10,000,000 元的整數。');
  await deps.syncIdentity(db,env,identity.lineUserId);
  const quote=await quotePersonalQr(db,branch.vendorId,identity.lineUserId,original);
  return {...branch,...quote.payment,memberName:clean(identity.displayName)||clean(quote.member?.display_name)||'LINE 使用者',quote};
}

function checkQuote(row,quote) {
  if(row.member_type!==quote.memberType||row.policy_revision!==quote.revision||Number(row.payable_price)!==quote.payable||Number(row.fold)!==quote.fold)
    throw fail(409,'quote_changed','會員身分或優惠已更新，請取消這筆交易並由用戶重新確認。');
}

async function initiate(db,env,data,identity,deps) {
  const id=clean(data.request_id);
  if(!uuid(id))throw fail(400,'invalid_request_id','請重新確認這筆交易。');
  const previous=await rowById(db,id);
  if(previous){
    if(previous.line_user_id!==identity.lineUserId)throw fail(404,'request_not_found','查無這筆交易。');
    if(previous.location_id!==clean(data.location_id)||Number(previous.original_price)!==data.original_price||previous.policy_revision!==data.pos_revision||previous.member_type!==data.pos_member_type)
      throw fail(409,'request_conflict','交易內容已變更，請使用新的交易確認。');
    return reply({success:true,data:publicRequest(previous),duplicated:true});
  }
  const q=await currentQuote(db,env,data.location_id,identity,data.original_price,deps);
  if(data.pos_revision!==q.revision||data.pos_member_type!==q.memberType)throw fail(409,'quote_changed','優惠或身分已更新，請重新預覽金額。');
  const now=sqlNow(),expires=new Date(Date.now()+30*60000).toISOString().slice(0,19).replace('T',' ');
  const row={id,vendor_id:q.vendorId,location_id:q.locationId,line_user_id:identity.lineUserId,member_type:q.memberType,policy_revision:q.revision,fold:q.fold};
  await db.batch([
    db.prepare(`UPDATE welfare_branch_redemption_requests SET status='expired',updated_at=?
      WHERE location_id=? AND line_user_id=? AND status='pending' AND expires_at<=?`).bind(now,q.locationId,identity.lineUserId,now),
    db.prepare(`INSERT INTO welfare_branch_redemption_requests
      (id,vendor_id,location_id,line_user_id,member_name,vendor_name,branch_name,branch_address,member_type,original_price,payable_price,discount_amount,policy_revision,fold,created_at,expires_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${branchGate} AND ${memberGate} AND ${policyGate}
      ON CONFLICT DO NOTHING`).bind(id,q.vendorId,q.locationId,identity.lineUserId,q.memberName,q.vendorName,q.branchName,q.address,q.memberType,q.original,q.payable,q.discount,q.revision,q.fold,now,expires,now,...gateArgs(row)),
    db.prepare(`INSERT INTO welfare_audit_events (id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
      SELECT ?,'member',?,'branch.redemption.initiate','branch_redemption',?,'用戶發起分店核銷',?,?
      WHERE EXISTS(SELECT 1 FROM welfare_branch_redemption_requests WHERE id=? AND line_user_id=?
        AND location_id=? AND original_price=? AND payable_price=? AND policy_revision=? AND member_type=?) ON CONFLICT(id) DO NOTHING`)
      .bind('branch-start:'+id,identity.lineUserId,id,JSON.stringify({vendor_id:q.vendorId,location_id:q.locationId,original:q.original,payable:q.payable}),now,id,identity.lineUserId,q.locationId,q.original,q.payable,q.revision,q.memberType)
  ]);
  const saved=await rowById(db,id);
  if(saved) {
    if(saved.line_user_id!==identity.lineUserId||saved.location_id!==q.locationId||Number(saved.original_price)!==q.original||Number(saved.payable_price)!==q.payable||saved.policy_revision!==q.revision||saved.member_type!==q.memberType)throw fail(409,'request_conflict','交易識別已使用，請重新確認。');
    return reply({success:true,data:publicRequest(saved)});
  }
  const open=await db.prepare("SELECT * FROM welfare_branch_redemption_requests WHERE location_id=? AND line_user_id=? AND status='pending' AND expires_at>?").bind(q.locationId,identity.lineUserId,now).first();
  if(open&&Number(open.original_price)===q.original&&open.policy_revision===q.revision&&open.member_type===q.memberType)
    return reply({success:true,data:publicRequest(open),duplicated:true});
  const error=fail(409,open?'pending_request_exists':'quote_changed',open?'這個分店已有待確認交易，請先查看或取消原交易。':'分店、優惠或會員身分已更新，請重新預覽。');
  if(open)error.data=publicRequest(open);
  throw error;
}

function pendingError(row) {
  const expired=row.expires_at<=sqlNow();
  const error=fail(409,expired?'request_expired':'pending_request_exists',expired?'原申請已逾時，請另外開始新消費。':'這個分店已有待店員確認的舊申請，請先查看或取消；不會自動完成舊申請。');
  error.data=publicRequest(row);return error;
}

async function verifyCompletedLedger(db,row) {
  const ledgerId='pos:'+row.vendor_id+':'+row.id;
  const ledger=row.redemption_id===ledgerId&&await db.prepare(`SELECT r.id FROM welfare_redemptions r
    JOIN welfare_members m ON m.id=r.member_id
    WHERE r.id=? AND r.status='confirmed' AND r.vendor_id=? AND r.location_id=? AND r.line_user_id=? AND m.line_user_id=?
      AND r.member_type=? AND r.original_price=? AND r.payable_price=? AND r.discount_amount=?
      AND r.offer_id=? AND r.qr_token=? AND r.quantity=1 AND r.point_change=0`)
    .bind(ledgerId,row.vendor_id,row.location_id,row.line_user_id,row.line_user_id,row.member_type,
      row.original_price,row.payable_price,row.discount_amount,'branch-walkin:'+row.vendor_id,'branch:'+row.location_id+':'+row.id).first();
  if(!ledger)throw fail(503,'submission_unavailable','原交易紀錄尚無法核對，請保留同一筆交易查詢，勿另行重送。');
}

// Customer retries may read an existing completion, but must never promote an
// earlier staff-review request or accept a request row without its actual ledger.
async function existingSubmission(db,row,data,identity) {
  if(row.line_user_id!==identity.lineUserId)throw fail(404,'request_not_found','查無這筆交易。');
  if(row.location_id!==clean(data.location_id)||Number(row.original_price)!==data.original_price||Number(row.payable_price)!==data.payable_price
    ||row.policy_revision!==data.pos_revision||row.member_type!==data.pos_member_type)
    throw fail(409,'request_conflict','交易內容已變更，請查詢原交易，勿重複送出。');
  if(row.status==='pending')throw pendingError(row);
  if(row.status!=='confirmed'){
    const error=fail(409,'request_closed','此筆申請已結束，請另外開始新消費。');error.data=publicRequest(row);throw error;
  }
  await verifyCompletedLedger(db,row);
  return publicRequest(row);
}

async function submit(db,env,data,identity,deps) {
  if(data.confirmed!==true)throw fail(400,'confirmation_required','請預覽並確認本次優惠與金額後送出。');
  const id=clean(data.request_id);
  if(!uuid(id))throw fail(400,'invalid_request_id','請重新確認這筆交易。');
  const previous=await rowById(db,id);
  if(previous)return reply({success:true,data:await existingSubmission(db,previous,data,identity),duplicated:true});
  const q=await currentQuote(db,env,data.location_id,identity,data.original_price,deps);
  if(data.pos_revision!==q.revision||data.pos_member_type!==q.memberType||data.payable_price!==q.payable)
    throw fail(409,'quote_changed','優惠、身分或金額已更新，請重新預覽後確認。');
  const now=sqlNow(),key=crypto.randomUUID(),redemptionId='pos:'+q.vendorId+':'+id;
  const row={id,vendor_id:q.vendorId,location_id:q.locationId,line_user_id:identity.lineUserId,member_name:q.memberName,
    branch_name:q.branchName,member_type:q.memberType,policy_revision:q.revision,fold:q.fold,original_price:q.original,payable_price:q.payable};
  const statements=[db.prepare(`INSERT INTO welfare_branch_redemption_requests
    (id,vendor_id,location_id,line_user_id,member_name,vendor_name,branch_name,branch_address,member_type,original_price,payable_price,discount_amount,
      policy_revision,fold,status,created_at,expires_at,confirmed_at,confirmed_by,confirmation_key,redemption_id,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',?,?,?,?,?,?,?
    WHERE ${branchGate} AND ${memberGate} AND ${policyGate} AND ${internalOfferGate}
      AND NOT EXISTS(SELECT 1 FROM welfare_branch_redemption_requests WHERE location_id=? AND line_user_id=? AND status='pending' AND expires_at>?)
    ON CONFLICT(id) DO NOTHING`)
    .bind(id,q.vendorId,q.locationId,identity.lineUserId,q.memberName,q.vendorName,q.branchName,q.address,q.memberType,q.original,q.payable,q.discount,
      q.revision,q.fold,now,now,now,'customer:'+identity.lineUserId,key,redemptionId,now,...gateArgs(row),'branch-walkin:'+q.vendorId,q.vendorId,q.locationId,identity.lineUserId,now),
    ...completionStatements(db,row,{now,key,redemptionId,actorType:'member',actorId:identity.lineUserId,
      auditId:'branch-submit:'+id,eventType:'branch.redemption.submit',summary:'用戶確認分店消費核銷',remark:'分店掃碼（用戶確認）：'+q.branchName})];
  try{await db.batch(statements);}catch{
    const existing=await rowById(db,id);
    if(existing)return reply({success:true,data:await existingSubmission(db,existing,data,identity),duplicated:true});
    throw fail(503,'submission_unavailable','暫時無法確認核銷結果，請保留同一筆交易查詢或重試。');
  }
  const saved=await rowById(db,id);
  if(saved)return reply({success:true,data:await existingSubmission(db,saved,data,identity),duplicated:saved.confirmation_key!==key});
  const open=await db.prepare("SELECT * FROM welfare_branch_redemption_requests WHERE location_id=? AND line_user_id=? AND status='pending' AND expires_at>?")
    .bind(q.locationId,identity.lineUserId,now).first();
  if(open)throw pendingError(open);
  throw fail(409,'quote_changed','分店、優惠或會員身分已更新，未完成核銷，請重新預覽。');
}

async function authorizeMerchant(request,db,env,data,deps) {
  const url=new URL(request.url),cookie=deps.readCookie(request)||{};
  const vendorId=clean(data.vendor_id)||clean(url.searchParams.get('vendor_id'))||cookie.vendor_id||'';
  const token=clean(data.portal_token)||clean(url.searchParams.get('portal_token'))||cookie.portal_token||'';
  const access=await deps.authorize(db,env,vendorId,{portalToken:token});
  if(!access?.success)throw fail(403,'vendor_auth_required','請先登入本店核銷工作台。');
  const vendor=await db.prepare(`SELECT id,name FROM welfare_vendors v WHERE v.id=? AND ${vendorPublicEligibleSql('v')}`).bind(vendorId).first();
  if(!vendor)throw fail(403,'vendor_unavailable','此廠商目前無法進行核銷。');
  return vendor;
}

async function merchantList(request,db,vendor) {
  const locationId=clean(new URL(request.url).searchParams.get('location_id'));
  const locations=(await db.prepare("SELECT id,branch_name,address FROM welfare_vendor_locations WHERE vendor_id=? AND status='active' ORDER BY branch_name,id").bind(vendor.id).all()).results||[];
  if(locationId&&!locations.some(row=>row.id===locationId))throw fail(404,'branch_unavailable','此分店不屬於目前店家或已停用。');
  const rows=(await db.prepare(`SELECT * FROM welfare_branch_redemption_requests WHERE vendor_id=? AND status='pending' AND expires_at>?
    AND (?='' OR location_id=?) AND EXISTS(SELECT 1 FROM welfare_vendor_locations l WHERE l.id=location_id AND l.vendor_id=? AND l.status='active')
    ORDER BY created_at,id LIMIT 201`).bind(vendor.id,sqlNow(),locationId,locationId,vendor.id).all()).results||[];
  return reply({success:true,data:{vendor,locations,requests:rows.slice(0,200).map(row=>publicRequest(row,true)),truncated:rows.length>200}});
}

async function changePending(db,row,status,actorType,actorId) {
  const now=sqlNow(),key=crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE welfare_branch_redemption_requests SET status=?,confirmation_key=?,updated_at=? WHERE id=? AND status='pending' AND expires_at>?").bind(status,key,now,row.id,now),
    db.prepare(`INSERT INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
      SELECT ?,?,?,?,'branch_redemption',?,'取消或退回待確認核銷',?,? WHERE EXISTS(SELECT 1 FROM welfare_branch_redemption_requests WHERE id=? AND confirmation_key=?)`)
      .bind('branch-'+status+':'+row.id,actorType,actorId,'branch.redemption.'+status,row.id,JSON.stringify({vendor_id:row.vendor_id,location_id:row.location_id}),now,row.id,key)
  ]);
  const result=await rowById(db,row.id);
  if(result.status==='confirmed')throw fail(409,'already_confirmed','此筆已完成核銷，無法取消。');
  return reply({success:true,data:publicRequest(result,actorType==='vendor')});
}

function completionStatements(db,row,{now,key,redemptionId,actorType,actorId,auditId,eventType,summary,remark}) {
  // A private neutral offer satisfies the existing ledger FK without publishing
  // a zero-price offer or attributing generic spend to an unrelated promotion.
  const offerId='branch-walkin:'+row.vendor_id;
  const ownClaim=`EXISTS(SELECT 1 FROM welfare_branch_redemption_requests WHERE id=? AND confirmation_key=? AND status='confirmed')`;
  return [
    db.prepare(`INSERT INTO welfare_members (id,line_user_id,member_type,display_name,status,bind_status,created_at,updated_at)
      SELECT ?,?,'visitor',?,'active','unbound',?,? WHERE ${ownClaim} AND NOT EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=?)
      ON CONFLICT(line_user_id) DO NOTHING`).bind('branch-visitor:'+row.line_user_id,row.line_user_id,row.member_name,now,now,row.id,key,row.line_user_id),
    db.prepare(`INSERT INTO welfare_offers(id,vendor_id,title,description,status,created_at,updated_at)
    SELECT ?,?,'分店掃碼現場消費（核銷紀錄用）','${INTERNAL_OFFER_DESCRIPTION}','archived',?,? WHERE ${ownClaim} ON CONFLICT(id) DO NOTHING`)
      .bind(offerId,row.vendor_id,now,now,row.id,key),
    db.prepare(`INSERT INTO welfare_redemptions(id,offer_id,vendor_id,member_id,line_user_id,member_type,original_price,payable_price,discount_amount,
      qr_token,status,location_id,quantity,payment_method,cashier_line_user_id,point_type,point_change,remark,redeemed_at,created_at)
      SELECT ?,?,r.vendor_id,m.id,r.line_user_id,r.member_type,r.original_price,r.payable_price,r.discount_amount,?,'confirmed',r.location_id,1,'cash','','',0,?, ?,?
      FROM welfare_branch_redemption_requests r JOIN welfare_members m ON m.line_user_id=r.line_user_id
      WHERE r.id=? AND r.confirmation_key=? AND r.status='confirmed'`)
      .bind(redemptionId,offerId,'branch:'+row.location_id+':'+row.id,remark,now,now,row.id,key),
    db.prepare(`INSERT INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
      SELECT ?,?,?,?,'redemption',?,?,?,? WHERE ${ownClaim}`)
      .bind(auditId,actorType,actorId,eventType,redemptionId,summary,JSON.stringify({request_id:row.id,location_id:row.location_id,original:row.original_price,payable:row.payable_price,member_type:row.member_type}),now,row.id,key)
  ];
}

async function confirmRequest(db,env,data,row,vendor,deps) {
  if(data.confirmed!==true)throw fail(400,'confirmation_required','請核對用戶、分店與金額後確認。');
  if(data.location_id!==row.location_id||data.original_price!==Number(row.original_price)||data.payable_price!==Number(row.payable_price)||data.pos_revision!==row.policy_revision||data.pos_member_type!==row.member_type)
    throw fail(409,'request_conflict','畫面與交易內容不一致，請重新載入待確認交易。');
  if(row.status==='confirmed')return reply({success:true,data:publicRequest(row,true),duplicated:true});
  if(row.status!=='pending')throw fail(409,'request_closed','此交易已取消或退回。');
  if(row.expires_at<=sqlNow())throw fail(409,'request_expired','這筆交易已逾時，請由用戶重新掃碼。');
  const q=await currentQuote(db,env,row.location_id,{lineUserId:row.line_user_id,displayName:row.member_name},Number(row.original_price),deps);
  if(q.vendorId!==vendor.id)throw fail(404,'request_not_found','查無這筆交易。');
  checkQuote(row,q);
  const offerId='branch-walkin:'+vendor.id;
  const now=sqlNow(),key=crypto.randomUUID(),redemptionId='pos:'+vendor.id+':'+row.id;
  const statements=[
    db.prepare(`UPDATE welfare_branch_redemption_requests SET status='confirmed',confirmed_at=?,confirmed_by=?,confirmation_key=?,redemption_id=?,updated_at=?
      WHERE id=? AND vendor_id=? AND status='pending' AND expires_at>? AND ${branchGate} AND ${memberGate} AND ${policyGate} AND ${internalOfferGate}`)
      .bind(now,vendor.id,key,redemptionId,now,row.id,vendor.id,now,...gateArgs(row),offerId,vendor.id),
    ...completionStatements(db,row,{now,key,redemptionId,actorType:'vendor',actorId:vendor.id,
      auditId:'branch-confirm:'+row.id,eventType:'branch.redemption.confirm',summary:'店員確認分店核銷',remark:'分店掃碼：'+row.branch_name})
  ];
  try{await db.batch(statements);}catch{
    const existing=await rowById(db,row.id);
    if(existing?.status==='confirmed')return reply({success:true,data:publicRequest(existing,true),duplicated:true});
    throw fail(503,'confirmation_unavailable','暫時無法確認核銷結果，請保留同一筆交易重試。');
  }
  const result=await rowById(db,row.id);
  if(result.status!=='confirmed')throw fail(409,'quote_changed','分店、優惠或會員身分已更新，未完成核銷，請重新確認。');
  return reply({success:true,data:publicRequest(result,true),duplicated:result.confirmation_key!==key});
}

export async function handleBranchRedemptionRequest(request,db,env,deps) {
  const url=new URL(request.url),merchant=url.pathname==='/api/vendor-pos/branch-redemptions';
  try{
    if(!db)throw fail(503,'service_unavailable','服務暫時無法使用。');
    if(!['GET','POST'].includes(request.method))throw fail(405,'method_not_allowed','不支援此操作。');
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin)throw fail(403,'origin_rejected','請從本站頁面操作。');
    const data=request.method==='POST'?await jsonBody(request):{};
    if(merchant){
      const vendor=await authorizeMerchant(request,db,env,data,deps);
      if(request.method==='GET')return await merchantList(request,db,vendor);
      if(!uuid(data.request_id))throw fail(400,'invalid_request_id','請重新選擇交易。');
      const row=await rowById(db,data.request_id);
      if(!row||row.vendor_id!==vendor.id)throw fail(404,'request_not_found','查無本店這筆交易。');
      if(data.action==='status')return reply({success:true,data:publicRequest(row,true)});
      if(data.action==='confirm')return await confirmRequest(db,env,data,row,vendor,deps);
      if(data.action==='reject'){
        if(data.confirmed!==true)throw fail(400,'confirmation_required','請確認退回這筆交易。');
        return await changePending(db,row,'rejected','vendor',vendor.id);
      }
      throw fail(400,'invalid_action','不支援此操作。');
    }
    if(request.method==='GET'||data.action==='details')return reply({success:true,data:await readCheckoutBranch(db,url.searchParams.get('location_id')||data.location_id)});
    const identity=await customerIdentity(env,data,deps);
    if(data.action==='profile')return reply({success:true,data:await readCustomerProfile(db,identity)});
    if(data.action==='quote'){
      const q=await currentQuote(db,env,data.location_id,identity,data.original_price,deps);
      const {quote,...publicQuote}=q;return reply({success:true,data:publicQuote});
    }
    if(data.action==='initiate')return await initiate(db,env,data,identity,deps);
    if(data.action==='submit')return await submit(db,env,data,identity,deps);
    if(['status','cancel'].includes(data.action)){
      if(!uuid(data.request_id))throw fail(404,'request_not_found','查無這筆交易。');
      const row=await rowById(db,data.request_id);
      if(!row||row.line_user_id!==identity.lineUserId)throw fail(404,'request_not_found','查無這筆交易。');
      if(data.action==='cancel')return await changePending(db,row,'cancelled','member',identity.lineUserId);
      if(row.status==='confirmed'&&row.confirmed_by==='customer:'+identity.lineUserId)await verifyCompletedLedger(db,row);
      return reply({success:true,data:publicRequest(row)});
    }
    throw fail(400,'invalid_action','不支援此操作。');
  }catch(error){return reply({success:false,code:error.code||'service_unavailable',message:error.status?error.message:'服務暫時無法確認，請保留同一筆交易稍後重試。',...(error.data?{data:error.data}:{})},error.status||503);}
}
