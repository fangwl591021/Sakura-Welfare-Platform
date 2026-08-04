import { createAdminIdentityProvider } from "./admin-identity-provider.js";
import { resolveIdentityFromProviders } from "./identity-provider.js";

export function createDefaultIdentityProviders() {
  return [
    createAdminIdentityProvider(),
  ];
}

export async function resolveWorkspaceIdentity({
  providers = createDefaultIdentityProviders(),
  context = {},
} = {}) {
  return resolveIdentityFromProviders({
    providers,
    context,
  });
}
