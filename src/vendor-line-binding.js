import { vendorContractCurrentSql } from './vendor-contract-policy.js';
const uidPattern = /^U[0-9a-f]{32}$/i;
// Detect plausible code-bearing forms more broadly than the accepted syntax.
// This masks common missing-space / punctuation mistakes without intercepting
// ordinary Chinese questions such as「廠商綁定方式」.
const commandPrefix = /(?:^|[^a-z0-9])V-[0-9a-f]{4,}/i;
const bareCodePattern = /^\s*(V-[0-9a-f]{24})\s*$/i;
const ATTEMPT_WINDOW = 10 * 60 * 1000;
const ATTEMPT_LIMIT = 5;
const REDACTED = '廠商綁定 [序號已隱藏]';
const hex = data => Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
const hashCode = async code => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(code).toLowerCase()))));

export const isVendorBindingCommand = text => commandPrefix.test(String(text || ''));
export function hasVendorBindingPayload(raw) {
  try { const value=JSON.parse(raw); return Array.isArray(value?.events) && value.events.some(event => event?.type==='message' && event?.message?.type==='text' && isVendorBindingCommand(event.message.text)); } catch { return commandPrefix.test(String(raw||'')); }
}
export function redactVendorBindingPayload(value) {
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch { return typeof value === 'string' && commandPrefix.test(value) ? '{"redacted":"vendor binding"}' : value; }
  const clean = value => {
    if (typeof value === 'string') return isVendorBindingCommand(value) ? REDACTED : value;
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
    return value;
  };
  return clean(parsed);
}
export function redactVendorBindingBody(raw) {
  if (!hasVendorBindingPayload(raw) && !commandPrefix.test(String(raw||''))) return raw;
  const redacted = redactVendorBindingPayload(raw);
  return typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
}
export function partitionVendorBindingPayload(rawBody, verified) {
  const unchanged = {body:rawBody,changed:false,shouldForward:true};
  if (!verified) return unchanged;
  let payload; try { payload=JSON.parse(rawBody); } catch { return commandPrefix.test(String(rawBody||'')) ? {body:'{"redacted":"vendor binding"}',changed:true,shouldForward:false} : unchanged; }
  if (!Array.isArray(payload?.events)) return unchanged;
  const events=payload.events.filter(event => !(event?.type==='message' && event?.message?.type==='text' && isVendorBindingCommand(event.message.text)));
  if (events.length===payload.events.length) return unchanged;
  return {body:JSON.stringify({...payload,events}),changed:true,shouldForward:events.length>0};
}
export async function issueVendorLineCode(db, vendorId, now=Date.now()) {
  const vendor=await db.prepare('SELECT id FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0').bind(vendorId).first();
  if (!vendor) return {success:false,message:'找不到可管理的廠商。'};
  const code='V-'+hex(crypto.getRandomValues(new Uint8Array(12)));
  await db.batch([
    db.prepare('UPDATE welfare_vendor_line_codes SET active=0 WHERE vendor_id=? AND active=1').bind(vendorId),
    db.prepare('INSERT INTO welfare_vendor_line_codes(code_hash,vendor_id,created_at,active) VALUES(?,?,?,1)').bind(await hashCode(code),vendorId,now)
  ]);
  return {success:true,data:{code,instruction:code}};
}
export async function disableVendorLineCode(db,vendorId) {
  await db.prepare('UPDATE welfare_vendor_line_codes SET active=0 WHERE vendor_id=? AND active=1').bind(vendorId).run();
  return {success:true};
}
export async function claimVendorLineEvent(db,eventId,verified,now=Date.now()) {
  if (!verified || !/^[A-Za-z0-9_-]{10,100}$/.test(String(eventId||''))) return false;
  const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(eventId))));
  const result=await db.prepare('INSERT INTO welfare_vendor_line_event_claims(event_hash,created_at) VALUES(?,?) ON CONFLICT(event_hash) DO NOTHING').bind(digest,now).run();
  return Number(result?.meta?.changes)===1;
}
export async function consumeVendorLineCode(db,item,verified,now=Date.now()) {
  if (!isVendorBindingCommand(item?.text)) return null;
  if (!verified || item.eventType!=='message' || item.messageType!=='text' || item.sourceType!=='user' || !uidPattern.test(String(item.LINE_user_id||''))) return {success:false,message:'請在官方帳號的一對一聊天室輸入有效序號。'};
  const uid=String(item.LINE_user_id),bucket=Math.floor(now/ATTEMPT_WINDOW),match=String(item.text).match(bareCodePattern);
  const attempt=await db.prepare(`INSERT INTO welfare_vendor_line_code_attempts(line_user_id,bucket,attempts) VALUES(?,?,1)
    ON CONFLICT(line_user_id,bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).bind(uid,bucket).first();
  if (!attempt || Number(attempt.attempts)>ATTEMPT_LIMIT) return {success:false,message:'序號無效或暫時無法使用，請向福委會洽詢。'};
  if (!match) return {success:false,message:'序號格式不正確，請直接貼上完整的廠商序號。'};
  const codeHash=await hashCode(match[1]);
  const result=await db.prepare(`INSERT INTO welfare_vendor_line_bindings(vendor_id,line_user_id,status,source,created_at,updated_at)
    SELECT c.vendor_id,?,'active','shared_code',?,? FROM welfare_vendor_line_codes c JOIN welfare_vendors v ON v.id=c.vendor_id
    WHERE c.code_hash=? AND c.active=1 AND COALESCE(v.is_hidden,0)=0 AND ${vendorContractCurrentSql('v')}
    ON CONFLICT(vendor_id,line_user_id) DO UPDATE SET updated_at=excluded.updated_at WHERE welfare_vendor_line_bindings.status='active'`).bind(uid,new Date(now).toISOString(),new Date(now).toISOString(),codeHash).run();
  if (!result?.meta?.changes) return {success:false,message:'序號無效或暫時無法使用，請向福委會洽詢。'};
  const row=await db.prepare('SELECT v.name,v.status FROM welfare_vendor_line_codes c JOIN welfare_vendors v ON v.id=c.vendor_id WHERE c.code_hash=?').bind(codeHash).first();
  return {success:true,message:'已完成廠商 LINE 關聯：'+String(row?.name||'廠商')+'。'+(row?.status==='approved'?'':'廠商資料尚待審核。')};
}
export async function restoreVendorLineBinding(db,vendorId,uid,now=Date.now()) {
  if (!uidPattern.test(String(uid||''))) return {success:false,message:'LINE 帳號格式錯誤。'};
  const result=await db.prepare(`UPDATE welfare_vendor_line_bindings SET status='active',source='admin',updated_at=? WHERE vendor_id=? AND line_user_id=? AND status='revoked'
    AND EXISTS(SELECT 1 FROM welfare_vendors v WHERE v.id=? AND COALESCE(v.is_hidden,0)=0 AND ${vendorContractCurrentSql('v')})`).bind(new Date(now).toISOString(),vendorId,uid,vendorId).run();
  return Number(result?.meta?.changes)===1?{success:true}:{success:false,message:'無法啟用關聯，請確認廠商與合約狀態。'};
}
export async function listVendorLineBindings(db,vendorId) {
  const vendor=await db.prepare('SELECT contact_line_user_id,submitted_by_line_user_id FROM welfare_vendors WHERE id=?').bind(vendorId).first();
  if (!vendor) return {success:false,message:'找不到廠商。'};
  const rows=await db.prepare('SELECT line_user_id,status,source,created_at,updated_at FROM welfare_vendor_line_bindings WHERE vendor_id=?').bind(vendorId).all();
  const values=new Map((rows.results||[]).map(row=>[row.line_user_id,row]));
  for (const uid of [vendor.contact_line_user_id,vendor.submitted_by_line_user_id]) if (uidPattern.test(String(uid||''))&&!values.has(uid)) values.set(uid,{line_user_id:uid,status:'active',source:'existing',created_at:'',updated_at:''});
  // Display the cached LINE profile only; member names are not LINE names.
  // Profile reads are scoped to this vendor's exact UIDs and never refresh LINE.
  const names=new Map(),uids=[...values.keys()].filter(uid=>uidPattern.test(String(uid||'')));
  try {
    for(let offset=0;offset<uids.length;offset+=90){
      const batch=uids.slice(offset,offset+90);
      const profiles=await db.prepare('SELECT line_user_id,display_name FROM line_user_profiles WHERE line_user_id IN ('+batch.map(()=>'?').join(',')+')').bind(...batch).all();
      if(profiles?.success===false||!Array.isArray(profiles?.results))throw new Error('LINE profile cache unavailable');
      for(const profile of profiles.results)if(values.has(profile.line_user_id))names.set(profile.line_user_id,typeof profile.display_name==='string'?profile.display_name.trim():'');
    }
  }catch{
    // The profile cache is optional; keep association management available.
    names.clear();
  }
  return {success:true,data:[...values.values()].map(row=>({...row,line_display_name:names.get(row.line_user_id)||''}))};
}
export async function revokeVendorLineBinding(db,vendorId,uid,now=Date.now()) {
  if (!uidPattern.test(String(uid||''))) return {success:false,message:'LINE 帳號格式錯誤。'};
  const exists=await db.prepare('SELECT id FROM welfare_vendors WHERE id=?').bind(vendorId).first();
  if (!exists) return {success:false,message:'找不到廠商。'};
  const stamp=new Date(now).toISOString();
  await db.prepare(`INSERT INTO welfare_vendor_line_bindings(vendor_id,line_user_id,status,source,created_at,updated_at)
    VALUES(?,?,'revoked','admin',?,?) ON CONFLICT(vendor_id,line_user_id) DO UPDATE SET status='revoked',updated_at=excluded.updated_at`).bind(vendorId,uid,stamp,stamp).run();
  return {success:true};
}
