const ADMIN_UID_WHITELIST_SQL = `
SELECT id, line_user_id, display_name, role, allowed_modules, active, note
FROM admin_uid_whitelist
WHERE line_user_id = ?
  AND active = 1
LIMIT 1
`;

export async function findAdminUidWhitelistRowReadOnly(db, lineUserId) {
  if (!db || !lineUserId) {
    return null;
  }

  try {
    return await db
      .prepare(ADMIN_UID_WHITELIST_SQL)
      .bind(lineUserId)
      .first();
  } catch (error) {
    console.warn("findAdminUidWhitelistRowReadOnly failed", error);
    return null;
  }
}
