import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_PROVIDER_NAMES,
  IDENTITY_PROVIDER_PRIORITIES,
  createIdentityProvider,
  sortIdentityProviders,
  resolveIdentityFromProviders,
} from "../src/workspace/identity-provider.js";

test("provider names are defined", () => {
  assert.deepEqual(IDENTITY_PROVIDER_NAMES, {
    ADMIN: "admin",
    VENDOR: "vendor",
    MEMBER: "member",
  });
});

test("provider priorities are defined", () => {
  assert.deepEqual(IDENTITY_PROVIDER_PRIORITIES, {
    ADMIN: 100,
    VENDOR: 200,
    MEMBER: 300,
  });
});

test("createIdentityProvider requires a name", () => {
  assert.throws(
    () =>
      createIdentityProvider({
        priority: 100,
        resolve: async () => null,
      }),
    /name is required/i,
  );
});

test("createIdentityProvider requires a numeric priority", () => {
  assert.throws(
    () =>
      createIdentityProvider({
        name: "admin",
        priority: "100",
        resolve: async () => null,
      }),
    /priority must be a number/i,
  );
});

test("createIdentityProvider requires a resolve function", () => {
  assert.throws(
    () =>
      createIdentityProvider({
        name: "admin",
        priority: 100,
      }),
    /resolve function is required/i,
  );
});

test("provider resolve returns identity when matched", async () => {
  const identity = {
    role: "admin",
  };

  const provider = createIdentityProvider({
    name: "admin",
    priority: 100,
    resolve: async () => identity,
  });

  assert.strictEqual(await provider.resolve({}), identity);
});

test("provider resolve normalizes falsy result to null", async () => {
  const provider = createIdentityProvider({
    name: "admin",
    priority: 100,
    resolve: async () => undefined,
  });

  assert.equal(await provider.resolve({}), null);
});

test("sortIdentityProviders sorts by ascending priority without mutating input", () => {
  const providers = [
    { name: "member", priority: 300 },
    { name: "admin", priority: 100 },
    { name: "vendor", priority: 200 },
  ];

  const snapshot = [...providers];
  const result = sortIdentityProviders(providers);

  assert.deepEqual(
    result.map((provider) => provider.name),
    ["admin", "vendor", "member"],
  );
  assert.deepEqual(providers, snapshot);
});

test("resolveIdentityFromProviders returns first matched identity", async () => {
  const calls = [];

  const providers = [
    createIdentityProvider({
      name: "member",
      priority: 300,
      resolve: async () => {
        calls.push("member");
        return { role: "member" };
      },
    }),
    createIdentityProvider({
      name: "admin",
      priority: 100,
      resolve: async () => {
        calls.push("admin");
        return null;
      },
    }),
    createIdentityProvider({
      name: "vendor",
      priority: 200,
      resolve: async () => {
        calls.push("vendor");
        return { role: "vendor" };
      },
    }),
  ];

  const result = await resolveIdentityFromProviders({
    providers,
    context: { userId: "U123" },
  });

  assert.deepEqual(result, {
    identity: { role: "vendor" },
    provider: "vendor",
  });
  assert.deepEqual(calls, ["admin", "vendor"]);
});

test("resolveIdentityFromProviders returns null result when none match", async () => {
  const providers = [
    createIdentityProvider({
      name: "admin",
      priority: 100,
      resolve: async () => null,
    }),
    createIdentityProvider({
      name: "vendor",
      priority: 200,
      resolve: async () => null,
    }),
  ];

  const result = await resolveIdentityFromProviders({
    providers,
  });

  assert.deepEqual(result, {
    identity: null,
    provider: null,
  });
});

test("resolveIdentityFromProviders skips invalid provider entries", async () => {
  const validProvider = createIdentityProvider({
    name: "member",
    priority: 300,
    resolve: async () => ({ role: "member" }),
  });

  const result = await resolveIdentityFromProviders({
    providers: [null, {}, validProvider],
  });

  assert.deepEqual(result, {
    identity: { role: "member" },
    provider: "member",
  });
});
