import {buildEmployeeRosterProjection} from './employee-roster-service.js';
import {readEligibleVendorLinks,vendorRecipientGuard} from './vendor-push-audience.js';
const EMPLOYEE_TYPES = new Set(['employee', 'foreign_employee', 'manager']);
const UID = /^U[0-9a-f]{32}$/i;
const clean = value => typeof value === 'string' ? value.trim() : '';
const csv = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(clean).filter(Boolean))];
const deniedStates = new Set(['inactive', 'blocked', 'suspended', 'disabled', 'rejected']);
const DOMESTIC_ROSTER_TYPES = new Set(['台灣', '台灣-產學生']);
export const recipientIssueReasons = {
  changed:'預覽後資料有變更，請重新預覽。',
  filtered:'目前不符合本次選定的身分、標籤或組織條件。',
  inactive:'子站會員未啟用。',
  blocked:'LINE 帳號在子站已被標記為停用或封鎖。',
  unbound:'員工 LINE 綁定尚未確認。',
  duplicate:'工號或 LINE 綁定有重複紀錄，請核對員工名冊。',
  verifiedTime:'缺少有效的員工綁定確認時間。',
  vendor:'廠商關聯已失效或目前未核准。',
  missing:'找不到可用的受眾資料，請核對 LINE 帳號。',
  unavailable:'無法重新確認受眾資格，未發送。',
  legacy:'受眾資格已改變，未發送。'
};
// Versioned separately so previously created previews and schedules remain valid.
async function domesticGuard(base, roster) {
  const data=JSON.stringify(['domestic-v1',base,roster.map(row=>clean(row.identity_type)).sort()]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export const needsVendorTagProjection = filters => filters.memberType==='vendor' || (filters.tags||[]).includes('vendor');
export function recipientGuardForFilter(users, uid, filters) {
  if(needsVendorTagProjection(filters))return (filters.memberType==='employee_domestic'?users.domesticVendorGuards:users.vendorGuards).get(uid);
  if(users.vendorGuardUids?.has(uid))return users.vendorGuards.get(uid);
  return (filters.memberType==='employee_domestic'?users.domesticGuards:users.guards).get(uid);
}
export const needsVendorPushPolicy = filters => !['employee','employee_domestic','employee_language_id','employee_language_th','foreign_employee','manager'].includes(filters.memberType||'');
async function guardValue(member, roster, count, profileStatus, sources={}) {
  const fields=(row,keys)=>row?keys.map(key=>clean(row[key])):null;
  const value=JSON.stringify({member:fields(member,['member_type','status','bind_status','employee_no','verified_at','display_name','phone','email','language','tags']),codeCount:count||0,profile:clean(profileStatus),profileFields:fields(sources.profile,['display_name','updated_at','created_at']),thread:fields(sources.thread,['display_name','summary','tags','last_message_at','updated_at','created_at']),event:fields(sources.event,['message_text','sentiment_type','created_at']),roster:roster.map(row=>['employee_name','factory','business_unit','department_code','department_name'].map(key=>clean(row[key]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export class SegmentPushError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function rejectRecipientIssues(message, recipientIssues, status=409) {
  const error = new SegmentPushError(message,status);
  error.recipientIssues = recipientIssues;
  throw error;
}

export function reviewRecipientIssues(users, matched, filters, snapshot) {
  const eligible = new Set(matched.map(user=>user.line_user_id));
  const visible = new Set(users.map(user=>user.line_user_id));
  const issues = [];
  for(const {line_user_id,display_name,guard} of snapshot){
    const code=eligible.has(line_user_id)
      ? (guard===recipientGuardForFilter(users,line_user_id,filters) && guard ? '' : 'changed')
      : visible.has(line_user_id) ? 'filtered' : users.excludedReasons?.get(line_user_id)||'missing';
    if(code)issues.push({line_user_id,display_name:clean(display_name).slice(0,120),reason:recipientIssueReasons[code]});
  }
  return issues;
}
export function departmentKey(row) {
  return JSON.stringify([row.factory, row.business_unit, row.department_code, row.department_name].map(clean));
}

// Both deployed and newer schemas are supported. Missing optional profile fields
// mean unknown; they must never be reported as an affirmative friendship state.
async function profileColumns(db) {
  const result=await db.prepare("SELECT name FROM pragma_table_info('line_user_profiles')").all();
  if(result?.success===false||!Array.isArray(result?.results))throw new Error('Profile schema unavailable');
  const columns=new Set(result.results.map(row=>row.name));
  for(const name of ['line_user_id','display_name','picture_url','status_message','updated_at'])if(!columns.has(name))throw new Error('Required profile column unavailable');
  if([...columns].some(name=>String(name).toLowerCase().startsWith('__push_guard_')))throw new Error('Profile column namespace collision');
  if([...columns].some(name=>['status','created_at'].includes(String(name).toLowerCase())&&!['status','created_at'].includes(name)))throw new Error('Ambiguous optional profile column');
  return columns;
}

// A separate push projection: it cannot create members or change their binding.
// Latest messages are selected per UID before transfer, never a global LIMIT.
export async function readSegmentAudience(db, options={}) {
  let profiles, members, threads, events, roster;
  let eligibleVendors=new Map();
  try {
    const columns=await profileColumns(db),status=columns.has('status')?'status':'NULL AS status',created=columns.has('created_at')?'created_at':'NULL AS created_at';
    [profiles, members, threads, events, roster] = await Promise.all([
      db.prepare(`SELECT line_user_id,display_name,picture_url,status_message,${status},${created},updated_at FROM line_user_profiles`).all(),
      db.prepare('SELECT line_user_id,display_name,picture_url,member_type,status,employee_no,phone,email,language,bind_status,verified_at,tags,created_at,updated_at FROM welfare_members').all(),
      db.prepare(`SELECT source_user_id,display_name,picture_url,summary,tags,last_message_at,updated_at,created_at FROM
        (SELECT *,ROW_NUMBER() OVER(PARTITION BY source_user_id ORDER BY COALESCE(last_message_at,updated_at,created_at) DESC) rn
        FROM line_threads WHERE source_user_id IS NOT NULL AND source_user_id<>'') WHERE rn=1`).all(),
      db.prepare(`SELECT line_user_id,message_text,sentiment_type,created_at FROM
        (SELECT line_user_id,message_text,sentiment_type,created_at,ROW_NUMBER() OVER(PARTITION BY line_user_id ORDER BY created_at DESC,id DESC) rn
        FROM line_webhook_events WHERE line_user_id IS NOT NULL AND line_user_id<>'') WHERE rn=1`).all(),
      db.prepare('SELECT employee_no,employee_name,factory,business_unit,department_code,department_name,identity_type FROM employee_roster').all()
    ]);
    if(options.vendor||options.vendorPolicy||options.vendorDisplay) eligibleVendors=await readEligibleVendorLinks(db);
  } catch { throw new SegmentPushError('受眾資料暫時無法完整讀取，請稍後重試。', 503); }
  if ([profiles,members,threads,events,roster].some(result => result?.success === false || !Array.isArray(result?.results))) {
    throw new SegmentPushError('受眾資料暫時無法完整讀取。', 503);
  }
  const users = new Map(), memberMap = new Map(), codes = new Map(), rosterMap = new Map();
  const profileMap=new Map(),threadMap=new Map(),eventMap=new Map();
  const ensure = id => {
    id = clean(id); if (!UID.test(id)) return null;
    if (!users.has(id)) users.set(id, {line_user_id:id,display_name:'',picture_url:'',member_type:'unknown',bind_status:'unbound',employee_no:'',employee_name:'',factory:'',business_unit:'',department_code:'',department_name:'',department_key:'',phone:'',email:'',language:'',tags:'',last_message:'',last_interaction_at:'',member_status:'',profile_status:''});
    return users.get(id);
  };
  const addTags = (user, tags) => { user.tags = csv([...csv(user.tags), ...csv(tags)]).join(','); };
  for (const row of profiles.results) {
    const user = ensure(row.line_user_id); if (!user) continue;
    profileMap.set(user.line_user_id,row);
    Object.assign(user,{display_name:clean(row.display_name),picture_url:clean(row.picture_url),profile_status:clean(row.status),last_interaction_at:clean(row.updated_at || row.created_at)});
  }
  for (const row of threads.results) {
    const user = ensure(row.source_user_id); if (!user) continue;
    threadMap.set(user.line_user_id,row);
    user.display_name ||= clean(row.display_name); user.picture_url ||= clean(row.picture_url);
    user.last_message = clean(row.summary); user.last_interaction_at = clean(row.last_message_at || row.updated_at || row.created_at);
    addTags(user,row.tags);
  }
  for (const row of events.results) {
    const user = ensure(row.line_user_id); if (!user) continue;
    eventMap.set(user.line_user_id,row);
    if (!user.last_interaction_at || clean(row.created_at) > user.last_interaction_at) { user.last_message=clean(row.message_text); user.last_interaction_at=clean(row.created_at); }
    addTags(user,row.sentiment_type);
  }
  for (const row of roster.results) {
    const code = clean(row.employee_no); if (!code) continue;
    if (!rosterMap.has(code)) rosterMap.set(code,[]); rosterMap.get(code).push(row);
  }
  for (const row of members.results) {
    const code = clean(row.employee_no);
    if (code) codes.set(code,(codes.get(code)||0)+1);
    const user = ensure(row.line_user_id); if (!user) continue;
    memberMap.set(user.line_user_id,row);
    for (const key of ['display_name','picture_url','phone','email','language','employee_no']) user[key]=clean(row[key]) || user[key];
    user.member_type = clean(row.member_type)||'unknown'; user.member_status=clean(row.status);
    addTags(user,row.tags);
  }
  if(options.vendor) for(const uid of eligibleVendors.keys()) ensure(uid);
  const validationRoster=[...roster.results,...[...codes.keys()].filter(code=>!rosterMap.has(code)).map(employee_no=>({employee_no}))];
  const rosterReview=new Map(buildEmployeeRosterProjection(validationRoster,members.results).rows.map(row=>[row.employeeNo,row]));
  const excludedReasons=new Map();
  const result=[],guards=new Map(),domesticGuards=new Map(),vendorGuards=new Map(),domesticVendorGuards=new Map(),vendorGuardUids=new Set();
  for (const user of users.values()) {
    const member=memberMap.get(user.line_user_id), isEmployee=EMPLOYEE_TYPES.has(user.member_type);
    if (deniedStates.has(user.profile_status)) {excludedReasons.set(user.line_user_id,'blocked');continue;}
    if (member && member.status !== 'active') {excludedReasons.set(user.line_user_id,'inactive');continue;}
    let confirmedEmployee=false;
    if (member) {
      const code=clean(member.employee_no), matches=rosterMap.get(code)||[];
      const review=rosterReview.get(code);
      const bound=isEmployee && review?.status==='bound';
      confirmedEmployee=bound;
      if (isEmployee && !bound && !options.vendor && !(options.vendorPolicy && (eligibleVendors.get(user.line_user_id)||[]).length)) {
        excludedReasons.set(user.line_user_id,/重複|多筆/.test(review?.reason||'')?'duplicate':review?.reason==='子站缺少有效綁定確認時間'?'verifiedTime':'unbound');
        continue;
      }
      user.bind_status=bound?'bound':'unbound';
      if (bound && matches.length===1) {
        const row=matches[0];
        for (const key of ['employee_name','factory','business_unit','department_code','department_name']) user[key]=clean(row[key]);
        user.department_key=departmentKey(user);
        Object.defineProperty(user,'roster_identity_type',{value:clean(row.identity_type)});
      }
    }
    if(options.vendorPolicy && !confirmedEmployee && eligibleVendors.terminated?.has(user.line_user_id) && !(eligibleVendors.get(user.line_user_id)||[]).length) {excludedReasons.set(user.line_user_id,'vendor');continue;}
    if(options.vendor||options.vendorPolicy||options.vendorDisplay) {
      const links=eligibleVendors.get(user.line_user_id)||[];
      Object.defineProperty(user,'vendor_eligible',{value:links.length>0});
      user.tags=csv([...csv(user.tags).filter(tag=>tag!=='vendor'),...(links.length?['vendor']:[])]).join(',');
      if(options.vendor||options.vendorDisplay)user.vendor_names=links.map(link=>link.name||'未命名廠商');
      Object.defineProperty(user,'vendor_names_searchable',{value:Boolean(options.vendor)});
    }
    result.push(user);
    const matches=rosterMap.get(clean(member?.employee_no))||[];
    const base=await guardValue(member,matches,codes.get(clean(member?.employee_no))||0,user.profile_status,{profile:profileMap.get(user.line_user_id),thread:threadMap.get(user.line_user_id),event:eventMap.get(user.line_user_id)});
    guards.set(user.line_user_id,base);
    const domesticBase=await domesticGuard(base,matches);
    domesticGuards.set(user.line_user_id,domesticBase);
    if(options.vendor || (options.vendorPolicy && !confirmedEmployee && eligibleVendors.associated?.has(user.line_user_id))) {
      vendorGuards.set(user.line_user_id,await vendorRecipientGuard(base,eligibleVendors.get(user.line_user_id)));
      domesticVendorGuards.set(user.line_user_id,await vendorRecipientGuard(domesticBase,eligibleVendors.get(user.line_user_id)));
      vendorGuardUids.add(user.line_user_id);
    }
  }
  if (result.length>10000) throw new SegmentPushError('受眾超過本次可完整處理範圍，請聯絡管理員。',503);
  Object.defineProperty(result,'excludedReasons',{value:excludedReasons});
  Object.defineProperties(result,{guards:{value:guards},domesticGuards:{value:domesticGuards},vendorGuards:{value:vendorGuards},domesticVendorGuards:{value:domesticVendorGuards},vendorGuardUids:{value:vendorGuardUids},organizations:{value:roster.results.map(row=>({factory:clean(row.factory),business_unit:clean(row.business_unit),department_code:clean(row.department_code),department_name:clean(row.department_name)}))}});
  return result.sort((a,b)=>a.line_user_id.localeCompare(b.line_user_id));
}

// Recheck identity/organization immediately before each external message.
export async function readSegmentRecipientGuard(db, uid, domestic=false, vendor=false, vendorPolicy=false) {
  // Profile fields are selected as p.* because deployed installations may lack
  // optional status/created_at columns. Every non-profile field is separately
  // aliased, and reserved-name collisions fail closed inside the same query.
  let result,vendorLinks;try {const query=db.prepare(`SELECT p.*,
    m.line_user_id AS __push_guard_member_uid,m.member_type AS __push_guard_member_type,
    m.status AS __push_guard_member_status,m.bind_status AS __push_guard_bind_status,
    m.employee_no AS __push_guard_employee_no,m.verified_at AS __push_guard_verified_at,
    m.display_name AS __push_guard_member_name,m.phone AS __push_guard_phone,m.email AS __push_guard_email,
    m.language AS __push_guard_language,m.tags AS __push_guard_member_tags,
    t.source_user_id AS __push_guard_thread_uid,t.display_name AS __push_guard_thread_name,
    t.summary AS __push_guard_thread_summary,t.tags AS __push_guard_thread_tags,
    t.last_message_at AS __push_guard_thread_message_at,t.updated_at AS __push_guard_thread_updated,t.created_at AS __push_guard_thread_created,
    e.line_user_id AS __push_guard_event_uid,e.message_text AS __push_guard_event_message,
    e.sentiment_type AS __push_guard_event_sentiment,e.created_at AS __push_guard_event_created,
    r.employee_no AS __push_guard_roster_no,r.employee_name AS __push_guard_roster_name,
    r.factory AS __push_guard_factory,r.business_unit AS __push_guard_business_unit,
    r.department_code AS __push_guard_department_code,r.department_name AS __push_guard_department_name,
    ${domestic ? "r.identity_type AS __push_guard_roster_identity_type," : ""}
    (SELECT COUNT(*) FROM welfare_members n WHERE trim(n.employee_no)=trim(m.employee_no) AND trim(n.employee_no)<>'') AS __push_guard_code_count
    FROM (SELECT ? uid) target LEFT JOIN welfare_members m ON m.line_user_id=target.uid
    LEFT JOIN line_user_profiles p ON p.line_user_id=target.uid
    LEFT JOIN line_threads t ON t.rowid=(SELECT rowid FROM line_threads WHERE source_user_id=target.uid ORDER BY COALESCE(last_message_at,updated_at,created_at) DESC LIMIT 1)
    LEFT JOIN line_webhook_events e ON e.rowid=(SELECT rowid FROM line_webhook_events WHERE line_user_id=target.uid ORDER BY created_at DESC,id DESC LIMIT 1)
    LEFT JOIN employee_roster r ON trim(r.employee_no)=trim(m.employee_no) AND trim(m.employee_no)<>''
    WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('line_user_profiles') WHERE lower(name) GLOB '__push_guard_*')
      AND NOT EXISTS (SELECT 1 FROM pragma_table_info('line_user_profiles') WHERE lower(name) IN ('status','created_at') AND name COLLATE BINARY NOT IN ('status','created_at'))
      AND (SELECT COUNT(*) FROM pragma_table_info('line_user_profiles') WHERE name COLLATE BINARY IN ('line_user_id','display_name','picture_url','status_message','updated_at'))=5`).bind(uid).all();
    [result,vendorLinks]=await Promise.all([query,(vendor||vendorPolicy)?readEligibleVendorLinks(db,uid):Promise.resolve(null)]);
  } catch {throw new SegmentPushError('無法重新確認受眾資格。',503);}
  if(result?.success===false||!result?.results?.length)throw new SegmentPushError('無法重新確認受眾資格。',503);
  const row=result.results[0],required=['line_user_id','display_name','picture_url','status_message','updated_at',...['member_uid','member_type','member_status','bind_status','employee_no','verified_at','member_name','phone','email','language','member_tags','thread_uid','thread_name','thread_summary','thread_tags','thread_message_at','thread_updated','thread_created','event_uid','event_message','event_sentiment','event_created','roster_no','roster_name','factory','business_unit','department_code','department_name','code_count',...(domestic?['roster_identity_type']:[])].map(name=>'__push_guard_'+name)];
  if(result.results.some(item=>required.some(key=>!Object.hasOwn(item,key))))throw new SegmentPushError('無法重新確認受眾資格。',503);
  const member=row.__push_guard_member_uid?{member_type:row.__push_guard_member_type,status:row.__push_guard_member_status,bind_status:row.__push_guard_bind_status,employee_no:row.__push_guard_employee_no,verified_at:row.__push_guard_verified_at,display_name:row.__push_guard_member_name,phone:row.__push_guard_phone,email:row.__push_guard_email,language:row.__push_guard_language,tags:row.__push_guard_member_tags}:null;
  const roster=result.results.filter(item=>item.__push_guard_roster_no!==null&&item.__push_guard_roster_no!==undefined).map(item=>({employee_name:item.__push_guard_roster_name,factory:item.__push_guard_factory,business_unit:item.__push_guard_business_unit,department_code:item.__push_guard_department_code,department_name:item.__push_guard_department_name,identity_type:item.__push_guard_roster_identity_type}));
  const base=await guardValue(member,roster,row.__push_guard_code_count,row.status,{profile:row.line_user_id?{display_name:row.display_name,updated_at:row.updated_at,created_at:row.created_at}:null,thread:row.__push_guard_thread_uid?{display_name:row.__push_guard_thread_name,summary:row.__push_guard_thread_summary,tags:row.__push_guard_thread_tags,last_message_at:row.__push_guard_thread_message_at,updated_at:row.__push_guard_thread_updated,created_at:row.__push_guard_thread_created}:null,event:row.__push_guard_event_uid?{message_text:row.__push_guard_event_message,sentiment_type:row.__push_guard_event_sentiment,created_at:row.__push_guard_event_created}:null});
  if(vendor||vendorPolicy) {
    const employeeNo=clean(member?.employee_no);
    const employeeRows=roster.length?roster.map(item=>({...item,employee_no:employeeNo})):[{employee_no:employeeNo}];
    const employeeConfirmed=Boolean(member && EMPLOYEE_TYPES.has(clean(member.member_type)) && Number(row.__push_guard_code_count)===1 && buildEmployeeRosterProjection(employeeRows,[{...member,line_user_id:uid}]).rows.some(item=>item.status==='bound'));
    if(vendor||!employeeConfirmed){
      if(vendor||vendorLinks.associated?.has(uid))return vendorRecipientGuard(domestic?await domesticGuard(base,roster):base,vendorLinks.get(uid)||[]);
    }
  }
  return domestic?domesticGuard(base,roster):base;
}

export function normalizeSegmentFilters(input = {}) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new SegmentPushError('篩選條件格式不正確。');
  const keys=new Set(['keyword','tags','tagMode','memberType','bindStatus','factory','factories','businessUnit','department','maxRecipients','selectedLineUserIds']);
  if (Object.keys(input).some(key=>!keys.has(key))) throw new SegmentPushError('含有不支援的篩選條件，請重新載入。');
  const maxRecipients=input.maxRecipients===undefined?200:Number(input.maxRecipients);
  if (!Number.isInteger(maxRecipients)||maxRecipients<1||maxRecipients>500) throw new SegmentPushError('安全上限須為 1 至 500 的整數。');
  for (const key of ['keyword','tagMode','memberType','bindStatus','factory','businessUnit','department']) if (input[key]!==undefined && (typeof input[key]!=='string'||input[key].length>1000)) throw new SegmentPushError('篩選欄位格式不正確。');
  if (input.tags!==undefined && (!Array.isArray(input.tags)||input.tags.length>100||input.tags.some(tag=>typeof tag!=='string'||tag.length>100))) throw new SegmentPushError('標籤格式不正確。');
  if (input.factories!==undefined && (!Array.isArray(input.factories)||input.factories.length>100||input.factories.some(factory=>typeof factory!=='string'||!clean(factory)||factory.length>1000))) throw new SegmentPushError('廠別格式不正確。');
  if (input.factories!==undefined && clean(input.factory)) throw new SegmentPushError('廠別篩選格式衝突，請重新設定。');
  const result={keyword:clean(input.keyword),tags:csv(input.tags||[]).sort(),tagMode:input.tagMode||'any',memberType:clean(input.memberType),bindStatus:clean(input.bindStatus),factory:clean(input.factory),businessUnit:clean(input.businessUnit),department:clean(input.department),maxRecipients};
  // Preserve the shape of legacy single-factory drafts and scheduled previews.
  if(input.factories!==undefined)result.factories=[...new Set(input.factories.map(clean))].sort();
  if (!['any','all'].includes(result.tagMode)||!['','employee','employee_domestic','employee_language_id','employee_language_th','foreign_employee','manager','visitor','vendor','unknown'].includes(result.memberType)||!['','bound','unbound'].includes(result.bindStatus)) throw new SegmentPushError('不支援的篩選條件。');
  if (input.selectedLineUserIds!==undefined) {
    if (!Array.isArray(input.selectedLineUserIds)||input.selectedLineUserIds.length>500||input.selectedLineUserIds.some(id=>typeof id!=='string'||!UID.test(id))) throw new SegmentPushError('勾選名單格式不正確。');
    result.selectedLineUserIds=[...new Set(input.selectedLineUserIds)].sort();
  }
  return result;
}
export function filterSegmentAudience(rows,input={}, {selected=false}={}) {
  const f=normalizeSegmentFilters(input), keyword=f.keyword.toLocaleLowerCase('zh-TW');
  const factories=f.factories ?? (f.factory?[f.factory]:[]);
  if (selected && !f.selectedLineUserIds?.length) throw new SegmentPushError('請勾選至少一位受眾；空名單不會推播。');
  const ids=selected?new Set(f.selectedLineUserIds):null;
  return rows.filter(user=>{
    if (!UID.test(user.line_user_id||'') || deniedStates.has(user.member_status) || deniedStates.has(user.profile_status)) return false;
    if (f.memberType!=='vendor' && !(!f.memberType && user.vendor_eligible) && EMPLOYEE_TYPES.has(user.member_type) && user.bind_status!=='bound') return false;
    if (ids && !ids.has(user.line_user_id)) return false;
    if (f.memberType==='employee_domestic') {
      if (!['employee','manager'].includes(user.member_type) || user.member_status!=='active' || user.bind_status!=='bound' || !DOMESTIC_ROSTER_TYPES.has(user.roster_identity_type)) return false;
    } else if (f.memberType==='employee_language_id' || f.memberType==='employee_language_th') {
      const language=f.memberType==='employee_language_id'?'id':'th';
      if (!EMPLOYEE_TYPES.has(user.member_type) || user.member_status!=='active' || user.bind_status!=='bound' || user.language!==language) return false;
    } else if (f.memberType==='vendor') {
      if (!user.vendor_eligible) return false;
    } else if (f.memberType && !(f.memberType==='employee'?EMPLOYEE_TYPES.has(user.member_type):user.member_type===f.memberType)) return false;
    if (f.bindStatus && user.bind_status!==f.bindStatus) return false;
    if ((factories.length||f.businessUnit||f.department) && user.bind_status!=='bound') return false;
    if (factories.length && !factories.includes(user.factory)) return false;
    if (f.businessUnit && user.business_unit!==f.businessUnit) return false;
    if (f.department && user.department_key!==f.department) return false;
    if (keyword && ![user.display_name,user.employee_name,user.line_user_id,user.employee_no,user.phone,user.email,user.language,user.tags,user.last_message,user.factory,user.business_unit,user.department_code,user.department_name,...(user.vendor_names_searchable?(user.vendor_names||[]):[])].join(' ').toLocaleLowerCase('zh-TW').includes(keyword)) return false;
    const tags=csv(user.tags);
    return !f.tags.length || (f.tagMode==='all'?f.tags.every(tag=>tags.includes(tag)):f.tags.some(tag=>tags.includes(tag)));
  }).sort((a,b)=>a.line_user_id.localeCompare(b.line_user_id));
}
export function segmentOptions(rows) {
  const factories=new Map(),businessUnits=new Map(),departments=new Map();
  for (const row of (rows.organizations||rows)) if ((rows.organizations||row.bind_status==='bound') && row.factory) {
    factories.set(row.factory,{value:row.factory,label:row.factory});
    if(row.business_unit)businessUnits.set(JSON.stringify([row.factory,row.business_unit]),{value:row.business_unit,label:row.business_unit,factory:row.factory});
    const key=departmentKey(row);
    if(row.department_code||row.department_name)departments.set(key,{value:key,label:[row.department_code,row.department_name].filter(Boolean).join(' '),factory:row.factory,businessUnit:row.business_unit});
  }
  const sorted=map=>[...map.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-TW'));
  return {factories:sorted(factories),businessUnits:sorted(businessUnits),departments:sorted(departments)};
}
