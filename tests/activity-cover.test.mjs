import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fixture } from "./activity-form.test.mjs";
import { handleActivityFormRequest } from "../src/activity-form-service.js";

const { default: worker } = await import(process.env.ACTIVITY_WORKER_MODULE ? pathToFileURL(process.env.ACTIVITY_WORKER_MODULE).href : "../src/index.js");
export function coverFixture() {
  const f = fixture(), files = new Map();
  f.sqlite.exec(`ALTER TABLE welfare_activity_events ADD COLUMN cover_image_key TEXT DEFAULT '';
    ALTER TABLE welfare_activity_events ADD COLUMN qr_token TEXT DEFAULT 'original-qr';
    ALTER TABLE welfare_activity_events ADD COLUMN checkin_start_at TEXT DEFAULT '';
    ALTER TABLE welfare_activity_events ADD COLUMN checkin_end_at TEXT DEFAULT '';
    ALTER TABLE welfare_activity_events ADD COLUMN created_at TEXT DEFAULT '';
    ALTER TABLE welfare_activity_events ADD COLUMN updated_at TEXT DEFAULT '';
    CREATE TABLE admin_users(id TEXT PRIMARY KEY, username TEXT, display_name TEXT, role TEXT, business_units TEXT, active INTEGER,line_user_id TEXT DEFAULT '');
    INSERT INTO admin_users(id,username,display_name,role,business_units,active) VALUES('admin','test','test','admin','*',1);
    INSERT INTO admin_users(id,username,display_name,role,business_units,active) VALUES('member','test2','test2','employee','*',1);
    CREATE TABLE admin_sessions(token TEXT, user_id TEXT, expires_at TEXT);
    INSERT INTO admin_sessions VALUES('test-admin','admin','2099-01-01T00:00:00.000Z');
    INSERT INTO admin_sessions VALUES('test-employee','member','2099-01-01T00:00:00.000Z');`);
  f.env.DB = { prepare(sql) {
    f.queries.push(sql);
    const bound = (...args) => ({ first: async () => f.sqlite.prepare(sql).get(...args) || null,
      all: async () => ({ results: f.sqlite.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: Number(f.sqlite.prepare(sql).run(...args).changes) } }) });
    return { ...bound(), bind: bound };
  } };
  f.env.DB.batch = async statements => {
    f.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      f.sqlite.exec("COMMIT"); return results;
    } catch (error) { f.sqlite.exec("ROLLBACK"); throw error; }
  };
  f.env.R2_BUCKET = { async put(key, data, options) { files.set(key, { body: new Uint8Array(data), type: options.httpMetadata.contentType }); },
    async get(key) { const file = files.get(key); return file ? { body: file.body, httpEtag: '"test"', writeHttpMetadata(headers) { headers.set("Content-Type", file.type); } } : null; } };
  const call = request => handleActivityFormRequest(request, f.env, f.deps).then(result => result || worker.fetch(request, f.env, {}));
  const save = async (data, token = "test-admin") => (await call(new Request("https://activity.test/admin-api/activity-checkin", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ action: "save_event", data })
  }))).json();
  return { ...f, files, call, save };
}

test("activity save persists cover, keeps it on legacy edits, and supports explicit removal", async () => {
  const f = coverFixture();
  try {
    const key = "workspace/activity/test-cover.jpg", url = "https://activity.test/file/" + encodeURIComponent(key);
    const data = { id: "event-1", title: "Updated activity", cover_image_url: url, cover_image_key: key };
    assert.equal((await f.save(data)).success, true);
    let row = f.sqlite.prepare("SELECT * FROM welfare_activity_events WHERE id='event-1'").get();
    assert.equal(row.cover_image_url, url); assert.equal(row.cover_image_key, key); assert.equal(row.qr_token, "original-qr");
    assert.equal((await f.save({ id: "event-1", title: "Legacy title edit" })).success, true);
    row = f.sqlite.prepare("SELECT * FROM welfare_activity_events WHERE id='event-1'").get();
    assert.equal(row.cover_image_url, url);
    assert.equal((await f.save({ ...data, cover_image_url: "", cover_image_key: "" })).success, true);
    assert.equal(f.sqlite.prepare("SELECT cover_image_url FROM welfare_activity_events").get().cover_image_url, "");
  } finally { f.sqlite.close(); }
});

test("cover writes require admin and reject untrusted new URLs without changing activity", async () => {
  const f = coverFixture();
  try {
    for (const token of ["", "test-employee"]) {
      f.queries.length = 0;
      assert.equal((await f.save({ id: "event-1", title: "Do not save", cover_image_url: "", cover_image_key: "" }, token)).success, false);
      assert.ok(f.queries.every(sql => /^\s*SELECT/.test(sql)));
    }
    assert.equal((await f.save({ id: "event-1", title: "Do not save", cover_image_url: "https://untrusted.test/file.jpg", cover_image_key: "fake" })).success, false);
    assert.equal(f.sqlite.prepare("SELECT title FROM welfare_activity_events").get().title, "測試家庭日");
  } finally { f.sqlite.close(); }
});

test("unchanged pre-existing external cover survives authorized activity editing", async () => {
  const f = coverFixture();
  try {
    const url = "https://existing.test/poster.jpg";
    f.sqlite.prepare("UPDATE welfare_activity_events SET cover_image_url=?").run(url);
    assert.equal((await f.save({ id: "event-1", title: "Updated", cover_image_url: url, cover_image_key: "" })).success, true);
    assert.equal(f.sqlite.prepare("SELECT cover_image_url FROM welfare_activity_events").get().cover_image_url, url);
  } finally { f.sqlite.close(); }
});

test("existing image uploader rejects anonymous uploads and stores an authorized image", async () => {
  const f = coverFixture();
  try {
    const request = token => {
      const body = new FormData(); body.set("file", new File([new Uint8Array([255,216,255,217])], "test.jpg", { type: "image/jpeg" }));
      return new Request("https://activity.test/workspace-api/upload", { method: "POST", body, headers: { Authorization: "Bearer " + token } });
    };
    assert.equal((await (await f.call(request(""))).json()).success, false); assert.equal(f.files.size, 0);
    const result = await (await f.call(request("test-admin"))).json();
    assert.equal(result.success, true); assert.equal(f.files.size, 1);
    assert.match(result.data.coverImageKey, /^workspace\/activity\//);
    assert.equal((await f.call(new Request(result.data.coverImageUrl))).status, 200);
  } finally { f.sqlite.close(); }
});
