import test from "node:test";
import assert from "node:assert/strict";

import { validateVendorPortalCredentialInput } from "../src/vendor-portal-credential-policy.js";

test("new vendor registration requires both login fields", () => {
  assert.equal(validateVendorPortalCredentialInput({}).success, false);
  assert.equal(validateVendorPortalCredentialInput({ username: "shop01" }).success, false);
  assert.equal(validateVendorPortalCredentialInput({ username: "shop01", password: "12345678" }).success, true);
});

test("vendor login field formats are validated", () => {
  assert.match(validateVendorPortalCredentialInput({ username: "abc", password: "12345678" }).message, /4 至 64/);
  assert.match(validateVendorPortalCredentialInput({ username: "shop user", password: "12345678" }).message, /不可包含空白/);
  assert.match(validateVendorPortalCredentialInput({ username: "shop01", password: "1234567" }).message, /8 至 128/);
});

test("existing vendor may keep the saved password without exposing it", () => {
  const result = validateVendorPortalCredentialInput({
    username: "shop01",
    password: "",
    existingUsername: "shop01",
    existingPassword: "stored-password",
  });
  assert.equal(result.success, true);
  assert.equal(result.password, "");
  assert.equal(result.passwordChanged, false);
});

test("existing login values are preserved when an authenticated edit omits them", () => {
  const result = validateVendorPortalCredentialInput({
    existingUsername: "shop01",
    existingPassword: "stored-password",
  });
  assert.equal(result.success, true);
  assert.equal(result.username, "shop01");
});
