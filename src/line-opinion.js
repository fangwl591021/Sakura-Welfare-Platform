const visibleMessage = "COALESCE(e.message_type, '') <> 'location'";
const highRisk = "COALESCE(e.priority, '') IN ('high', 'critical')";
const complaint = "e.sentiment_type = 'complaint'";
const pending = `e.process_status IN ('open', 'new') AND ${visibleMessage} AND (${complaint} OR ${highRisk})`;

export async function getPendingLineOpinions(db, formatMessage) {
  const [counts, recent] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${complaint} THEN 1 ELSE 0 END) AS complaints,
      SUM(CASE WHEN ${highRisk} THEN 1 ELSE 0 END) AS high
      FROM line_webhook_events e WHERE ${pending}`).first(),
    db.prepare(`SELECT e.id, e.line_user_id, e.message_type, e.message_text, e.priority,
      e.sentiment_type, e.created_at, p.display_name
      FROM line_webhook_events e
      LEFT JOIN line_user_profiles p ON p.line_user_id = e.line_user_id
      WHERE ${pending} ORDER BY e.id DESC LIMIT 8`).all(),
  ]);
  return {
    success: true,
    summary: { total: Number(counts?.total || 0), complaints: Number(counts?.complaints || 0), high: Number(counts?.high || 0) },
    events: (recent.results || []).map(event => ({
      id: event.id,
      displayName: event.display_name || (event.line_user_id ? `LINE ${event.line_user_id.slice(-6)}` : 'LINE 訊息'),
      messageText: formatMessage(event).slice(0, 100),
      priority: event.priority,
      sentimentType: event.sentiment_type,
      createdAt: event.created_at,
    })),
  };
}

export async function findLineOpinion(db, eventId) {
  const id = Number(eventId);
  if (!/^[1-9]\d*$/.test(eventId) || !Number.isSafeInteger(id)) return null;
  const event = await db.prepare(`SELECT e.id, e.event_id, e.line_user_id, e.message_type,
    e.message_text, e.created_at FROM line_webhook_events e
    WHERE e.id = ? AND ${visibleMessage} AND (
      ${highRisk} OR e.sentiment_type IN ('complaint', 'vendor_support')
      OR e.message_text LIKE '%不能用%' OR e.message_text LIKE '%抱怨%' OR e.message_text LIKE '%客訴%'
    )`).bind(id).first();
  if (!event) return null;

  const key = event.event_id || '';
  const message = await db.prepare(`SELECT id, thread_id, message_type, sender_role, sender_id,
    sender_name, message_text, created_at, inserted_at FROM line_messages
    WHERE (${key ? 'line_event_id = ?' : "id = ? AND line_event_id = ''"})
      AND (COALESCE(?, '') = '' OR sender_id = ?)
      AND sender_role = 'user'`).bind(key || `legacy:${id}`, event.line_user_id, event.line_user_id).first();
  return { event, message };
}

export async function readLineOpinionContext(db, message) {
  const select = `SELECT id, message_type, sender_role, sender_id, sender_name, message_text, created_at
    FROM line_messages WHERE thread_id = ?`;
  const order = 'created_at, inserted_at, id';
  const [before, after] = await Promise.all([
    db.prepare(`${select} AND (${order}) < (?, ?, ?)
      ORDER BY created_at DESC, inserted_at DESC, id DESC LIMIT 40`)
      .bind(message.thread_id, message.created_at, message.inserted_at, message.id).all(),
    db.prepare(`${select} AND (${order}) > (?, ?, ?) ORDER BY ${order} LIMIT 40`)
      .bind(message.thread_id, message.created_at, message.inserted_at, message.id).all(),
  ]);
  return [...(before.results || []).reverse(), message, ...(after.results || [])];
}
