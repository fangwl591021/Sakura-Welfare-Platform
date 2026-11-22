const VENDOR_BY_ID_SQL = `
SELECT *
FROM welfare_vendors
WHERE id = ?
  AND COALESCE(is_hidden, 0) = 0
LIMIT 1
`;

export async function findVisibleVendorByIdReadOnly(db, vendorId) {
  const normalizedVendorId = String(vendorId || "").trim();

  if (!db || !normalizedVendorId) {
    return null;
  }

  try {
    return (
      (await db
        .prepare(VENDOR_BY_ID_SQL)
        .bind(normalizedVendorId)
        .first()) || null
    );
  } catch (error) {
    console.warn("findVisibleVendorByIdReadOnly failed", error);
    return null;
  }
}
