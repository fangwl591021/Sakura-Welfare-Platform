import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_RESULT_TYPES,
  AGENT_STATUS,
  createAgentResult,
} from "../src/workspace/agent/agent-types.js";

import {
  createAgentRegistry,
} from "../src/workspace/agent/agent-registry.js";

import {
  createAgentRuntime,
} from "../src/workspace/agent/agent-runtime.js";

function createMemorySessionStore() {
  const sessions = new Map();
  const calls = {
    ensure: 0,
    get: 0,
    save: 0,
    clear: 0,
  };

  return {
    calls,

    async ensureSessionTable() {
      calls.ensure += 1;
      return true;
    },

    async getSession(db, lineUserId) {
      calls.get += 1;
      return sessions.get(lineUserId) || null;
    },

    async saveSession(db, session) {
      calls.save += 1;

      sessions.set(session.lineUserId, {
        lineUserId: session.lineUserId,
        agent: session.agent,
        step: session.step,
        status: session.status,
        payload: session.payload,
      });

      return true;
    },

    async clearSession(db, lineUserId) {
      calls.clear += 1;
      sessions.delete(lineUserId);
      return true;
    },

    read(lineUserId) {
      return sessions.get(lineUserId) || null;
    },
  };
}

function createTestAgent() {
  return {
    name: "activity",

    async start() {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.CONTINUE,
        step: "activity_name",
        text: "請輸入活動名稱。",
      });
    },

    async resume({ input, session }) {
      if (session.step === "activity_name") {
        return createAgentResult({
          type: AGENT_RESULT_TYPES.CONFIRM,
          step: "confirm",
          payload: {
            title: String(input || "").trim(),
          },
          text: "請確認活動資料。",
        });
      }

      return createAgentResult({
        type: AGENT_RESULT_TYPES.COMPLETE,
        status: AGENT_STATUS.COMPLETED,
        text: "活動建立完成。",
      });
    },
  };
}

test("agent result validates result type", () => {
  assert.throws(
    () => createAgentResult({
      type: "unknown",
    }),
    /Invalid agent result type/,
  );
});

test("registry registers and resolves agents", () => {
  const registry = createAgentRegistry();
  const agent = createTestAgent();

  registry.register(agent);

  assert.equal(registry.has("activity"), true);
  assert.equal(registry.get("ACTIVITY").name, "activity");
  assert.equal(registry.list().length, 1);
});

test("registry rejects duplicate agents", () => {
  const registry = createAgentRegistry([
    createTestAgent(),
  ]);

  assert.throws(
    () => registry.register(createTestAgent()),
    /already registered/,
  );
});

test("registry requires start and resume", () => {
  const registry = createAgentRegistry();

  assert.throws(
    () => registry.register({
      name: "invalid",
      resume() {},
    }),
    /start/,
  );

  assert.throws(
    () => registry.register({
      name: "invalid",
      start() {},
    }),
    /resume/,
  );
});

test("runtime starts agent and persists session", async () => {
  const store = createMemorySessionStore();

  const registry = createAgentRegistry([
    createTestAgent(),
  ]);

  const runtime = createAgentRuntime({
    registry,
    ensureSessionTable:
      store.ensureSessionTable,
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  const result = await runtime.start({
    db: {},
    lineUserId: " U_ADMIN ",
    agentName: "activity",
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.CONTINUE,
  );

  assert.equal(
    result.step,
    "activity_name",
  );

  const session = store.read("U_ADMIN");

  assert.equal(session.agent, "activity");
  assert.equal(session.step, "activity_name");
  assert.equal(
    session.status,
    AGENT_STATUS.RUNNING,
  );
});

test("runtime clears existing session before start", async () => {
  const store = createMemorySessionStore();

  await store.saveSession(null, {
    lineUserId: "U_ADMIN",
    agent: "push",
    step: "message",
    status: "running",
    payload: {},
  });

  const registry = createAgentRegistry([
    createTestAgent(),
  ]);

  const runtime = createAgentRuntime({
    registry,
    ensureSessionTable:
      store.ensureSessionTable,
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  await runtime.start({
    db: {},
    lineUserId: "U_ADMIN",
    agentName: "activity",
  });

  assert.equal(
    store.read("U_ADMIN").agent,
    "activity",
  );

  assert.equal(store.calls.clear, 1);
});

test("runtime resumes and merges payload", async () => {
  const store = createMemorySessionStore();

  const registry = createAgentRegistry([
    createTestAgent(),
  ]);

  const runtime = createAgentRuntime({
    registry,
    ensureSessionTable:
      store.ensureSessionTable,
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  await runtime.start({
    db: {},
    lineUserId: "U_ADMIN",
    agentName: "activity",
  });

  const result = await runtime.resume({
    db: {},
    lineUserId: "U_ADMIN",
    input: "春酒活動",
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.CONFIRM,
  );

  const session = store.read("U_ADMIN");

  assert.equal(session.step, "confirm");
  assert.equal(session.payload.title, "春酒活動");
  assert.equal(
    session.status,
    AGENT_STATUS.CONFIRMING,
  );
});

test("terminal result clears session", async () => {
  const store = createMemorySessionStore();

  const registry = createAgentRegistry([
    createTestAgent(),
  ]);

  const runtime = createAgentRuntime({
    registry,
    ensureSessionTable:
      store.ensureSessionTable,
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  await runtime.start({
    db: {},
    lineUserId: "U_ADMIN",
    agentName: "activity",
  });

  await runtime.resume({
    db: {},
    lineUserId: "U_ADMIN",
    input: "春酒活動",
  });

  const result = await runtime.resume({
    db: {},
    lineUserId: "U_ADMIN",
    input: "確認",
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.COMPLETE,
  );

  assert.equal(
    store.read("U_ADMIN"),
    null,
  );
});

test("runtime cancel clears session", async () => {
  const store = createMemorySessionStore();

  await store.saveSession(null, {
    lineUserId: "U_ADMIN",
    agent: "activity",
    step: "activity_name",
    status: "running",
    payload: {},
  });

  const runtime = createAgentRuntime({
    registry: createAgentRegistry([
      createTestAgent(),
    ]),
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  const result = await runtime.cancel({
    db: {},
    lineUserId: "U_ADMIN",
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.CANCEL,
  );

  assert.equal(
    store.read("U_ADMIN"),
    null,
  );
});

test("runtime reports missing session safely", async () => {
  const store = createMemorySessionStore();

  const runtime = createAgentRuntime({
    registry: createAgentRegistry([
      createTestAgent(),
    ]),
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  const result = await runtime.resume({
    db: {},
    lineUserId: "U_ADMIN",
    input: "內容",
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.ERROR,
  );

  assert.match(
    result.text,
    /沒有進行中的工作流程/,
  );
});

test("runtime reports unknown agents safely", async () => {
  const store = createMemorySessionStore();

  const runtime = createAgentRuntime({
    registry: createAgentRegistry(),
    getSession: store.getSession,
    saveSession: store.saveSession,
    clearSession: store.clearSession,
  });

  const result = await runtime.start({
    db: {},
    lineUserId: "U_ADMIN",
    agentName: "unknown",
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.ERROR,
  );

  assert.match(
    result.text,
    /找不到指定的工作助理/,
  );
});
