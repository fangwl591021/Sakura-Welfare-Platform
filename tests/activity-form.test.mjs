import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import worker from "../src/index.js";
import { normalizeActivityForm, validateActivityAnswers, generateActivityForm } from "../src/activity-form-schema.js";
import { handleActivityFormRequest, canRegisterForActivity } from "../src/activity-form-service.js";
import { buildActivityRegistrationHtml, decorateActivityAdminHtml } from "../src/activity-form-ui.js";

export const familyForm = {
  fields: [
    { id: "department", label: "部門名稱", type: "text", required: true },
    { id: "name", label: "員工姓名", type: "text", required: true },
    { id: "employee_no", label: "工號", type: "text", required: true },
    { id: "phone", label: "員工手機", type: "tel", required: true },
    ...[["total", "報名人數（含本人）"], ["children", "0-12 歲攜眷"], ["adults", "12-65 歲攜眷"], ["seniors", "66 歲以上攜眷"], ["gifts", "交換禮物人數"]].map(([id, label]) => ({
      id, label, type: "number", required: true, min: id === "total" ? 1 : 0, max: 100
    })),
    { id: "performance", label: "是否表演", type: "select", required: true, options: ["是", "否"] },
    { id: "song", label: "曲目名稱", type: "textarea", required: true, showWhen: { field: "performance", equals: "是" } }
  ],
  rules: [
    { type: "sum", target: "total", fields: ["children", "adults", "seniors"], constant: 1, message: "總數須等於本人與攜眷。" },
    { type: "max", target: "gifts", other: "total", message: "禮物人數不可超過總數。" }
  ]
};
export const validAnswers = { department: "測試部門", name: "測試人員", employee_no: "0001", phone: "0900000000", total: 3, children: 1, adults: 1, seniors: 0, gifts: 2, performance: "否" };

