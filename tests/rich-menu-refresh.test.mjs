import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { queueRichMenuRefresh, planRichMenuRefresh, processRichMenuRefresh } from "../src/rich-menu-refresh.js";

const id = (n) => "richmenu-" + n.toString(16).padStart(32, "0");
const STATE = "rich_menu_refresh_batch_v1";
const PREFIX = "rich_menu_refresh_source_v1:";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT);
    CREATE TABLE rich_menu_projects (id TEXT PRIMARY KEY, deployed_rich_menu_id TEXT);`);
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind(...args) { this.args = args; return this; }, args: [],
      async run() { return { meta: statement.run(...this.args) }; },
      async all() { return { results: statement.all(...this.args) }; },
      async first() { return statement.get(...this.args) || null; } };
  } };
  const env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: "synthetic-test-token" };
  for (const [locale, n] of [["zh", 11], ["id", 12], ["th", 13]]) {
    sqlite.prepare("INSERT INTO rich_menu_projects VALUES (?, ?)").run(locale, id(n));
  }
  const state = () => JSON.parse(sqlite.prepare("SELECT setting_value FROM system_settings WHERE setting_key=?").get(STATE)?.setting_value || "null");
  return { sqlite, db, env, state };
}
function api(phase = "succeeded", status = 202) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: init.body && JSON.parse(init.body) });
    if (url.includes("progress/batch")) return Response.json({ phase, completedTime: "test" });
    if (url.includes("validate/batch")) return Response.json({});
    return Response.json({}, { status, headers: status === 202 ? { "x-line-request-id": "synthetic-receipt" } : {} });
  };
  return { calls, fetcher };
}

test("three languages are replaced within their own project, never with the global default", async () => {
  const f = fixture();
  for (const [locale, n] of [["zh", 1], ["id", 2], ["th", 3]]) await queueRichMenuRefresh(f.db, locale, id(n));
  const line = api();
  const accepted = await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 });
  assert.equal(accepted.phase, "ongoing");
  assert.deepEqual(line.calls[1].body.operations, [1, 2, 3].map((n) => ({ type: "link", from: id(n), to: id(n + 10) })));
  assert.equal(f.state().phase, "ongoing", "202 is not completion");
  const completed = await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 2000 });
  assert.equal(completed.phase, "succeeded");
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT setting_value FROM system_settings WHERE setting_key=?").get(PREFIX + id(2)).setting_value).completedTarget, id(12));
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 3000 });
  assert.equal(line.calls.filter((c) => c.url.endsWith("/batch") && !c.url.includes("validate")).length, 1);
  assert.ok(line.calls.every((c) => !c.url.includes("user/all") && !c.url.includes("unlink")));
});

test("completed sources follow subsequent publications directly, without chained operations", () => {
  assert.deepEqual(planRichMenuRefresh([
    { projectId: "id", from: id(2), completedTarget: id(12) }, { projectId: "id", from: id(12) }
  ], [{ id: "id", deployed_rich_menu_id: id(22) }]), [
    { type: "link", from: id(2), to: id(22) }, { type: "link", from: id(12), to: id(22) }
  ]);
});

test("missing, invalid, already-current and completed targets do not migrate", () => {
  assert.deepEqual(planRichMenuRefresh([
    { projectId: "deleted", from: id(1) }, { projectId: "id", from: "not-a-menu" },
    { projectId: "id", from: id(12) }, { projectId: "id", from: id(2), completedTarget: id(12) }
  ], [{ id: "id", deployed_rich_menu_id: id(12) }]), []);
});

test("a recorded old menu cannot be reassigned to another language project", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "id", id(2));
  await queueRichMenuRefresh(f.db, "zh", id(2));
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT setting_value FROM system_settings WHERE setting_key=?").get(PREFIX + id(2)).setting_value).projectId, "id");
});

test("uncertain submission is journaled and retried with the same key after rate backoff", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "id", id(2));
  const line = api();
  const fetcher = async (url, init) => {
    if (url.endsWith("/batch") && !url.includes("validate")) throw new TypeError("Synthetic network failure");
    return line.fetcher(url, init);
  };
  assert.equal((await processRichMenuRefresh(f.env, { fetcher, now: 1000 })).phase, "deferred");
  const key = f.state().resumeRequestKey;
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 2000 });
  assert.equal(line.calls.length, 1);
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1202000 });
  assert.equal(line.calls.at(-1).body.resumeRequestKey, key);
});

test("429 does not complete the source or create a new resume key", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "th", id(3));
  const line = api("succeeded", 429);
  const first = await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 });
  assert.equal(first.phase, "retry-wait");
  const second = await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1202000 });
  assert.equal(second.resumeRequestKey, first.resumeRequestKey);
  assert.equal(second.phase, "retry-wait");
});

test("ongoing batch is polled, not resubmitted", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "zh", id(1));
  const line = api("ongoing");
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 });
  assert.equal((await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1800000 })).phase, "ongoing");
  assert.equal(line.calls.filter((c) => c.body?.resumeRequestKey).length, 1);
});

test("failed batch is resumed with its original request key", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "zh", id(1));
  const line = api("failed");
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 });
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1202000 });
  assert.equal(line.calls[1].body.resumeRequestKey, line.calls.at(-1).body.resumeRequestKey);
});

test("validation failure performs no batch write", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "id", id(2));
  let count = 0;
  const result = await processRichMenuRefresh(f.env, { now: 1000, fetcher: async () => { count++; return Response.json({}, { status: 400 }); } });
  assert.equal(result.phase, "validation-failed");
  assert.equal(count, 1);
  assert.equal(f.state(), null);
});

test("expired batch never starts over with a new request key", async () => {
  const f = fixture();
  await queueRichMenuRefresh(f.db, "id", id(2));
  const line = api();
  await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 });
  const key = f.state().resumeRequestKey;
  assert.equal((await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 14 * 86400000 })).phase, "expired");
  assert.equal(f.state().resumeRequestKey, key);
  assert.equal(line.calls.length, 2);
});

test("SQL lease prevents simultaneous runners", async () => {
  const f = fixture();
  f.sqlite.prepare("INSERT INTO system_settings VALUES (?, ?, '')").run("rich_menu_refresh_lease_v1", "999999");
  const line = api();
  assert.equal((await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 })).phase, "busy");
  assert.equal(line.calls.length, 0);
});

test("no token or no pending work performs no LINE request", async () => {
  const f = fixture();
  const line = api();
  assert.equal((await processRichMenuRefresh({ DB: f.db }, { fetcher: line.fetcher })).phase, "disabled");
  assert.equal((await processRichMenuRefresh(f.env, { fetcher: line.fetcher, now: 1000 })).phase, "idle");
  assert.equal(line.calls.length, 0);
});

test("publishing captures the stored previous menu, preserves its owner and queues automatic refresh", async () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function deployAndSaveRichMenu("), source.indexOf("async function deployRichMenuToLine("));
  const previous = { deployed_rich_menu_id: id(2), owner_uid: "synthetic-owner" };
  let saved, queued;
  const context = { crypto, URL, normalizeRichMenuAliasId: (v) => v, isVisitorDefaultRichMenuAlias: () => false,
    taiwanNowString: () => "test", deployRichMenuToLine: async () => ({ success: true, data: { richMenuId: id(12), richMenuAliasId: "indo-menu" } }),
    saveRichMenuProject: async (_db, _env, _req, data) => { saved = data; return { success: true, data }; },
    queueRichMenuRefresh: async (...args) => { queued = args; }, processRichMenuRefresh: async () => ({ phase: "ongoing" }) };
  const fn = vm.runInNewContext(body + "\ndeployAndSaveRichMenu", context);
  const db = { prepare() { return { bind() { return this; }, first: async () => previous, run: async () => ({}) }; } };
  const result = await fn({ id: "indo-menu", richMenuConfig: { aliasId: "indo-menu", name: "SKU-indo" }, oldRichMenuId: id(1) }, db, { DB: db }, { url: "https://sakura-welfare-platform.fangwl591021.workers.dev/api" });
  assert.equal(saved.ownerUid, previous.owner_uid);
  assert.equal(queued[2], id(2), "client-supplied arbitrary old IDs are ignored");
  assert.equal(result.data.userMenuRefresh.phase, "ongoing");
  assert.match(source, /async scheduled\([\s\S]*?ctx.waitUntil\(processRichMenuRefresh\(env\)\)/);
});
