const ORIGIN = "https://sakura-welfare-platform.fangwl591021.workers.dev";
export const STATE_KEY = "monitoring/sakura-health/state-v1.json";
export const CHECKS = Object.freeze([
  ["ADMIN", "/sakura-admin"],
  ["ACTIVITY_ADMIN", "/activity-checkin-admin"],
  ["REGISTRATION", "/activity-registration"],
  ["OFFERS_ZH", "/current-offers"],
  ["OFFERS_ID", "/current-offers-id"],
  ["OFFERS_TH", "/current-offers-th"],
  ["STORES", "/partner-stores"],
  ["VENDOR_LOGIN", "/vendor-login"],
  ["MEMBER_APP", "/member-app"],
  ["MEMBER_HISTORY", "/member-redemptions"],
  ["ACTIVITY_AUTH", "/admin-api/activity-checkin", "auth"],
  ["FORM_AUTH", "/admin-api/activity-form?event_id=health-probe", "auth"],
  ["QR_AUTH", "/admin-api/activity-qr-checkin", "auth"],
  ["TUTORIAL", "/activity-tutorials/activity-checkin-20260916-v1.mp4", "media"]
]);
const SETTINGS_SQL = "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('telegram_enabled','telegram_bot_token','telegram_chat_id')";
const TABLES = ["welfare_members", "welfare_vendors", "welfare_activity_events"];
const enabled = value => ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function bounded(promise, ms = 6000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("TIMEOUT")), ms); })]); }
  finally { clearTimeout(timer); }
}

async function probe([id, path, kind], fetcher) {
  let response;
  try {
    response = await fetcher(ORIGIN + path, { method: kind === "media" ? "HEAD" : "GET", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "Cache-Control": "no-cache" } });
    if (kind === "auth") return [401, 403].includes(response.status) ? null : `${id}_HTTP_${response.status}`;
    if (response.status !== 200) return `${id}_HTTP_${response.status}`;
    const type = response.headers.get("content-type") || "";
    if (!type.includes(kind === "media" ? "video/mp4" : "text/html")) return `${id}_CONTENT_TYPE`;
    if (kind !== "media") {
      const reader = response.body.getReader();
      let sample = "", bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (bytes < 131072) {
          const { value, done } = await bounded(reader.read());
          if (done) break;
          bytes += value.byteLength;
          sample += decoder.decode(value, { stream: true });
          if (sample.includes("<title>")) break;
        }
      } finally { await reader.cancel(); }
      if (!sample.includes("<title>")) return `${id}_HTML_MARKER`;
    }
    return null;
  } catch { return `${id}_NETWORK`; }
  finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
}

export async function collectHealth(env, previous = {}, fetcher = globalThis.fetch.bind(globalThis)) {
  const issues = [];
  // Bounded sequential probes keep network load small; only failed probes are confirmed once.
  for (const check of CHECKS) {
    let issue = await probe(check, fetcher);
    if (issue) issue = await probe(check, fetcher);
    if (issue) issues.push(issue);
  }
  let telegram = { enabled: false }, settingsReadable = false;
  try {
    const rows = await bounded(env.DB.prepare(SETTINGS_SQL).all());
    const settings = Object.fromEntries(rows.results.map(row => [row.setting_key, row.setting_value]));
    settingsReadable = true;
    telegram = { enabled: enabled(settings.telegram_enabled), token: settings.telegram_bot_token, chatId: settings.telegram_chat_id };
    if (!telegram.enabled) issues.push("TELEGRAM_DISABLED");
    else if (!telegram.token || !telegram.chatId) issues.push("TELEGRAM_CONFIG_MISSING");
  } catch {
    issues.push("D1_SETTINGS_UNAVAILABLE");
    // Previously authorized destination, mirrored as Worker secrets for a D1 outage only.
    telegram = { enabled: previous.telegramEnabled === true, token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
  }
  try {
    const rows = await bounded(env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('welfare_members','welfare_vendors','welfare_activity_events')").all());
    const names = new Set(rows.results.map(row => row.name));
    if (TABLES.some(name => !names.has(name))) issues.push("D1_TABLES_MISSING");
  } catch { issues.push("D1_READ_FAILED"); }
  try {
    if (!await bounded(env.R2_BUCKET.head("tutorials/activity/activity-checkin-20260916-v1.mp4"))) issues.push("R2_TUTORIAL_MISSING");
  } catch { issues.push("R2_READ_FAILED"); }
  return { issues: issues.sort(), telegram, settingsReadable };
}

export function notificationText(issues, previous, at) {
  const recovered = previous.filter(code => !issues.includes(code));
  return ["櫻花福委會系統健檢", `時間：${at}`, issues.length ? `異常：${issues.join("、")}` : "已檢測項目恢復正常", recovered.length ? `恢復：${recovered.join("、")}` : "", "範圍：公開入口、管理 API 匿名拒絕、D1 與 R2 可讀性。", "未實測登入後交易、LINE 訊息或 AI 生成。未修改業務資料。", "如有異常，請查看對應入口及 Worker 錯誤；不會自動修復。"].filter(Boolean).join("\n");
}

async function sendTelegram(config, text, fetcher) {
  if (!config.enabled) return { status: "disabled" };
  if (!config.token || !config.chatId) return { status: "unconfigured" };
  try {
    const response = await fetcher(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true })
    });
    if (response.status >= 300 && response.status < 500) return { status: "failed", httpStatus: response.status };
    const result = await bounded(response.json());
    if (response.ok && result.ok === true && Number.isInteger(result.result?.message_id)) return { status: "sent", messageId: result.result.message_id };
    return { status: result.ok === false ? "failed" : "unknown" };
  } catch { return { status: "unknown" }; }
}

