// Legacy databases without the additive club migration retain their original policy.
export async function clubRegistrationPolicy(db) {
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='welfare_activity_club_links'").bind().first();
  if (!exists) return { announcements: new Set(), sql: '' };
  const rows = await db.prepare("SELECT id FROM welfare_activity_club_links WHERE json_extract(content_json,'$.mode')='announcement'").bind().all();
  return { announcements: new Set(rows.results.map(row => row.id)),
    sql: " AND NOT EXISTS(SELECT 1 FROM welfare_activity_club_links WHERE id=? AND json_extract(content_json,'$.mode')='announcement')" };
}
