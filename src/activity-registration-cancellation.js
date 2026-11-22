const MAX_BULK = 500;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 409) => json({ success: false, message }, status);
const registrationSnapshotDigest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('');

export async function readRegistrationCancellationRevision(db, eventId) {
  const rows = await db.prepare('SELECT id, created_at FROM welfare_activity_registrations WHERE event_id = ? ORDER BY id LIMIT 501').bind(eventId).all();
  return rows.results.length > MAX_BULK ? null : registrationSnapshotDigest(rows.results);
}

// Called only after the existing activity administrator authorization/event lookup.
export async function cancelActivityRegistrations(db, event, actor, body) {
  const all = body.action === 'cancel_all_registrations';
  if (body.confirmed !== true || body.event_title !== event.title
      || typeof body.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id)
      || (!all && (typeof body.registration_id !== 'string' || !body.registration_id || body.registration_id.length > 100))) {
    return fail('請核對活動與報名資料，確認後再取消。', 400);
  }
  const auditId = 'activity-registration-cancel:' + body.request_id;
  const previous = await db.prepare('SELECT actor_id, target_id, event_type, raw_json FROM welfare_audit_events WHERE id = ?').bind(auditId).first();
  if (previous) {
    const saved = JSON.parse(previous.raw_json);
    if (previous.actor_id !== actor || previous.target_id !== event.id || previous.event_type !== 'activity.registration.cancel'
        || saved.action !== body.action || saved.registration_id !== (body.registration_id || null)) return fail('操作識別已使用，請重新載入。');
    return json({ success: true, cancelled_count: saved.cancelled_count, message: '報名已取消，未重複處理。' });
  }
  const rows = await db.prepare(`SELECT * FROM welfare_activity_registrations WHERE event_id = ?${all ? '' : ' AND id = ?'} ORDER BY id LIMIT 501`)
    .bind(...(all ? [event.id] : [event.id, body.registration_id])).all();
  const selected = rows.results;
  if (selected.length > MAX_BULK) return fail('一次最多取消 500 筆，請先逐筆處理或聯絡管理員。', 413);
  if (all && (!Number.isSafeInteger(body.expected_count) || body.expected_count !== selected.length
      || body.roster_revision !== await registrationSnapshotDigest(selected.map(({ id, created_at }) => ({ id, created_at }))))) return fail('報名名單已變更，請重新載入並確認取消範圍。');
  if (!selected.length) return all ? json({ success: true, cancelled_count: 0, message: '目前沒有報名資料。' }) : fail('此報名已取消或不存在，請重新載入。');
  const ids = JSON.stringify(selected.map(row => row.id));
  const checked = await db.prepare(`SELECT COUNT(*) AS total FROM welfare_activity_checkins c
    JOIN welfare_activity_registrations r ON r.event_id=c.event_id AND r.line_user_id=c.line_user_id
    WHERE r.event_id=? AND r.id IN (SELECT value FROM json_each(?))`).bind(event.id, ids).first();
  if (Number(checked?.total)) return fail('名單包含已簽到者，不能取消。請先核對出席紀錄；本次未取消任何報名。');
  const snapshot = JSON.stringify(selected);
  const audit = JSON.stringify({ action: body.action, registration_id: body.registration_id || null,
    event_title: event.title, cancelled_count: selected.length, registrations: selected });
  if (new TextEncoder().encode(audit).length > 500000) return fail('取消資料量過大，請改為逐筆取消，未變更任何資料。', 413);
  // Snapshot preservation and removal are one transaction. Concurrent signup/check-in
  // or changed answers invalidate the whole operation, never a partially cleared list.
  const result = await db.batch([
    db.prepare(`INSERT INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
      SELECT ?,?,?,'activity.registration.cancel','activity',?,?,?,?
      WHERE EXISTS(SELECT 1 FROM welfare_activity_events WHERE id=? AND title=?)
      AND (?=0 OR (SELECT COUNT(*) FROM welfare_activity_registrations WHERE event_id=?)=?)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) s WHERE NOT EXISTS(
        SELECT 1 FROM welfare_activity_registrations r WHERE r.event_id=? AND r.id=json_extract(s.value,'$.id')
        AND r.line_user_id=json_extract(s.value,'$.line_user_id') AND r.display_name=json_extract(s.value,'$.display_name')
        AND r.form_revision=json_extract(s.value,'$.form_revision') AND r.schema_json=json_extract(s.value,'$.schema_json')
        AND r.answers_json=json_extract(s.value,'$.answers_json') AND r.created_at=json_extract(s.value,'$.created_at')))
      AND NOT EXISTS(SELECT 1 FROM welfare_activity_checkins c JOIN welfare_activity_registrations r
        ON r.event_id=c.event_id AND r.line_user_id=c.line_user_id
        WHERE r.event_id=? AND r.id IN (SELECT value FROM json_each(?)))
      ON CONFLICT(id) DO NOTHING`).bind(auditId, actor.startsWith('line:') ? 'line_admin' : 'admin', actor,
        event.id, '取消活動報名 ' + selected.length + ' 筆', audit, new Date().toISOString(),
        event.id, event.title, all ? 1 : 0, event.id, selected.length, snapshot, event.id, event.id, ids),
    db.prepare(`DELETE FROM welfare_activity_registrations WHERE event_id=? AND id IN (SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM welfare_audit_events WHERE id=? AND actor_id=? AND target_id=? AND raw_json=?)`)
      .bind(event.id, ids, auditId, actor, event.id, audit)
  ]);
  if (!result[0]?.meta?.changes) {
    const saved = await db.prepare('SELECT raw_json FROM welfare_audit_events WHERE id=? AND actor_id=? AND target_id=?').bind(auditId, actor, event.id).first();
    if (saved?.raw_json === audit) return json({ success: true, cancelled_count: selected.length, message: '報名已取消，未重複處理。' });
    return fail('報名或簽到資料已變更，未取消任何報名。請重新載入並核對。');
  }
  return json({ success: true, cancelled_count: selected.length, message: '已取消 ' + selected.length + ' 筆報名，取消紀錄已保留。' });
}
