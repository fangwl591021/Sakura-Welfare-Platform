import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { coverFixture } from "./activity-cover.test.mjs";
import { handleActivityQrCheckin } from "../src/activity-qr-checkin-service.js";
import { readActivityAttendanceCandidate, commitActivityAttendance, registeredPartyCount, storedAttendanceCount } from "../src/activity-attendance-service.js";
import { checkinByActivityKeyword } from "../src/activity-keyword-checkin.js";
const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const extractSource = source.slice(source.indexOf("function extractLineUserIdFromQr("), source.indexOf("\nfunction ", source.indexOf("function extractLineUserIdFromQr(") + 10));
export const extractQr = vm.runInNewContext("(" + extractSource + ")", { URL });
export const QR_USER = "U" + "1".repeat(32);

export async function qrFixture() {
  const f = coverFixture();
  const saved = await f.save({ id: "event-1", title: "家庭日核銷示範", status: "active", audience_scope: ["employee"],
    checkin_start_at: "2020-01-01T00:00", checkin_end_at: "2099-12-31T23:59", checkin_keyword: "家庭日簽到" });
  assert.equal(saved.success, true);
  f.sqlite.prepare("INSERT INTO welfare_members(line_user_id,member_type,status,bind_status) VALUES(?,'employee','active','bound')").run(QR_USER);
  f.sqlite.prepare(`INSERT INTO welfare_activity_registrations(id,event_id,line_user_id,display_name,form_revision,schema_json,answers_json,created_at)
    VALUES('qr-registration','event-1',?,'示範員工',1,'{"fields":[],"rules":[]}','{}',datetime('now'))`).run(QR_USER);
  const request = (data, token = "test-admin", extra = {}) => new Request("https://activity.test/admin-api/activity-qr-checkin", { method: data ? "POST" : "GET", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...extra }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const call = (data, token, extra) => handleActivityQrCheckin(request(data, token, extra), f.env, { ...f.deps, extractLineUserIdFromQr: extractQr });
  const input = { action: "preview", event_id: "event-1", qr: "https://aiwe.cc/member?line_user_id=" + QR_USER };
  const confirm = { ...input, action: "confirm", confirmed: true, registration_id: "qr-registration" };
  const count = () => f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_checkins").get().n;
  return { ...f, qrCall: call, qrRequest: request, input, confirm, count };
}

test("QR workspace denies anonymous/member before data reads and writes", async () => {
  const f = await qrFixture(); try { for (const token of ["", "test-member"]) { f.queries.length = 0; const r = await f.qrCall(f.input, token); assert.equal(r.status, 403); assert.deepEqual(f.queries, []); assert.equal(f.count(), 0); } } finally { f.sqlite.close(); }
});
test("one open activity auto-selects; multiple require explicit selection; none stays empty", async () => {
  const f = await qrFixture(); try {
    let data = await (await f.qrCall()).json(); assert.equal(data.selected_event_id, "event-1"); assert.deepEqual(data.summary, { registered_count: 1, checkin_count: 0 });
    f.sqlite.exec(`INSERT INTO welfare_activity_events(id,title,status,audience_scope,checkin_start_at,checkin_end_at,qr_token) VALUES('event-2','另一活動','active','["all"]','2020-01-01','2099-01-01','qr-2')`);
    f.sqlite.exec("UPDATE welfare_activity_events SET checkin_start_at='2020-01-01T00:00',checkin_end_at='2099-01-01T00:00'");
    data = await (await f.qrCall()).json(); assert.equal(data.selected_event_id, ""); assert.equal(data.open_count, 2);
    f.sqlite.exec("UPDATE welfare_activity_events SET status='closed'"); data = await (await f.qrCall()).json(); assert.equal(data.selected_event_id, ""); assert.equal(data.open_count, 0);
  } finally { f.sqlite.close(); }
});
test("preview is SELECT only and redacts UID; confirmed attendance is audited and counted once", async () => {
  const f = await qrFixture(); try {
    f.queries.length = 0; const p = await (await f.qrCall(f.input)).json(); assert.equal(p.preview.display_name, "示範員工"); assert.ok(f.queries.every(sql => /^\s*SELECT/.test(sql))); assert.ok(!JSON.stringify(p).includes(QR_USER)); assert.equal(f.count(), 0);
    const result = await (await f.qrCall(f.confirm)).json(); assert.equal(result.code, "checked_in"); assert.equal(result.summary.checkin_count, 1);
    assert.equal((await (await f.qrCall(f.confirm)).json()).code, "already_checked_in"); assert.equal(f.count(), 1);
    const audit = JSON.parse(f.sqlite.prepare("SELECT raw_payload FROM welfare_activity_checkins").get().raw_payload);
    assert.deepEqual(audit, { source: "activity_admin_qr", actor: "admin:test-admin", registration_id: "qr-registration" });
    assert.ok(f.queries.every(sql => !/\b(UPDATE|DELETE)\b|points|redemptions/i.test(sql)));
  } finally { f.sqlite.close(); }
});
test("confirm requires explicit confirmation and same registration", async () => {
  const f = await qrFixture(); try { for (const data of [{ ...f.confirm, confirmed: false }, { ...f.confirm, registration_id: "wrong" }]) { assert.equal((await f.qrCall(data)).status, 409); assert.equal(f.count(), 0); } } finally { f.sqlite.close(); }
});
for (const [label, sql, code] of [
  ["not registered", "DELETE FROM welfare_activity_registrations", "not_registered"],
  ["not started", "UPDATE welfare_activity_events SET checkin_start_at='2098-01-01T00:00'", "not_started"],
  ["expired", "UPDATE welfare_activity_events SET checkin_end_at='2021-01-01T00:00'", "ended"],
  ["missing window", "UPDATE welfare_activity_events SET checkin_end_at=''", "invalid_window"],
  ["closed", "UPDATE welfare_activity_events SET status='closed'", "closed"],
  ["membership inactive", "UPDATE welfare_members SET status='inactive'", "denied"]
]) test("rejects " + label, async () => { const f = await qrFixture(); try { f.sqlite.exec(sql); assert.equal((await (await f.qrCall(f.input)).json()).code, code); assert.equal(f.count(), 0); } finally { f.sqlite.close(); } });
test("wrong event and activity/store/invalid QR never create attendance", async () => {
  const f = await qrFixture(); try { for (const qr of ["event-1", "https://activity.test/activity-checkin?event_id=event-1&token=original-qr", "U_test", "12345"]) assert.equal((await f.qrCall({ ...f.confirm, qr })).status, 400); assert.equal((await (await f.qrCall({ ...f.input, event_id: "other" })).json()).success, false); assert.equal(f.count(), 0); } finally { f.sqlite.close(); }
});
test("concurrent QR and keyword requests create a single attendance", async () => {
  const f = await qrFixture(); try {
    const rule = f.sqlite.prepare("SELECT * FROM line_keyword_rules WHERE id='activity-checkin:event-1'").get();
    const results = await Promise.all([f.qrCall(f.confirm), f.qrCall(f.confirm), checkinByActivityKeyword({ db: f.env.DB, rule, signatureVerified: true, item: { LINE_user_id: QR_USER, sourceType: "user", eventType: "message", messageType: "text", text: "家庭日簽到", eventId: "test-event" } })]);
    assert.equal(f.count(), 1); assert.ok(results.length === 3);
  } finally { f.sqlite.close(); }
});
for (const [label, sql] of [
  ["registration removed", "DELETE FROM welfare_activity_registrations"], ["membership revoked", "UPDATE welfare_members SET bind_status='unbound'"],
  ["activity closed", "UPDATE welfare_activity_events SET status='closed'"], ["window changed", "UPDATE welfare_activity_events SET checkin_end_at='2021-01-01T00:00'"]
]) test("atomic write rechecks " + label, async () => { const f = await qrFixture(); try { const p = await readActivityAttendanceCandidate(f.env.DB, "event-1", QR_USER); f.sqlite.exec(sql); assert.equal((await commitActivityAttendance(f.env.DB, p, { actor: "admin:synthetic", source: "test" })).success, false); assert.equal(f.count(), 0); } finally { f.sqlite.close(); } });
test("storage failure is safe and does not leak QR/token", async () => { const f = await qrFixture(); try { f.env.DB = { prepare() { throw new Error("secret internal text"); } }; const r = await f.qrCall(f.input); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /secret|internal/); } finally { f.sqlite.close(); } });

