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

export function createVendorTokenIdentityProvider({
  verifyToken,
} = {}) {
  if (typeof verifyToken !== "function") {
    throw new TypeError(
      "Vendor token provider verifyToken function is required.",
    );
  }

  return createIdentityProvider({
    name: IDENTITY_PROVIDER_NAMES.VENDOR,
    priority: IDENTITY_PROVIDER_PRIORITIES.VENDOR,

    async resolve(context = {}) {
      const token = String(
        context.portalToken ||
          context.portal_token ||
          context.vendorPortalToken ||
          "",
      ).trim();

      if (!token) {
        return null;
      }

      const payload = await verifyToken(context.env, token);

      if (!payload?.vendor_id || !payload?.username) {
        return null;
      }

      return createIdentity({
        ...context.baseIdentity,
        userId: context.userId || null,
        role: IDENTITY_ROLES.VENDOR,
        authenticated: true,
        lineBound: Boolean(context.userId),
        admin: false,
        vendorId: String(payload.vendor_id),
        authSource: AUTH_SOURCES.VENDOR_SESSION,
      });
    },
  });
}
