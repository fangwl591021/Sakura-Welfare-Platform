import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_SOURCES,
  IDENTITY_ROLES,
  createIdentity,
} from "../src/workspace/identity-router.js";

const anonymousIdentity = {
  userId: null,
  role: "anonymous",
  authenticated: false,
  lineBound: false,
  admin: false,
  vendorId: null,
  employeeId: null,
  authSource: "anonymous",
  locale: "zh-TW",
};

test("createIdentity returns the complete anonymous identity by default", () => {
  assert.deepEqual(createIdentity(), anonymousIdentity);
});

test("createIdentity allows every identity field to be overridden", () => {
  assert.deepEqual(
    createIdentity({
      userId: "U123",
      role: "admin",
      authenticated: true,
      lineBound: true,
      admin: true,
      vendorId: "vendor-1",
      employeeId: "employee-1",
      authSource: "admin_whitelist",
      locale: "id-ID",
    }),
    {
      userId: "U123",
      role: "admin",
      authenticated: true,
      lineBound: true,
      admin: true,
      vendorId: "vendor-1",
      employeeId: "employee-1",
      authSource: "admin_whitelist",
      locale: "id-ID",
    },
  );
});

test("createIdentity preserves defaults for fields not overridden", () => {
  assert.deepEqual(createIdentity({ role: "member", userId: "U456" }), {
    ...anonymousIdentity,
    userId: "U456",
    role: "member",
  });
});

test("createIdentity does not mutate the overrides object", () => {
  const overrides = { role: "vendor", vendorId: "vendor-2" };
  const snapshot = { ...overrides };

  createIdentity(overrides);

  assert.deepEqual(overrides, snapshot);
});

test("IDENTITY_ROLES contains all supported roles", () => {
  assert.deepEqual(
    new Set(Object.values(IDENTITY_ROLES)),
    new Set(["admin", "vendor", "member", "anonymous"]),
  );
});

test("AUTH_SOURCES contains all supported authentication sources", () => {
  assert.deepEqual(
    new Set(Object.values(AUTH_SOURCES)),
    new Set([
      "admin_whitelist",
      "vendor_line_binding",
      "vendor_session",
      "member_binding",
      "anonymous",
    ]),
  );
});
