const SESSION_TTL_SECONDS = 60 * 60 * 24;

const CREATE_SESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workspace_agent_sessions (
  line_user_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  current_step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
)
`;

const SELECT_SESSION_SQL = `
SELECT
  line_user_id,
  agent_name,
  current_step,
  status,
  payload_json,
  created_at,
  updated_at,
  expires_at
FROM workspace_agent_sessions
WHERE line_user_id = ?
  AND expires_at > datetime('now')
LIMIT 1
`;

const UPSERT_SESSION_SQL = `
INSERT INTO workspace_agent_sessions (
  line_user_id,
  agent_name,
  current_step,
  status,
  payload_json,
  created_at,
  updated_at,
  expires_at
) VALUES (
  ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?
)
ON CONFLICT(line_user_id) DO UPDATE SET
  agent_name = excluded.agent_name,
  current_step = excluded.current_step,
  status = excluded.status,
  payload_json = excluded.payload_json,
  updated_at = datetime('now'),
  expires_at = excluded.expires_at
`;

const DELETE_SESSION_SQL = `
DELETE FROM workspace_agent_sessions
WHERE line_user_id = ?
`;

function normalizeString(value) {
  return String(value || "").trim();
}

function parsePayload(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function expiresAtFromNow(now, ttlSeconds) {
  return new Date(
    now.getTime() + ttlSeconds * 1000,
  ).toISOString();
}

export async function ensureWorkspaceAgentSessionTable(db) {
  if (!db) {
    return false;
  }

  try {
    await db.prepare(CREATE_SESSION_TABLE_SQL).run();
    return true;
  } catch (error) {
    console.warn(
      "ensureWorkspaceAgentSessionTable failed",
      error,
    );

    return false;
  }
}

export async function getWorkspaceAgentSession(
  db,
  lineUserId,
) {
  const normalizedLineUserId = normalizeString(lineUserId);

  if (!db || !normalizedLineUserId) {
    return null;
  }

  try {
    const row = await db
      .prepare(SELECT_SESSION_SQL)
      .bind(normalizedLineUserId)
      .first();

    if (!row) {
      return null;
    }

    return {
      lineUserId: normalizeString(row.line_user_id),
      agent: normalizeString(row.agent_name),
      step: normalizeString(row.current_step),
      status: normalizeString(row.status) || "running",
      payload: parsePayload(row.payload_json),
      createdAt: normalizeString(row.created_at),
      updatedAt: normalizeString(row.updated_at),
      expiresAt: normalizeString(row.expires_at),
    };
  } catch (error) {
    console.warn(
      "getWorkspaceAgentSession failed",
      error,
    );

    return null;
  }
}

export async function saveWorkspaceAgentSession(
  db,
  {
    lineUserId,
    agent,
    step,
    status = "running",
    payload = {},
    now = new Date(),
    ttlSeconds = SESSION_TTL_SECONDS,
  } = {},
) {
  const normalizedLineUserId = normalizeString(lineUserId);
  const normalizedAgent = normalizeString(agent);
  const normalizedStep = normalizeString(step);
  const normalizedStatus =
    normalizeString(status) || "running";

  if (
    !db ||
    !normalizedLineUserId ||
    !normalizedAgent ||
    !normalizedStep
  ) {
    return false;
  }

  const safePayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};

  try {
    await db
      .prepare(UPSERT_SESSION_SQL)
      .bind(
        normalizedLineUserId,
        normalizedAgent,
        normalizedStep,
        normalizedStatus,
        JSON.stringify(safePayload),
        expiresAtFromNow(now, ttlSeconds),
      )
      .run();

    return true;
  } catch (error) {
    console.warn(
      "saveWorkspaceAgentSession failed",
      error,
    );

    return false;
  }
}

export async function clearWorkspaceAgentSession(
  db,
  lineUserId,
) {
  const normalizedLineUserId = normalizeString(lineUserId);

  if (!db || !normalizedLineUserId) {
    return false;
  }

  try {
    await db
      .prepare(DELETE_SESSION_SQL)
      .bind(normalizedLineUserId)
      .run();

    return true;
  } catch (error) {
    console.warn(
      "clearWorkspaceAgentSession failed",
      error,
    );

    return false;
  }
}