test("summary read failure after commit preserves successful attendance result", async () => {
  const f = await qrFixture();
  try {
    const db = f.env.DB;
    f.env.DB = { prepare(sql) { if (sql.includes("AS registered_count")) throw new Error("summary unavailable"); return db.prepare(sql); } };
    const result = await (await f.qrCall(f.confirm)).json();
    assert.equal(result.success, true); assert.equal(result.code, "checked_in"); assert.equal(result.summary, null); assert.equal(f.count(), 1);
  } finally { f.sqlite.close(); }
});

test("malformed and oversized QR requests cannot write attendance", async () => {
  const f = await qrFixture();
  try {
    for (const body of [{ ...f.confirm, qr: "x".repeat(9000) }, { ...f.confirm, event_id: ["event-1"] }, { ...f.confirm, action: "delete" }]) {
      assert.equal((await f.qrCall(body)).status, 400); assert.equal(f.count(), 0);
    }
  } finally { f.sqlite.close(); }
});
test("legacy QR rejects claimed UID and requires verified LINE plus registration", async () => {
  const match = source.slice(source.indexOf("async function submitActivityCheckin("), source.indexOf("function buildActivityCheckinAdminHtml("));
  let identity = null;
  const submit = vm.runInNewContext("(" + match.trim() + ")", { verifyActivityLineIdentity: async () => identity, readActivityAttendanceCandidate, commitActivityAttendance, registeredPartyCount, storedAttendanceCount,
    ensureEmployeeBindingOnAccess: async () => ({ state: 'bound' }), handleEmployeeBindingPullMother: async () => ({}) });
  const f = await qrFixture(); const request = () => new Request("https://activity.test/api/activity-checkin", { method: "POST", body: JSON.stringify({ event_id: "event-1", token: "original-qr", line_user_id: QR_USER }) });
  try {
    assert.equal((await submit(request(), f.env.DB, {})).success, false); assert.equal(f.count(), 0);
    identity = { lineUserId: QR_USER }; assert.equal((await submit(request(), f.env.DB, {})).code, "checked_in"); assert.equal(f.count(), 1);
    f.sqlite.exec("DELETE FROM welfare_activity_checkins; DELETE FROM welfare_activity_registrations"); assert.equal((await submit(request(), f.env.DB, {})).code, "not_registered"); assert.equal(f.count(), 0);
  } finally { f.sqlite.close(); }
});
test("legacy management GET and POST now require admin", async () => {
  const f = await qrFixture(); try { for (const method of ["GET", "POST"]) { const r = await f.call(new Request("https://activity.test/admin-api/activity-checkin", { method, ...(method === "POST" ? { body: JSON.stringify({ action: "delete_event", data: { id: "event-1" } }) } : {}) })); assert.equal(r.status, 403); } assert.equal(f.sqlite.prepare("SELECT status FROM welfare_activity_events").get().status, "active"); } finally { f.sqlite.close(); }
});