async function save(bucket, state) {
  await bounded(bucket.put(STATE_KEY, JSON.stringify(state), { httpMetadata: { contentType: "application/json" } }));
}

export async function runHealthCheck(env, { fetcher = globalThis.fetch.bind(globalThis), now = Date.now() } = {}) {
  const bucket = env.R2_BUCKET;
  const object = await bounded(bucket.get(STATE_KEY));
  const previous = object ? await object.json() : { notified: [], telegramEnabled: false };
  if (previous.leaseUntil > now) return { status: "busy" };
  // Conditional R2 write serializes overlapping cron/manual runs without a business table.
  const claimed = await bounded(bucket.put(STATE_KEY, JSON.stringify({ ...previous, leaseUntil: now + 300000 }), {
    onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" }
  }));
  if (!claimed) return { status: "busy" };
  try {
    const { issues, telegram, settingsReadable } = await collectHealth(env, previous, fetcher);
    const at = new Date(now).toISOString();
    const state = { ...previous, checkedAt: at, issues, leaseUntil: 0 };
    if (settingsReadable) state.telegramEnabled = telegram.enabled;
    let delivery = { status: "quiet" };
    if (previous.pending && same(issues, previous.pending.issues)) {
      delivery = { status: "unknown" };
    } else if (!same(issues, previous.notified || [])) {
      if (previous.pending) state.unconfirmedPrevious = previous.pending;
      // Persist before sending. An uncertain send must not be blindly retried.
      state.pending = { issues, at };
      await save(bucket, { ...state, leaseUntil: now + 300000 });
      delivery = await sendTelegram(telegram, notificationText(issues, previous.notified || [], new Date(now).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })), fetcher);
      if (delivery.status === "sent") { state.notified = issues; state.lastSentAt = at; state.messageId = delivery.messageId; }
      if (delivery.status !== "unknown") delete state.pending;
    }
    state.delivery = delivery.status;
    await save(bucket, state);
    const report = { checkedAt: at, issues, delivery: delivery.status, messageId: delivery.messageId };
    console.log(JSON.stringify({ event: "sakura_health", ...report }));
    return report;
  } catch {
    // Do not clear the lease or an in-flight notification on an ambiguous storage failure.
    console.error("SAKURA_HEALTH_RUN_FAILED");
    throw new Error("SAKURA_HEALTH_RUN_FAILED");
  }
}

async function authorized(request, env) {
  const expected = String(env.MONITOR_RUN_TOKEN || "");
  const actual = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!expected || !actual) return false;
  const hash = value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const left = new Uint8Array(await hash(expected)), right = new Uint8Array(await hash(actual));
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export default {
  async scheduled(controller, env) {
    controller.noRetry();
    const report = await runHealthCheck(env);
    if (["unknown", "failed", "unconfigured", "disabled"].includes(report.delivery)) throw new Error("SAKURA_HEALTH_DELIVERY_BLOCKED");
  },
  async fetch(request, env) {
    if (!await authorized(request, env)) return new Response("Not found", { status: 404 });
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "POST" && path === "/run") return Response.json(await runHealthCheck(env), { headers: { "Cache-Control": "no-store" } });
      if (request.method === "GET" && path === "/status") {
        const object = await env.R2_BUCKET.get(STATE_KEY);
        return Response.json(object ? await object.json() : { status: "not_run" }, { headers: { "Cache-Control": "no-store" } });
      }
      if (request.method === "GET" && path === "/telegram-check") {
        let errorRedirectSupported = true;
        try { new Request("https://api.telegram.org/", { redirect: "error" }); }
        catch { errorRedirectSupported = false; }
        const rows = await env.DB.prepare(SETTINGS_SQL).all();
        const settings = Object.fromEntries(rows.results.map(row => [row.setting_key, row.setting_value]));
        if (!enabled(settings.telegram_enabled)) return Response.json({ enabled: false });
        try {
          const response = await globalThis.fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/getMe`, { redirect: "manual", signal: AbortSignal.timeout(12000) });
          let data;
          try { data = await response.json(); } catch { return Response.json({ http: response.status, json: false }); }
          return Response.json({ http: response.status, ok: data.ok === true, errorRedirectSupported });
        } catch { return Response.json({ code: "TELEGRAM_NETWORK_FAILED" }); }
      }
    } catch { return Response.json({ code: "MONITOR_FAILED" }, { status: 503 }); }
    return new Response("Not found", { status: 404 });
  }
};
