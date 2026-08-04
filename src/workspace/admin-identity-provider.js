import {
  IDENTITY_PROVIDER_NAMES,
  IDENTITY_PROVIDER_PRIORITIES,
  createIdentityProvider,
} from "./identity-provider.js";

import { resolveAdminIdentity } from "./identity-router.js";

export function createAdminIdentityProvider() {
  return createIdentityProvider({
    name: IDENTITY_PROVIDER_NAMES.ADMIN,
    priority: IDENTITY_PROVIDER_PRIORITIES.ADMIN,

    async resolve(context = {}) {
      const identity = await resolveAdminIdentity({
        db: context.db,
        userId: context.userId,
        baseIdentity: context.baseIdentity,
      });

      return identity.admin ? identity : null;
    },
  });
}
