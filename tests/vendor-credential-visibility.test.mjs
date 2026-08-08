import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = process.env.SAKURA_INDEX_PATH || fileURLToPath(new URL("../src/index.js", import.meta.url));
const source = fs.readFileSync(sourcePath, "utf8");

test("vendor status query shows account and password setup state", () => {
  assert.match(source, /row\('店家登入帳號',v\.vendor_portal_username \|\| '尚未設定'\)/);
  assert.match(source, /row\('登入密碼',v\.vendor_portal_password_set \? '已設定（密碼不顯示）' : '尚未設定'\)/);
});

test("admin vendor detail shows username and a blank password reset field", () => {
  assert.match(source, /function portalPasswordInput\(v\)/);
  assert.match(source, /name=\\"vendor_portal_password\\" type=\\"password\\" autocomplete=\\"new-password\\"/);
  assert.match(source, /input\(\\"vendor_portal_username\\",\\"店家登入帳號\\",v\.vendor_portal_username\) \+ portalPasswordInput\(v\)/);
  assert.match(source, /原密碼不會顯示/);
});

test("application API still clears the stored password before responding", () => {
  assert.match(source, /vendor_portal_password: "",/);
  assert.match(source, /vendor_portal_password_set: Boolean\(vendor\.vendor_portal_password\)/);
});
