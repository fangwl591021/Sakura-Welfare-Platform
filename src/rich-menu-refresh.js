const SOURCE_PREFIX = "rich_menu_refresh_source_v1:";
const STATE_KEY = "rich_menu_refresh_batch_v1";
const LEASE_KEY = "rich_menu_refresh_lease_v1";
const INTERVAL = 20 * 60 * 1000 + 1000;
const MAX_AGE = 13 * 24 * 60 * 60 * 1000;
const validId = (id) => /^richmenu-[a-f0-9]{32}$/.test(String(id || ""));

async function write(db, key, value) {
  await db.prepare(`INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET
    setting_value = excluded.setting_value, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

export async function queueRichMenuRefresh(db, projectId, from) {
  if (!db || !projectId || !validId(from)) return;
  // A source belongs permanently to its original project, never to a global default.
  await db.prepare(`INSERT OR IGNORE INTO system_settings
    (setting_key, setting_value, updated_at) VALUES (?, ?, ?)`)
    .bind(SOURCE_PREFIX + from, JSON.stringify({ projectId, from }), new Date().toISOString()).run();
}

export function planRichMenuRefresh(sources, projects) {
  const targets = new Map(projects.map((p) => [p.id, p.deployed_rich_menu_id]));
  return sources.flatMap((source) => {
    const to = targets.get(source.projectId);
    return validId(source.from) && validId(to) && source.from !== to && source.completedTarget !== to
      ? [{ type: "link", from: source.from, to }] : [];
  }).slice(0, 1000);
}

export async function processRichMenuRefresh(env, options = {}) {
  const db = env.DB;
  if (!db || !env.LINE_CHANNEL_ACCESS_TOKEN) return { phase: "disabled" };
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher || fetch;
  await db.prepare(`INSERT OR IGNORE INTO system_settings
    (setting_key, setting_value, updated_at) VALUES (?, '0', '')`).bind(LEASE_KEY).run();
  const lease = String(now + 120000);
  const acquired = await db.prepare(`UPDATE system_settings SET setting_value = ?
    WHERE setting_key = ? AND CAST(setting_value AS INTEGER) < ?`).bind(lease, LEASE_KEY, now).run();
  if (!acquired.meta?.changes) return { phase: "busy" };
  let state;
  try {
    const rows = (await db.prepare(`SELECT setting_key, setting_value FROM system_settings
      WHERE setting_key = ? OR substr(setting_key, 1, ?) = ?`)
      .bind(STATE_KEY, SOURCE_PREFIX.length, SOURCE_PREFIX).all()).results || [];
    const sources = rows.filter((r) => r.setting_key.startsWith(SOURCE_PREFIX))
      .map((r) => JSON.parse(r.setting_value));
    state = JSON.parse(rows.find((r) => r.setting_key === STATE_KEY)?.setting_value || "null");
    const call = async (path, body) => {
      const response = await fetcher("https://api.line.me/v2/bot/richmenu/" + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, requestId: response.headers.get("x-line-request-id"),
        json: text ? JSON.parse(text) : {} };
    };
    if (state && state.phase !== "succeeded") {
      if (now - state.createdAt > MAX_AGE) {
        state.phase = "expired";
        await write(db, STATE_KEY, state);
        return state;
      }
      if (state.requestId) {
        const progress = await call("progress/batch?requestId=" + encodeURIComponent(state.requestId));
        if (!progress.ok) return { phase: "progress-unavailable", status: progress.status };
        state.phase = progress.json.phase;
        state.checkedAt = now;
        if (state.phase === "succeeded") {
          for (const operation of state.operations) {
            const source = sources.find((s) => s.from === operation.from);
            if (source) await write(db, SOURCE_PREFIX + source.from, { ...source, completedTarget: operation.to });
          }
          state.completedAt = progress.json.completedTime || now;
          await write(db, "rich_menu_refresh_receipt_v1:" + state.resumeRequestKey, state);
        }
        await write(db, STATE_KEY, state);
        if (state.phase !== "failed") return state;
      }
      if (now < state.nextAttemptAt) return state;
    } else {
      const projects = (await db.prepare("SELECT id, deployed_rich_menu_id FROM rich_menu_projects").all()).results || [];
      const operations = planRichMenuRefresh(sources, projects);
      if (!operations.length) return state || { phase: "idle" };
      if (state && now < state.nextAttemptAt) return { phase: "rate-wait", nextAttemptAt: state.nextAttemptAt };
      const validation = await call("validate/batch", { operations });
      if (!validation.ok) return { phase: "validation-failed", status: validation.status };
      state = { phase: "queued", operations, resumeRequestKey: crypto.randomUUID(), createdAt: now, nextAttemptAt: now };
    }
    // Journal before sending. Uncertain responses and failed batches reuse the same resume key.
    state.nextAttemptAt = now + INTERVAL;
    state.phase = "submitting";
    await write(db, STATE_KEY, state);
    const submitted = await call("batch", { operations: state.operations, resumeRequestKey: state.resumeRequestKey });
    state.httpStatus = submitted.status;
    if (submitted.ok && submitted.requestId) {
      state.requestId = submitted.requestId;
      state.phase = "ongoing";
    } else {
      state.phase = "retry-wait";
      // A failed resume must be submitted again, not only polled against the earlier receipt.
      state.requestId = null;
    }
    await write(db, STATE_KEY, state);
    return state;
  } catch (error) {
    // No token, LINE response body, or member identifiers enter logs.
    console.error("Rich menu refresh deferred", error?.name || "Error");
    return { phase: "deferred", resumeRequestKey: state?.resumeRequestKey };
  } finally {
    await db.prepare("UPDATE system_settings SET setting_value = '0' WHERE setting_key = ? AND setting_value = ?")
      .bind(LEASE_KEY, lease).run();
  }
}
