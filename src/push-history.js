const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (body, status = 200) => Response.json(body, { status, headers });
const states = new Set(['draft','scheduled','dispatching','sending','sent','partial','needs_review','cancelled','failed']);
const scheduleReasons = new Set([
  '受眾資料暫時無法完整讀取，請稍後重試。',
  '受眾資料暫時無法完整讀取。',
  '受眾超過本次可完整處理範圍，請聯絡管理員。',
  '受眾資格或名冊已變更，預約未發送。',
  '預約逾時，請重新確認後操作。',
  '建立者的推播權限已失效，未發送。',
  '原預覽已失效，未發送。',
  '預約名單不正確。',
  'LINE 推播服務尚未設定。',
  '預約處理時間已過，請查詢結果。',
  '預約推播已處理或取消。',
  '處理結果待確認，未自動重送。',
  '發送結果待確認，未自動重送。'
]);
const stoppedBeforeSend = new Set([
  '受眾資料暫時無法完整讀取，請稍後重試。',
  '受眾資料暫時無法完整讀取。',
  '受眾超過本次可完整處理範圍，請聯絡管理員。',
  '受眾資格或名冊已變更，預約未發送。',
  '預約逾時，請重新確認後操作。',
  '建立者的推播權限已失效，未發送。',
  '原預覽已失效，未發送。',
  '預約名單不正確。',
  'LINE 推播服務尚未設定。',
  '預約處理時間已過，請查詢結果。'
]);
const audienceReasons = Object.values(recipientIssueReasons);
const deliveryReasons = [
  ...audienceReasons,
  '預約權限或處理狀態已變更，未發送。',
  '本次處理時間已達上限，未發送。'
];
const deliveryLabels = new Map([
  ['accepted','LINE 已接受'], ['failed','LINE 拒絕'], ['not_sent','未發送'],
  ['sending','處理中或尚未記錄結果'], ['unknown','發送結果不明']
]);
const timeSql = "COALESCE(CAST(s.scheduled_at / 1000 AS INTEGER),unixepoch(c.created_at))";
const statusSql = "COALESCE(NULLIF(s.status,''),c.status)";
function projection(withLinks=false) {
  return "SELECT c.id,c.title,c.recipient_count,c.success_count,c.failed_count,c.created_at,c.updated_at," +
    statusSql + " AS status,s.scheduled_at,s.last_error," + timeSql + " AS sort_time," +
    "i.started_at AS insights_started,i.synced_at,i.sync_failed,i.unique_opens,i.unique_clickers" +
    (withLinks?',i.links_json':'')+" FROM welfare_push_campaigns c " +
    "LEFT JOIN welfare_push_schedules s ON s.preview_id=c.id LEFT JOIN welfare_push_insights i ON i.campaign_id=c.id";
}
const pageSize = 25;

function dateStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const utc = Date.parse(value+'T00:00:00Z');
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0,10)!==value) return null;
  return (utc - 8*3600000)/1000;
}

function exposed(row) {
  const { last_error, sort_time, insights_started, synced_at, sync_failed, unique_opens, unique_clickers, links_json, ...item } = row;
  const reason = scheduleReasons.has(last_error) ? last_error
    : item.status==='cancelled' ? '預約已取消，未發送。'
    : item.status==='needs_review' ? '紀錄未提供明確原因，請核對發送明細。' : '';
  const analyticsState=insights_started==null ? 'untracked'
    : item.success_count===0&&['partial','failed','cancelled'].includes(item.status) ? 'no_accepted'
    : synced_at==null ? (sync_failed?'unavailable':'pending')
    : 'synced';
  const numberOrNull=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const opens=numberOrNull(unique_opens), clickers=numberOrNull(unique_clickers);
  const denominator=item.success_count;
  const openRate=denominator>0&&opens!==null&&opens<=denominator ? Math.round(1000*opens/denominator)/10 : null;
  const insights={state:analyticsState,updatedAt:synced_at??null,opens,clickers,openRate};
  if(typeof links_json==='string'){
    try{
      const links=JSON.parse(links_json);
      if(Array.isArray(links))insights.links=links.filter(link=>typeof link?.label==='string').slice(0,200)
        .map(link=>({label:link.label.slice(0,300),people:numberOrNull(link.people),clicks:numberOrNull(link.clicks)}));
    }catch{/* Older or invalid metrics remain unavailable. */}
  }
  return {...item, reason, type:item.scheduled_at==null?'immediate':'scheduled',insights};
}

