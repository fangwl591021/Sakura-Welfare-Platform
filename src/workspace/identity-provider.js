export const IDENTITY_PROVIDER_NAMES = Object.freeze({
  ADMIN: "admin",
  VENDOR: "vendor",
  MEMBER: "member",
});

export const IDENTITY_PROVIDER_PRIORITIES = Object.freeze({
  ADMIN: 100,
  VENDOR: 200,
  MEMBER: 300,
});

export function createIdentityProvider({
  name,
  priority,
  resolve,
} = {}) {
  if (!name || typeof name !== "string") {
    throw new TypeError("Identity provider name is required.");
  }

  if (!Number.isFinite(priority)) {
    throw new TypeError("Identity provider priority must be a number.");
  }

  if (typeof resolve !== "function") {
    throw new TypeError("Identity provider resolve function is required.");
  }

  return Object.freeze({
    name,
    priority,

    async resolve(context = {}) {
      const result = await resolve(context);

      return result || null;
    },
  });
}

export function sortIdentityProviders(providers = []) {
  if (!Array.isArray(providers)) {
    return [];
  }

  return providers
    .filter(
      (provider) =>
        provider &&
        typeof provider === "object" &&
        Number.isFinite(provider.priority),
    )
    .sort((left, right) => left.priority - right.priority);
}

export async function resolveIdentityFromProviders({
  providers = [],
  context = {},
} = {}) {
  const orderedProviders = sortIdentityProviders(providers);

  for (const provider of orderedProviders) {
    if (!provider || typeof provider.resolve !== "function") {
      continue;
    }

    const identity = await provider.resolve(context);

    if (identity) {
      return {
        identity,
        provider: provider.name,
      };
    }
  }

  return {
    identity: null,
    provider: null,
  };
}
