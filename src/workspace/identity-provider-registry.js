import { createAdminIdentityProvider } from "./admin-identity-provider.js";
import { createVendorLineIdentityProvider } from "./vendor-line-identity-provider.js";
import { createVendorTokenIdentityProvider } from "./vendor-token-identity-provider.js";
import { resolveIdentityFromProviders } from "./identity-provider.js";

export function createDefaultIdentityProviders({
  verifyVendorToken,
} = {}) {
  const providers = [
    createAdminIdentityProvider(),
    createVendorLineIdentityProvider(),
  ];

  if (typeof verifyVendorToken === "function") {
    providers.push(
      createVendorTokenIdentityProvider({
        verifyToken: verifyVendorToken,
      }),
    );
  }

  return providers;
}

export async function resolveWorkspaceIdentity({
  providers,
  context = {},
  verifyVendorToken,
} = {}) {
  const resolvedProviders =
    providers ||
    createDefaultIdentityProviders({
      verifyVendorToken,
    });

  return resolveIdentityFromProviders({
    providers: resolvedProviders,
    context,
  });
}
