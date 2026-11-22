const hour = 3600000;
const day = 24*hour;
const maxAge = 21*day;
const finalAge = 15*day;
const unitPattern = /^sp_[a-f0-9]{27}$/;
const utc9 = ms=>new Date(ms+9*hour).toISOString().slice(0,10).replaceAll('-','');
const count = value=>Number.isSafeInteger(value)&&value>=0 ? value : null;

export async function registerSegmentInsights(db, campaignId, now) {
  const unit='sp_'+campaignId.toLowerCase().replaceAll('-','').slice(0,27);
  if(!unitPattern.test(unit))return null;
  try {
    await db.prepare("INSERT OR IGNORE INTO welfare_push_insights(campaign_id,unit_name,started_at,next_sync_at) VALUES(?,?,?,?)")
      .bind(campaignId,unit,now,now+day).run();
    const saved=await db.prepare('SELECT unit_name FROM welfare_push_insights WHERE campaign_id=?').bind(campaignId).first();
    return saved?.unit_name===unit ? unit : null;
  }catch{
    // A reporting failure must never block or retry a confirmed push.
    return null;
  }
}

export function segmentPushPayload(to,messages,unit) {
  return {to,messages,...(unitPattern.test(unit||'')?{customAggregationUnits:[unit]}:{})};
}

export function normalizeLineInsights(payload) {
  if (!payload?.overview || !Array.isArray(payload.clicks)) throw Error('Invalid LINE insights response');
  const {uniqueImpression,uniqueClick}=payload.overview;
  if(![uniqueImpression,uniqueClick].every(value=>value===null||count(value)!==null)){
    throw Error('Invalid LINE insights counters');
  }
  const urls=new Map();
  for(const record of payload.clicks){
    if(typeof record?.url!=='string'||record.url.length>10000)continue;
    let url;
    try{url=new URL(record.url);}catch{continue;}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;
    const clicks=count(record.click),people=count(record.uniqueClickOfRequest);
    const previous=urls.get(url.href);
    // LINE reports total clicks by link occurrence and people across all
    // occurrences of the same URL. Do not sum people across occurrences.
    const clicksCombined=previous ? (
      clicks===null||previous.clicks===null ? null : count(previous.clicks+clicks)
    ) : clicks;
    const peopleCombined=previous && previous.people!==null && people!==null ? Math.max(previous.people,people)
      : (people ?? previous?.people ?? null);
    urls.set(url.href,{label:(url.origin+url.pathname).slice(0,300),clicks:clicksCombined,people:peopleCombined});
  }
  return {opens:uniqueImpression,clickers:uniqueClick,links:[...urls.values()].slice(0,200)};
}

async function syncRow(db, row, token, now, request) {
  // Atomic lease to avoid multiple Workers polling the same campaign.
  const lease=now+15*60000;
  const claimed=await db.prepare("UPDATE welfare_push_insights SET next_sync_at=? WHERE campaign_id=? AND next_sync_at=?")
    .bind(lease,row.campaign_id,row.next_sync_at).run();
  if(!claimed.meta.changes)return 0;
  try {
    const url=new URL('https://api.line.me/v2/bot/insight/message/event/aggregation');
    url.search=new URLSearchParams({customAggregationUnit:row.unit_name,from:utc9(row.started_at),to:utc9(Math.min(now,row.started_at+finalAge))});
    const response=await request(url.href,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(7000)});
    if(!response.ok){await response.body?.cancel();throw Error('LINE insights not available');}
    const result=normalizeLineInsights(await response.json());
    const next=now-row.started_at>=finalAge ? null : now+6*hour;
    await db.prepare("UPDATE welfare_push_insights SET synced_at=?,unique_opens=?,unique_clickers=?,links_json=?,next_sync_at=?,sync_failed=0 WHERE campaign_id=? AND next_sync_at=?")
      .bind(now,result.opens,result.clickers,JSON.stringify(result.links),next,row.campaign_id,lease).run();
    return 1;
  } catch {
    // Keep the last good snapshot on transient provider errors.
    const next=now-row.started_at>=maxAge ? null : now+hour;
    await db.prepare("UPDATE welfare_push_insights SET next_sync_at=?,sync_failed=1 WHERE campaign_id=? AND next_sync_at=?")
      .bind(next,row.campaign_id,lease).run();
    return 0;
  }
}

export async function syncDueSegmentInsights(db,token,now=Date.now(),request=fetch) {
  if(!db||!token)return 0;
  // At most 36 calls/hour on the existing five-minute schedule.
  const due=await db.prepare("SELECT i.campaign_id,i.unit_name,i.started_at,i.next_sync_at FROM welfare_push_insights i " +
    "JOIN welfare_push_campaigns c ON c.id=i.campaign_id WHERE i.next_sync_at<=? " +
    "AND (c.success_count>0 OR c.status='needs_review') ORDER BY i.next_sync_at,i.campaign_id LIMIT 3")
    .bind(now).all();
  const settled=await Promise.allSettled(due.results.map(row=>syncRow(db,row,token,now,request)));
  return settled.reduce((n,r)=>n+(r.status==='fulfilled'?r.value:0),0);
}
