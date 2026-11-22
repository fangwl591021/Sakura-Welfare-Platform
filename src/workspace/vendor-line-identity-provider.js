import {
  IDENTITY_PROVIDER_NAMES,
  IDENTITY_PROVIDER_PRIORITIES,
  createIdentityProvider,
} from "./identity-provider.js";

import {
  AUTH_SOURCES,
  IDENTITY_ROLES,
  createIdentity,
} from "./identity-router.js";

import { findVendorByLineUserIdReadOnly } from "./vendor-line-reader.js";

export function createVendorLineIdentityProvider() {
  return createIdentityProvider({
    name: IDENTITY_PROVIDER_NAMES.VENDOR,
    priority: IDENTITY_PROVIDER_PRIORITIES.VENDOR,

    async resolve(context = {}) {
      const userId = String(context.userId || "").trim();

      if (!userId) {
        return null;
      }

      const vendor = await findVendorByLineUserIdReadOnly(
        context.db,
        userId,
      );

      if (!vendor?.id) {
        return null;
      }

      return createIdentity({
        ...context.baseIdentity,
        userId,
        role: IDENTITY_ROLES.VENDOR,
        authenticated: true,
        lineBound: true,
        admin: false,
        vendorId: String(vendor.id),
        authSource: AUTH_SOURCES.VENDOR_LINE_BINDING,
      });
    },
  });
}
