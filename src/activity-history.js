import { activityScopeSql, readBoundedAdminJson } from './editor-access.js';

const pageSize = 25;
const reply = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail = (message,status=400) => reply({success:false,message},status);
const localNow = "datetime('now','+8 hours')";
const eventDate = "COALESCE(NULLIF(TRIM(e.end_at),''),NULLIF(TRIM(e.start_at),''))";
const localEventDate = `CASE WHEN substr(${eventDate},-1) IN ('Z','z') OR substr(${eventDate},-6,1) IN ('+','-')
  THEN datetime(${eventDate},'+8 hours') ELSE datetime(${eventDate}) END`;

export async function handleActivityHistory(request, db, actor) {
  const scope = activityScopeSql(actor);
  const scoped = scope ? ' AND ' + scope : '';
  if (request.method==='GET') {
    const query = new URL(request.url).searchParams;
    const mode = query.get('filter') || 'past';
    const page = Number(query.get('page') || 1), term = (query.get('q') || '').trim();
    const filters = {
      past:` AND (e.status='closed' OR (e.status='active' AND (${localEventDate})<=${localNow}))`,
      all:" AND e.status<>'archived'", draft:" AND e.status='draft'", hidden:" AND e.status='archived'"
    };
    if (!Object.hasOwn(filters,mode) || !Number.isInteger(page) || page<1 || page>10000 || term.length>100) {
      return fail('查詢條件不正確。');
    }
    const rows = await db.prepare(`
      SELECT e.id,e.title,e.location,e.start_at,e.end_at,e.status
      FROM welfare_activity_events e
      WHERE (instr(lower(e.title),lower(?))>0 OR instr(lower(e.location),lower(?))>0)${scoped}${filters[mode]}
      ORDER BY COALESCE(NULLIF(e.start_at,''),e.created_at) DESC,e.id LIMIT ? OFFSET ?
    `).bind(term,term,pageSize+1,(page-1)*pageSize).all();
    const events = rows.results || [];
    return reply({success:true,events:events.slice(0,pageSize),has_next:events.length>pageSize});
  }
  if (request.method!=='POST') return fail('不支援此操作。',405);
  let input;
  try { input = await readBoundedAdminJson(request,4000); }
  catch (error) { return fail('無法讀取活動操作請求。',error.status===413?413:400); }
  const action = input?.action, id = input?.data?.id, requestId = input?.data?.request_id;
  if (!['copy_event','hide_event','restore_event'].includes(action) || typeof id!=='string' || !id || id.length>100 ||
      typeof requestId!=='string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestId) || id===requestId) {
    return fail('請選擇有效的活動再操作。');
  }
  if (action!=='copy_event') return changeEventVisibility(db,actor,scoped,id,requestId,action==='hide_event');

  const auditId = 'activity-copy:' + requestId;
  const run = crypto.randomUUID();
  const createdHere = "EXISTS(SELECT 1 FROM welfare_audit_events WHERE id=? AND json_extract(raw_json,'$.run')=?)";
  const result = await db.batch([
    db.prepare(`
      INSERT INTO welfare_activity_events(id,title,description,location,cover_image_url,cover_image_key,audience_scope,
        start_at,end_at,checkin_start_at,checkin_end_at,registration_start_at,registration_end_at,status,qr_token,created_at,updated_at)
      SELECT ?,substr(e.title,1,145)||'（複製）',e.description,e.location,e.cover_image_url,e.cover_image_key,e.audience_scope,
        '','','','','','','draft',?,${localNow},${localNow}
      FROM welfare_activity_events e WHERE e.id=?${scoped}
      AND NOT EXISTS(SELECT 1 FROM welfare_audit_events WHERE id=?)
      ON CONFLICT(id) DO NOTHING
    `).bind(requestId,crypto.randomUUID().replaceAll('-',''),id,auditId),
    db.prepare(`
      INSERT INTO welfare_audit_events(id,actor_id,event_type,target_type,target_id,summary,raw_json)
      SELECT ?,?,'activity_draft_copied','activity',?,'活動複製為草稿',json_object('source_id',?,'run',?)
      WHERE changes()=1
    `).bind(auditId,actor,requestId,id,run),
    db.prepare(`
      INSERT INTO welfare_activity_forms(event_id,revision,schema_json,created_by,created_at)
      SELECT ?,1,schema_json,?,datetime('now') FROM welfare_activity_forms
      WHERE event_id=? AND ${createdHere} ORDER BY revision DESC LIMIT 1
    `).bind(requestId,actor,id,auditId,run),
    db.prepare(`
      INSERT INTO welfare_activity_club_links(id,club_id,content_json)
      SELECT ?,club_id,json_object('club_id',club_id,'kind','club','mode',COALESCE(json_extract(content_json,'$.mode'),'registration'))
      FROM welfare_activity_club_links WHERE id=? AND ${createdHere}
    `).bind(requestId,id,auditId,run),
    db.prepare(`
      SELECT draft.id,draft.title FROM welfare_activity_events draft JOIN welfare_audit_events a ON a.target_id=draft.id
      JOIN welfare_activity_events e ON e.id=json_extract(a.raw_json,'$.source_id')
      WHERE a.id=? AND a.actor_id=? AND a.event_type='activity_draft_copied' AND e.id=?${scoped}
    `).bind(auditId,actor,id)
  ]);
  const draft = result.at(-1)?.results?.[0];
  return draft ? reply({success:true,draft}) : fail('活動已變更或不在您的管理範圍，請重新查詢。',409);
}