export function fixture({ legacy = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY, title TEXT, description TEXT, location TEXT,
    start_at TEXT, end_at TEXT, status TEXT, audience_scope TEXT, cover_image_url TEXT);
    INSERT INTO welfare_activity_events VALUES('event-1','測試家庭日','測試活動','測試會場','2099-09-03 10:56:00','2099-09-04 18:00:00','active','["employee"]','');
    CREATE TABLE welfare_activity_checkins(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,line_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',picture_url TEXT NOT NULL DEFAULT '',checkin_status TEXT NOT NULL DEFAULT 'checked_in',
      checked_at TEXT NOT NULL DEFAULT '',raw_payload TEXT NOT NULL DEFAULT '',UNIQUE(event_id,line_user_id));
    CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY, member_type TEXT, status TEXT, bind_status TEXT);
    INSERT INTO welfare_members VALUES('test-member','employee','active','bound');`);
  sqlite.exec("ALTER TABLE welfare_members ADD COLUMN employee_no TEXT NOT NULL DEFAULT ''");
  if (legacy) {
    sqlite.exec(`CREATE TABLE welfare_activity_registrations (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, line_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      registrant_type TEXT NOT NULL DEFAULT 'guest' CHECK (registrant_type IN ('employee','guest')),
      phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
      companion_count INTEGER NOT NULL DEFAULT 0, custom_fields TEXT NOT NULL DEFAULT '{}',
      lottery_ticket TEXT NOT NULL UNIQUE, registered_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
      raw_payload TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered','cancelled')),
      cancelled_at TEXT NOT NULL DEFAULT '', cancellation_source TEXT NOT NULL DEFAULT '',
      UNIQUE(event_id,line_user_id), FOREIGN KEY(event_id) REFERENCES welfare_activity_events(id));
      CREATE INDEX idx_welfare_activity_registrations_event ON welfare_activity_registrations(event_id,registered_at DESC);
      CREATE INDEX idx_welfare_activity_registrations_event_status ON welfare_activity_registrations(event_id,status,registered_at DESC);
      CREATE TABLE unrelated_records(id TEXT PRIMARY KEY, value TEXT);
      INSERT INTO unrelated_records VALUES('sentinel','unchanged');`);
    for (let i = 0; i < 6; i++) sqlite.prepare(`INSERT INTO welfare_activity_registrations
      (id,event_id,line_user_id,lottery_ticket) VALUES(?,'event-1',?,?)`).run('legacy-' + i, 'synthetic-' + i, 'ticket-' + i);
  }
  sqlite.exec(readFileSync(new URL("../migrations/0029_activity_registration_forms.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0031_activity_registration_window.sql", import.meta.url), "utf8"));
  const queries = [];
  const db = { prepare(sql) {
    queries.push(sql);
    return { bind(...args) {
      return {
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; }
      };
    }, async all() { return { results: sqlite.prepare(sql).all() }; } };
  } };
  let aiCalls = 0;
  const deps = {
    async requireAdmin({ sessionToken }) { return { ok: sessionToken === "test-admin", user: { id: "test-admin", role: "admin" } }; },
    async verifyLine(_env, token) { return ["test-member", "another-member", "line-admin"].includes(token) ? { lineUserId: token, displayName: "測試 LINE 名稱" } : null; },
    async findAdmin(_db, uid) { return uid === "line-admin" ? { active: 1, allowed_modules: "activity-checkin" } : null; },
    async callAi() { aiCalls++; return { ...structuredClone(familyForm), warnings: ["請確認年齡分組。"] }; }
  };
  const env = { DB: db, OPENAI_API_KEY: "synthetic-not-a-credential" };
  const request = (path, data, token = "test-admin", extra = {}) => new Request("https://activity.test" + path, {
    method: data ? "POST" : "GET", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...extra },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  const call = (path, data, token, extra) => handleActivityFormRequest(request(path, data, token, extra), env, deps);
  const save = (overrides = {}) => call("/admin-api/activity-form", { action: "save", event_id: "event-1", revision: 0, schema: familyForm, confirmed: true, ...overrides });
  return { sqlite, env, deps, db, call, save, request, queries, get aiCalls() { return aiCalls; } };
}

test("approved legacy reset replaces only registration test data and supports new submissions", async () => {
  const f = fixture({ legacy: true });
  try {
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM welfare_activity_registrations").get().n, 0);
    const columns = f.sqlite.prepare("PRAGMA table_info(welfare_activity_registrations)").all().map(row => row.name);
    for (const column of ["form_revision", "schema_json", "answers_json", "created_at"]) assert.ok(columns.includes(column));
    assert.ok(!columns.includes("lottery_ticket"));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM welfare_activity_events").get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT bind_status FROM welfare_members").get().bind_status, "bound");
    assert.equal(f.sqlite.prepare("SELECT value FROM unrelated_records").get().value, "unchanged");
    assert.equal((await f.save()).status, 200);
    const data = { event_id: "event-1", revision: 1, answers: validAnswers };
    assert.equal((await f.call("/api/activity-registration", data, "test-member")).status, 200);
    assert.equal((await f.call("/api/activity-registration", data, "test-member")).status, 200);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM welfare_activity_registrations").get().n, 1);
  } finally { f.sqlite.close(); }
});

test("normalization preserves source and all supported field definitions", () => {
  const before = structuredClone(familyForm), normalized = normalizeActivityForm(familyForm);
  assert.deepEqual(familyForm, before); assert.equal(normalized.fields.length, 11); assert.equal(normalized.version, 1);
});
test("valid answers preserve employee leading zeros and strip hidden/unknown input", () => {
  const input = { ...validAnswers, song: "hidden", unexpected: "discard" };
  assert.deepEqual(validateActivityAnswers(familyForm, input), validAnswers); assert.equal(input.song, "hidden");
});
for (const [label, overrides] of [
  ["required", { department: "" }], ["phone", { phone: "garbage" }], ["negative", { children: -1 }],
  ["fraction", { total: 1.5 }], ["sum", { total: 2 }], ["maximum", { gifts: 4 }],
  ["selection", { performance: "other" }], ["conditional required", { performance: "是" }], ["boolean count", { total: true }]
]) test("rejects " + label, () => assert.throws(() => validateActivityAnswers(familyForm, { ...validAnswers, ...overrides })));
test("conditional textarea is accepted when visible", () => assert.equal(validateActivityAnswers(familyForm, { ...validAnswers, performance: "是", song: "測試曲目\n測試歌手" }).song, "測試曲目\n測試歌手"));
test("unsafe keys, duplicate keys and unsupported field types fail", () => {
  for (const schema of [{ fields: [{ id: "__proto__", type: "text", label: "bad" }] }, { fields: [familyForm.fields[0], familyForm.fields[0]] }, { fields: [{ id: "x", type: "html", label: "bad" }] }]) assert.throws(() => normalizeActivityForm(schema));
});
test("invalid ordering and rule references fail", () => {
  const form = structuredClone(familyForm); form.fields.reverse(); assert.throws(() => normalizeActivityForm(form));
  assert.throws(() => normalizeActivityForm({ ...familyForm, rules: [{ type: "sum", target: "total", fields: ["phone"], message: "bad" }] }));
});
test("field identifiers must be strings, not coercible arrays", () => {
  assert.throws(() => normalizeActivityForm({ fields: [{ id: ["name"], label: "姓名", type: "text" }] }));
});
test("multiselect rejects unknown options and duplicates", () => {
  const schema = { fields: [{ id: "food", type: "multiselect", label: "餐點", options: ["A", "B"], required: true }] };
  assert.deepEqual(validateActivityAnswers(schema, { food: ["A"] }), { food: ["A"] });
  for (const food of [[], ["C"], ["A", "A"]]) assert.throws(() => validateActivityAnswers(schema, { food }));
});
test("AI uses only requirements and bounded non-stored generation", async () => {
  let captured;
  const result = await generateActivityForm({ OPENAI_API_KEY: "synthetic" }, "部門、姓名", async (_env, messages, options) => {
    captured = { messages, options }; return { ...familyForm, warnings: ["年齡重疊"] };
  });
  assert.equal(captured.messages.length, 2); assert.equal(captured.messages[1].content, "部門、姓名");
  assert.equal(captured.options.store, false); assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(captured.options.maxOutputTokens, 6000); assert.deepEqual(result.warnings, ["年齡重疊"]);
});
test("missing key and empty AI schema fail without silently inventing fields", async () => {
  await assert.rejects(generateActivityForm({}, "姓名", () => assert.fail("AI must not run")));
  await assert.rejects(generateActivityForm({ OPENAI_API_KEY: "synthetic" }, "姓名", async () => ({ fields: [] })));
});
test("non-admin is denied before management queries, AI or writes", async () => {
  const f = fixture(); const response = await f.call("/admin-api/activity-form", { action: "generate", event_id: "event-1", requirements: "姓名" }, "test-member");
  assert.equal(response.status, 403); assert.equal(f.aiCalls, 0); assert.deepEqual(f.queries, []); f.sqlite.close();
});
test("invalid JSON shape and oversized requests do not write or call AI", async () => {
  const f = fixture();
  for (const body of ["null", "[]", "broken-json", JSON.stringify({ requirements: "x".repeat(66000) })]) {
    const request = new Request("https://activity.test/admin-api/activity-form", { method: "POST", headers: { Authorization: "Bearer test-admin" }, body });
    assert.equal((await handleActivityFormRequest(request, f.env, f.deps)).status, 400);
  }
  assert.equal(f.aiCalls, 0); assert.deepEqual(f.queries, []); f.sqlite.close();
});
test("admin generation is read-only and malformed or failed AI remains safe", async () => {
  const f = fixture(); const data = { action: "generate", event_id: "event-1", requirements: "姓名" };
  assert.equal((await f.call("/admin-api/activity-form", data)).status, 200);
  assert.equal(f.aiCalls, 1); assert.ok(f.queries.every(q => /^SELECT/i.test(q)));
  f.deps.callAi = async () => { throw new Error("sensitive-provider-detail"); };
  const failed = await f.call("/admin-api/activity-form", data); assert.equal(failed.status, 502); assert.doesNotMatch(await failed.text(), /sensitive-provider/); f.sqlite.close();
});
test("verified whitelist requires the activity module", async () => {
  const f = fixture();
  assert.equal((await f.call("/admin-api/activity-form?event_id=event-1", null, "", { "X-Line-Id-Token": "line-admin" })).status, 200);
  f.deps.findAdmin = async () => ({ active: 1, allowed_modules: "vendor" });
  assert.equal((await f.call("/admin-api/activity-form?event_id=event-1", null, "", { "X-Line-Id-Token": "line-admin" })).status, 403); f.sqlite.close();
});
test("empty whitelist module scope retains the existing full-access rule", async () => {
  const f = fixture(); f.deps.findAdmin = async () => ({ active: 1, allowed_modules: "" });
  assert.equal((await f.call("/admin-api/activity-form?event_id=event-1", null, "", { "X-Line-Id-Token": "line-admin" })).status, 200); f.sqlite.close();
});
test("save requires confirmation, writes versioned schema and rejects stale saves", async () => {
  const f = fixture(); assert.equal((await f.save({ confirmed: false })).status, 400);
  assert.equal((await f.save()).status, 200); assert.equal((await f.save()).status, 409);
  const row = f.sqlite.prepare("SELECT * FROM welfare_activity_forms").get();
  assert.equal(row.created_by, "admin:test-admin"); assert.equal(row.revision, 1);
  assert.equal((await (await f.call("/admin-api/activity-form?event_id=event-1")).json()).schema.fields.length, 11); f.sqlite.close();
});
test("concurrent form saves create only one revision", async () => {
  const f = fixture(); const results = await Promise.all([f.save(), f.save()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); f.sqlite.close();
});
test("registration trusts verified token, not user-submitted UID", async () => {
  const f = fixture(); await f.save();
  const data = { event_id: "event-1", revision: 1, answers: validAnswers, line_user_id: "test-member" };
  assert.equal((await f.call("/api/activity-registration", data, "invalid")).status, 403);
  assert.equal((await f.call("/api/activity-registration", data, "another-member")).status, 403);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations").get().n, 0); f.sqlite.close();
});
test("schema revision and answer validation occur server-side", async () => {
  const f = fixture(); await f.save();
  const submit = data => f.call("/api/activity-registration", { event_id: "event-1", revision: 1, answers: validAnswers, ...data }, "test-member");
  assert.equal((await submit({ revision: 0 })).status, 409);
  assert.equal((await submit({ answers: { ...validAnswers, total: 5 } })).status, 400);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations").get().n, 0); f.sqlite.close();
});
test("registration is idempotent and retains historical schema and answers", async () => {
  const f = fixture(); await f.save();
  const data = { event_id: "event-1", revision: 1, answers: validAnswers };
  const results = await Promise.all([f.call("/api/activity-registration", data, "test-member"), f.call("/api/activity-registration", data, "test-member")]);
  assert.ok(results.every(r => r.status === 200));
  await f.save({ revision: 1, schema: { fields: [{ id: "new_field", label: "新欄位", type: "text" }] } });
  const own = await (await f.call("/api/activity-registration?event_id=event-1", null, "test-member")).json();
  assert.equal(own.registration.form_revision, 1); assert.equal(own.registration.answers.employee_no, "0001");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations").get().n, 1);
  assert.ok(f.queries.every(q => !/\b(UPDATE|DELETE|CREATE|ALTER)\b/i.test(q)));
  assert.ok(f.queries.every(q => !/points|redemption/i.test(q)));
  assert.ok(f.queries.filter(q=>/checkins/i.test(q)).every(q=>/^\s*SELECT/i.test(q)), 'Editing eligibility may read attendance but cannot write it'); f.sqlite.close();
});
test("admin reads registrations while other participants cannot", async () => {
  const f = fixture(); await f.save(); await f.call("/api/activity-registration", { event_id: "event-1", revision: 1, answers: validAnswers }, "test-member");
  const admin = await (await f.call("/admin-api/activity-form?event_id=event-1")).json(); assert.equal(admin.registration_count, 1);
  const denied = await f.call("/admin-api/activity-form?event_id=event-1", null, "test-member"); assert.equal(denied.status, 403);
  assert.doesNotMatch(await denied.text(), /0900000000/); f.sqlite.close();
});
test("closed, expired and invalid-date events reject new registration", async () => {
  const f = fixture(); await f.save();
  for (const [status, end] of [["closed", "2099-09-04"], ["active", "2000-01-01 00:00:00"], ["active", "bad-date"]]) {
    f.sqlite.prepare("UPDATE welfare_activity_events SET status=?, end_at=?").run(status, end);
    assert.equal((await f.call("/api/activity-registration?event_id=event-1", null, "test-member")).status, 400);
  } f.sqlite.close();
});
test("audience uses synchronized binding rather than a claimed employee field", () => {
  assert.equal(canRegisterForActivity({ audience_scope: '["employee"]' }, { member_type: "employee", status: "active", bind_status: "unbound" }), false);
  assert.equal(canRegisterForActivity({ audience_scope: "broken" }, null), false);
});
test("unrelated routes pass through and D1 failure returns a safe error", async () => {
  const f = fixture(); assert.equal(await f.call("/line-webhook"), null); assert.deepEqual(f.queries, []);
  f.env.DB = { prepare() { throw new Error("private database detail"); } };
  const response = await f.call("/admin-api/activity-form?event_id=event-1"); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private/); f.sqlite.close();
});
test("generated inline scripts compile and existing admin markup stays intact", () => {
  const source = '<html><head></head><body><main><div id="existing-calendar"></div></main><script>function render(){} const state={events:[]};</script></body></html>';
  const decorated = decorateActivityAdminHtml(source); assert.match(decorated, /existing-calendar/);
  assert.match(decorated, /AI 生成欄位/); assert.match(decorated, /確認儲存報名欄位/);
  for (const html of [decorated, buildActivityRegistrationHtml()]) {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
  }
});

test("Worker route reuses existing LINE verification and OpenAI configuration", async t => {
  const f = fixture();
  f.sqlite.exec(`CREATE TABLE admin_uid_whitelist(id TEXT, line_user_id TEXT, display_name TEXT, role TEXT, allowed_modules TEXT, active INTEGER, note TEXT);
    INSERT INTO admin_uid_whitelist VALUES('admin-1','line-admin','測試管理員','admin','activity-calendar',1,'');`);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url === "https://api.line.me/oauth2/v2.1/verify") return Response.json({ sub: "line-admin", name: "測試管理員" });
    assert.equal(url, "https://api.openai.com/v1/responses");
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...familyForm, warnings: [] }) }] }] });
  });
  try {
    const response = await worker.fetch(f.request("/admin-api/activity-form", { action: "generate", event_id: "event-1", requirements: "姓名與人數" }, "", { "X-Line-Id-Token": "synthetic-line-token" }), f.env, {});
    assert.equal(response.status, 200);
    const request = calls.find(c => c.url === "https://api.openai.com/v1/responses").options;
    const body = JSON.parse(request.body);
    assert.equal(request.headers.Authorization, "Bearer " + f.env.OPENAI_API_KEY);
    assert.equal(body.store, false); assert.equal(body.max_output_tokens, 6000); assert.ok(request.signal instanceof AbortSignal);
    assert.equal(body.input[1].content[0].text, "姓名與人數");
    assert.doesNotMatch(request.body, /synthetic-line-token|test-member|0900000000/);
    assert.ok(f.queries.every(q => /^\s*SELECT/i.test(q)));
  } finally { f.sqlite.close(); }
});
