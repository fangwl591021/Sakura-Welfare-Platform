import { isVendorPublicEligible,isVendorContractCurrent } from './vendor-contract-policy.js';
import {buildEmployeeRosterProjection} from './employee-roster-service.js';

const UID = /^U[0-9a-f]{32}$/i;
const clean = value => typeof value === 'string' ? value.trim() : '';

// This projection is read only and deliberately separate from employee identity.
// Explicitly revoked vendor+UID pairs override the two legacy master UID fields.
export async function readEligibleVendorLinks(db, targetUid = '') {
  if(targetUid){
    const rows=await db.prepare(`SELECT v.id,v.name,v.status,v.is_hidden,v.contract_end,v.contract_terminated_at,
      v.contact_line_user_id,v.submitted_by_line_user_id,b.status AS binding_status
      FROM welfare_vendors v LEFT JOIN welfare_vendor_line_bindings b ON b.vendor_id=v.id AND b.line_user_id=?
      WHERE trim(v.contact_line_user_id)=? OR trim(v.submitted_by_line_user_id)=? OR b.line_user_id IS NOT NULL`)
      .bind(targetUid,targetUid,targetUid).all();
    if(rows?.success===false||!Array.isArray(rows?.results))throw new Error('Vendor association data unavailable');
    const byUid=new Map(),associated=new Set(),terminated=new Set(),links=[];const now=Date.now();
    for(const vendor of rows.results){
      associated.add(targetUid);
      if(!isVendorContractCurrent(vendor,now))terminated.add(targetUid);
      const legacy=clean(vendor.contact_line_user_id)===targetUid||clean(vendor.submitted_by_line_user_id)===targetUid;
      if(isVendorPublicEligible(vendor,now)&&(vendor.binding_status==='active'||(vendor.binding_status==null&&legacy)))links.push({id:clean(vendor.id),name:clean(vendor.name)});
    }
    if(links.length)byUid.set(targetUid,links.sort((a,b)=>a.id.localeCompare(b.id)));
    Object.defineProperties(byUid,{associated:{value:associated},terminated:{value:terminated}});
    return byUid;
  }
  let vendorQuery=db.prepare(`SELECT id,name,status,is_hidden,contract_end,contract_terminated_at,
    contact_line_user_id,submitted_by_line_user_id FROM welfare_vendors`);
  let bindingQuery=db.prepare('SELECT vendor_id,line_user_id,status FROM welfare_vendor_line_bindings');
  const [vendors,bindings]=await Promise.all([vendorQuery.all(),bindingQuery.all()]);
  if (vendors?.success === false || !Array.isArray(vendors?.results) || bindings?.success === false || !Array.isArray(bindings?.results)) {
    throw new Error('Vendor association data unavailable');
  }
  const explicit = new Map();
  for (const row of bindings.results) {
    const vendorId=clean(row.vendor_id), uid=clean(row.line_user_id);
    if (!vendorId || !UID.test(uid)) continue;
    if (!explicit.has(vendorId)) explicit.set(vendorId,new Map());
    explicit.get(vendorId).set(uid,clean(row.status));
  }
  const byUid = new Map(),associated = new Set(),terminated = new Set();
  const now = Date.now();
  for (const vendor of vendors.results) {
    const vendorId=clean(vendor.id); if (!vendorId) continue;
    const states=explicit.get(vendorId)||new Map();
    const ids=new Set([clean(vendor.contact_line_user_id),clean(vendor.submitted_by_line_user_id),...states.keys()]);
    for (const uid of ids) {
      if (!UID.test(uid) || (targetUid && uid!==targetUid)) continue;
      associated.add(uid);
      if(!isVendorContractCurrent(vendor,now))terminated.add(uid);
      if(!isVendorPublicEligible(vendor,now))continue;
      if (states.has(uid) && states.get(uid)!=='active') continue;
      if (!byUid.has(uid)) byUid.set(uid,[]);
      byUid.get(uid).push({id:vendorId,name:clean(vendor.name)});
    }
  }
  for (const links of byUid.values()) links.sort((a,b)=>a.id.localeCompare(b.id));
  Object.defineProperties(byUid,{associated:{value:associated},terminated:{value:terminated}});
  return byUid;
}

export async function vendorRecipientGuard(base, links) {
  const input=JSON.stringify(['vendor-v1',base,(links||[]).map(link=>[link.id,link.name]).sort((a,b)=>a[0].localeCompare(b[0]))]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

// Manual operator pushes may target any known UID; only a former vendor with
// no other effective vendor link requires the verified-employee exception.
export async function isVendorRecipientAllowed(db, uid) {
  uid=clean(uid);
  // Vendor associations are exact LINE user IDs; preserve the existing
  // behavior of direct pushes to non-user targets such as groups and rooms.
  if(!UID.test(uid))return true;
  const links=await readEligibleVendorLinks(db,uid);
  if(!links.terminated.has(uid)||(links.get(uid)||[]).length)return true;
  const member=await db.prepare(`SELECT line_user_id,member_type,status,employee_no,bind_status,verified_at
    FROM welfare_members WHERE line_user_id=?`).bind(uid).first();
  const code=clean(member?.employee_no);
  if(!member||!code||!['employee','foreign_employee','manager'].includes(clean(member.member_type)))return false;
  const [roster,counts]=await Promise.all([
    db.prepare('SELECT employee_no FROM employee_roster WHERE trim(employee_no)=?').bind(code).all(),
    db.prepare("SELECT COUNT(*) AS n FROM welfare_members WHERE trim(employee_no)=? AND trim(employee_no)<>''").bind(code).first()
  ]);
  if(roster?.success===false||!Array.isArray(roster?.results)||Number(counts?.n)!==1)return false;
  const rows=roster.results.length?roster.results:[{employee_no:code}];
  return buildEmployeeRosterProjection(rows,[member]).rows.some(row=>row.status==='bound');
}
