const VENDOR_LINE_LOOKUP_SQL = `
SELECT id, name, status, contact_line_user_id, submitted_by_line_user_id, updated_at
FROM welfare_vendors
WHERE contact_line_user_id = ? OR submitted_by_line_user_id = ?
ORDER BY CASE WHEN status = 'approved' THEN 0 ELSE 1 END, updated_at DESC
LIMIT 1
`;

export async function findVendorByLineUserIdReadOnly(db, lineUserId) {
  if (!db || !lineUserId) {
    return null;
  }

  try {
    return (
      (await db
        .prepare(VENDOR_LINE_LOOKUP_SQL)
        .bind(lineUserId, lineUserId)
        .first()) || null
    );
  } catch (error) {
    console.warn("findVendorByLineUserIdReadOnly failed", error);
    return null;
  }
}