async function changeEventVisibility(db,actor,scoped,id,requestId,hide) {
  const eventType = hide ? 'activity_hidden' : 'activity_restored';
  const summary = hide ? '隱藏活動' : '恢復顯示活動';
  const auditId = 'activity-visibility:' + requestId;
  const run = crypto.randomUUID();
  const fromStatus = hide ? "e.status IN ('active','closed','draft')" : "e.status='archived'";
  const toStatus = hide ? "'archived'" : `COALESCE((
    SELECT CASE WHEN a.event_type='activity_hidden'
      AND json_extract(a.raw_json,'$.before') IN ('active','closed','draft')
      THEN json_extract(a.raw_json,'$.before') END
    FROM welfare_audit_events a WHERE a.target_type='activity' AND a.target_id=e.id
      AND a.event_type IN ('activity_hidden','activity_restored')
    ORDER BY a.rowid DESC LIMIT 1
  ),'closed')`;
  const results = await db.batch([
    db.prepare(`
      INSERT INTO welfare_audit_events(id,actor_id,event_type,target_type,target_id,summary,raw_json)
      SELECT ?,?,?,'activity',e.id,?,json_object('before',e.status,'after',${toStatus},'run',?)
      FROM welfare_activity_events e WHERE e.id=? AND ${fromStatus}${scoped}
      ON CONFLICT(id) DO NOTHING
    `).bind(auditId,actor,eventType,summary,run,id),
    db.prepare(`
      UPDATE welfare_activity_events
      SET status=json_extract(a.raw_json,'$.after'),updated_at=${localNow}
      FROM welfare_audit_events a
      WHERE welfare_activity_events.id=a.target_id AND a.id=? AND json_extract(a.raw_json,'$.run')=?
    `).bind(auditId,run),
    db.prepare(`
      SELECT e.status FROM welfare_activity_events e JOIN welfare_audit_events a ON a.target_id=e.id
      WHERE e.id=? AND a.id=? AND a.actor_id=? AND a.event_type=? AND a.target_type='activity'${scoped}
    `).bind(id,auditId,actor,eventType)
  ]);
  const event = results[2]?.results?.[0];
  return event ? reply({success:true,status:event.status}) :
    fail('活動已變更或不在您的管理範圍，請重新查詢。',409);
}
