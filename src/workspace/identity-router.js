import { findAdminUidWhitelistRowReadOnly } from "./admin-whitelist-reader.js";

export const IDENTITY_ROLES = Object.freeze({
  ADMIN: "admin",
  VENDOR: "vendor",
  MEMBER: "member",
  ANONYMOUS: "anonymous",
});

export const AUTH_SOURCES = Object.freeze({
  ADMIN_WHITELIST: "admin_whitelist",
  VENDOR_LINE_BINDING: "vendor_line_binding",
  VENDOR_SESSION: "vendor_session",
  MEMBER_BINDING: "member_binding",
  ANONYMOUS: "anonymous",
});

const DEFAULT_IDENTITY = Object.freeze({
  userId: null,
  role: IDENTITY_ROLES.ANONYMOUS,
  authenticated: false,
  lineBound: false,
  admin: false,
  vendorId: null,
  employeeId: null,
  authSource: AUTH_SOURCES.ANONYMOUS,
  locale: "zh-TW",
});

export function createIdentity(overrides = {}) {
  const values =
    overrides !== null && typeof overrides === "object"
      ? { ...DEFAULT_IDENTITY, ...overrides }
      : { ...DEFAULT_IDENTITY };

  return {
    userId: values.userId,
    role: values.role,
    authenticated: values.authenticated,
    lineBound: values.lineBound,
    admin: values.admin,
    vendorId: values.vendorId,
    employeeId: values.employeeId,
    authSource: values.authSource,
    locale: values.locale,
  };
}

export async function resolveAdminIdentity({
  db,
  userId,
  baseIdentity,
} = {}) {
  const identity = createIdentity(baseIdentity);

  if (!userId) {
    return identity;
  }

  const adminRow = await findAdminUidWhitelistRowReadOnly(db, userId);

  if (!adminRow) {
    return identity;
  }

  return createIdentity({
    ...identity,
    userId,
    role: IDENTITY_ROLES.ADMIN,
    authenticated: true,
    lineBound: true,
    admin: true,
    authSource: AUTH_SOURCES.ADMIN_WHITELIST,
  });
}
