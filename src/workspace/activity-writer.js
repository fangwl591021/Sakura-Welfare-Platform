const ALLOWED_AUDIENCE = new Set([
  "all",
  "visitor",
  "employee",
  "manager",
]);

const SELECT_ACTIVITY_TOKEN_SQL = `
SELECT qr_token
FROM welfare_activity_events
WHERE id = ?
LIMIT 1
`;

const UPSERT_ACTIVITY_SQL = `
INSERT INTO welfare_activity_events (
  id,
  title,
  description,
  location,
  start_at,
  end_at,
  checkin_start_at,
  checkin_end_at,
  status,
  audience_scope,
  qr_token,
  cover_image_url,
  cover_image_key,
  created_at,
  updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  datetime('now', '+8 hours'),
  datetime('now', '+8 hours')
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  location = excluded.location,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  checkin_start_at = excluded.checkin_start_at,
  checkin_end_at = excluded.checkin_end_at,
  status = excluded.status,
  audience_scope = excluded.audience_scope,
  qr_token = excluded.qr_token,
  cover_image_url = excluded.cover_image_url,
  cover_image_key = excluded.cover_image_key,
  updated_at = datetime('now', '+8 hours')
`;

const SELECT_ACTIVITY_SQL = `
SELECT *
FROM welfare_activity_events
WHERE id = ?
LIMIT 1
`;

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeAudience(value) {
  const input = Array.isArray(value)
    ? value
    : normalizeString(value || "all").split(",");

  const audience = [
    ...new Set(
      input
        .map(normalizeString)
        .filter((item) => ALLOWED_AUDIENCE.has(item)),
    ),
  ];

  return JSON.stringify(
    audience.length ? audience : ["all"],
  );
}

function defaultNormalizeDate(value) {
  return normalizeString(value);
}

function defaultCreateId() {
  return crypto.randomUUID();
}

function defaultCreateQrToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function saveWorkspaceActivity(
  db,
  data = {},
  {
    ensureTables,
    normalizeDate = defaultNormalizeDate,
    createId = defaultCreateId,
    createQrToken = defaultCreateQrToken,
  } = {},
) {
  if (!db) {
    return {
      success: false,
      message: "D1 資料庫未設定。",
      event: null,
    };
  }

  const title = normalizeString(data.title);

  if (!title) {
    return {
      success: false,
      message: "活動名稱必填。",
      event: null,
    };
  }

  if (typeof ensureTables === "function") {
    await ensureTables(db);
  }

  const id = normalizeString(data.id) || createId();

  try {
    const existing = await db
      .prepare(SELECT_ACTIVITY_TOKEN_SQL)
      .bind(id)
      .first();

    const qrToken =
      normalizeString(data.qr_token) ||
      normalizeString(existing?.qr_token) ||
      createQrToken();

    await db
      .prepare(UPSERT_ACTIVITY_SQL)
      .bind(
        id,
        title,
        normalizeString(data.description),
        normalizeString(data.location),
        normalizeDate(data.start_at || data.startAt),
        normalizeDate(data.end_at || data.endAt),
        normalizeDate(
          data.checkin_start_at ||
          data.checkinStartAt,
        ),
        normalizeDate(
          data.checkin_end_at ||
          data.checkinEndAt,
        ),
        normalizeString(data.status) || "active",
        normalizeAudience(
          data.audience_scope || data.audience,
        ),
        qrToken,
        normalizeString(data.cover_image_url || data.coverImageUrl),
        normalizeString(data.cover_image_key || data.coverImageKey),
      )
      .run();

    const event = await db
      .prepare(SELECT_ACTIVITY_SQL)
      .bind(id)
      .first();

    return {
      success: true,
      message: "活動已建立。",
      event: event || {
        id,
        title,
        location: normalizeString(data.location),
        start_at: normalizeDate(
          data.start_at || data.startAt,
        ),
        status:
          normalizeString(data.status) || "active",
        qr_token: qrToken,
        cover_image_url: normalizeString(
          data.cover_image_url || data.coverImageUrl,
        ),
        cover_image_key: normalizeString(
          data.cover_image_key || data.coverImageKey,
        ),
      },
    };
  } catch (error) {
    console.warn("saveWorkspaceActivity failed", error);

    return {
      success: false,
      message: "活動建立失敗，請稍後再試。",
      event: null,
    };
  }
}