async function detail(db, item) {
  // Only return recognized reasons and aggregated counts. Legacy response bodies
  // may contain provider diagnostics, contact data, or opaque payloads.
  const reasonSql = "CASE WHEN response_body IN ("+deliveryReasons.map(()=>'?').join(',')+") THEN response_body ELSE '' END";
  const results = await db.prepare(
    "SELECT status,response_status,"+reasonSql+" AS reason,COUNT(*) AS count FROM welfare_push_deliveries " +
    "WHERE campaign_id=? GROUP BY status,response_status,3 ORDER BY status,response_status,3"
  ).bind(...deliveryReasons,item.id).all();
  const groups = new Map();
  let recorded = 0;
  const totals = { accepted:0, failed:0, not_sent:0, unknown:0, sending:0, other:0 };
  for (const r of results.results) {
    recorded += r.count;
    const state = deliveryLabels.has(r.status) ? r.status : 'other';
    totals[state] += r.count;
    const status = deliveryLabels.get(state) || '舊紀錄／未分類';
    const http = Number.isInteger(r.response_status) && r.response_status>=100 && r.response_status<=599 ? r.response_status : null;
    const reason = state==='not_sent' ? r.reason || '紀錄未提供明確原因。'
      : state==='failed' ? (http ? 'LINE API 拒絕（HTTP '+http+'）。' : 'LINE API 拒絕，未保存回應代碼。')
      : state==='unknown' ? '系統未取得確定的發送結果。' : '';
    const key = JSON.stringify([status,reason]);
    const previous = groups.get(key);
    groups.set(key,{status,reason,count:(previous?.count||0)+r.count});
  }
  if (!recorded && (stoppedBeforeSend.has(item.reason) || item.status==='cancelled') && item.success_count===0 && item.failed_count===0 && item.recipient_count>0) {
    totals.not_sent=item.recipient_count;
    groups.set('not-started',{status:'未發送',reason:item.reason,count:item.recipient_count});
  }
  let recipientIssues=[];
  if([...groups.values()].some(row=>audienceReasons.includes(row.reason))){
    const rows=await db.prepare(
      "SELECT line_user_id,display_name,response_body AS reason FROM welfare_push_deliveries WHERE campaign_id=? AND status='not_sent' "+
      "AND response_body IN ("+audienceReasons.map(()=>'?').join(',')+") ORDER BY display_name,line_user_id LIMIT 500"
    ).bind(item.id,...audienceReasons).all();
    recipientIssues=rows.results.filter(row=>/^U[0-9a-f]{32}$/i.test(row.line_user_id)).map(row=>({
      line_user_id:row.line_user_id,display_name:String(row.display_name||'').slice(0,120),reason:row.reason
    }));
  }
  return {...item, recorded, totals, outcomes:[...groups.values()], recipientIssues};
}

export async function handlePushHistory(request, db, authorize) {
  if (request.method!=='GET') return reply({success:false,message:'此功能只提供查詢。'},405);
  const url=new URL(request.url);
  if ((request.headers.has('Origin') && request.headers.get('Origin')!==url.origin) ||
      request.headers.get('Sec-Fetch-Site')==='cross-site') return reply({success:false,message:'請由管理後台操作。'},403);
  if (!db) return reply({success:false,message:'推播紀錄暫時無法讀取。'},503);
  try {
    const principal=await authorize();
    if (!principal?.actor || principal.role!=='admin') return reply({success:false,message:'請使用具備推播權限的管理員帳號。'},403);
    const filters=[], params=[];
    if (principal.canReadAllPushHistory!==true) {
      filters.push("(s.actor=? OR (s.id IS NULL AND EXISTS(SELECT 1 FROM welfare_push_previews p WHERE p.id=c.id AND p.actor=?)))");
      params.push(principal.actor,principal.actor);
    }
    const id=url.searchParams.get('id');
    if (id!==null) {
      if (!id || id.length>150) return reply({success:false,message:'推播編號格式不正確。'},400);
      filters.push('c.id=?'); params.push(id);
      const row=await db.prepare(projection(true)+' WHERE '+filters.join(' AND ')).bind(...params).first();
      if (!row) return reply({success:false,message:'找不到可查看的推播紀錄。'},404);
      return reply({success:true,data:await detail(db,exposed(row))});
    }
    const q=(url.searchParams.get('q')||'').trim();
    const state=url.searchParams.get('status')||'';
    const type=url.searchParams.get('type')||'';
    const from=url.searchParams.get('from')||'', to=url.searchParams.get('to')||'';
    const start=from?dateStart(from):null, end=to?dateStart(to):null;
    const page=Number(url.searchParams.get('page')||1);
    if (q.length>120 || (state&&!states.has(state)) || !['','scheduled','immediate'].includes(type) ||
        (from&&start===null) || (to&&end===null) || (start!==null&&end!==null&&start>end) ||
        !Number.isSafeInteger(page)||page<1||page>100000) return reply({success:false,message:'請確認日期及查詢條件。'},400);
    if (q) { filters.push("instr(lower(c.title),lower(?))>0");params.push(q); }
    if (state) { filters.push(statusSql+'=?');params.push(state); }
    if (type) filters.push(type==='scheduled'?'s.id IS NOT NULL':'s.id IS NULL');
    if (start!==null) { filters.push(timeSql+'>=?');params.push(start); }
    if (end!==null) { filters.push(timeSql+'<?');params.push(end+86400); }
    const where=filters.length?' WHERE '+filters.join(' AND '):'';
    const data=await db.prepare(projection()+where+' ORDER BY sort_time DESC,c.id DESC LIMIT ? OFFSET ?')
      .bind(...params,pageSize+1,(page-1)*pageSize).all();
    return reply({success:true,items:data.results.slice(0,pageSize).map(exposed),page,hasMore:data.results.length>pageSize});
  } catch {
    return reply({success:false,message:'推播紀錄暫時無法讀取，請稍後再試。'},503);
  }
}

import {recipientIssueReasons} from './segment-audience.js';
