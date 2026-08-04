import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureWorkspaceAgentSessionTable,
  getWorkspaceAgentSession,
  saveWorkspaceAgentSession,
  clearWorkspaceAgentSession,
} from "../src/workspace/workspace-agent-session.js";

function createMockDb({
  firstRow = null,
  error = null,
} = {}) {
  const calls = [];

  const db = {
    prepare(sql) {
      const call = {
        sql,
        bindArgs: [],
        runCalled: false,
        firstCalled: false,
      };

      calls.push(call);

      return {
        bind(...args) {
          call.bindArgs = args;
          return this;
        },

        async run() {
          call.runCalled = true;

          if (error) {
            throw error;
          }

          return {
            success: true,
          };
        },

        async first() {
          call.firstCalled = true;

          if (error) {
            throw error;
          }

          return firstRow;
        },
      };
    },
  };

  return {
    db,
    calls,
  };
}

test("ensure creates workspace agent session table", async () => {
  const { db, calls } = createMockDb();

  const result =
    await ensureWorkspaceAgentSessionTable(db);

  assert.equal(result, true);
  assert.match(
    calls[0].sql,
    /CREATE TABLE IF NOT EXISTS workspace_agent_sessions/i,
  );
  assert.equal(calls[0].runCalled, true);
});

test("missing db returns safe results", async () => {
  assert.equal(
    await ensureWorkspaceAgentSessionTable(null),
    false,
  );

  assert.equal(
    await getWorkspaceAgentSession(null, "U1"),
    null,
  );

  assert.equal(
    await saveWorkspaceAgentSession(null, {
      lineUserId: "U1",
      agent: "activity",
      step: "name",
    }),
    false,
  );

  assert.equal(
    await clearWorkspaceAgentSession(null, "U1"),
    false,
  );
});

test("get returns normalized session", async () => {
  const { db, calls } = createMockDb({
    firstRow: {
      line_user_id: "U_ADMIN",
      agent_name: "activity",
      current_step: "activity_name",
      status: "running",
      payload_json: JSON.stringify({
        title: "春酒",
      }),
      created_at: "2026-08-04T01:00:00.000Z",
      updated_at: "2026-08-04T01:05:00.000Z",
      expires_at: "2026-08-05T01:05:00.000Z",
    },
  });

  const result =
    await getWorkspaceAgentSession(db, " U_ADMIN ");

  assert.equal(result.lineUserId, "U_ADMIN");
  assert.equal(result.agent, "activity");
  assert.equal(result.step, "activity_name");
  assert.equal(result.payload.title, "春酒");

  assert.deepEqual(
    calls[0].bindArgs,
    ["U_ADMIN"],
  );

  assert.equal(calls[0].firstCalled, true);
});

test("invalid payload JSON becomes empty object", async () => {
  const { db } = createMockDb({
    firstRow: {
      line_user_id: "U_ADMIN",
      agent_name: "push",
      current_step: "message",
      status: "running",
      payload_json: "{invalid",
    },
  });

  const result =
    await getWorkspaceAgentSession(db, "U_ADMIN");

  assert.deepEqual(result.payload, {});
});

test("save writes agent state and expiry", async () => {
  const { db, calls } = createMockDb();

  const now = new Date("2026-08-04T00:00:00.000Z");

  const result =
    await saveWorkspaceAgentSession(db, {
      lineUserId: " U_ADMIN ",
      agent: " activity ",
      step: " activity_name ",
      payload: {
        title: "春酒",
      },
      now,
      ttlSeconds: 3600,
    });

  assert.equal(result, true);
  assert.match(
    calls[0].sql,
    /ON CONFLICT\(line_user_id\) DO UPDATE/i,
  );

  assert.deepEqual(
    calls[0].bindArgs,
    [
      "U_ADMIN",
      "activity",
      "activity_name",
      "running",
      JSON.stringify({
        title: "春酒",
      }),
      "2026-08-04T01:00:00.000Z",
    ],
  );

  assert.equal(calls[0].runCalled, true);
});

test("save rejects incomplete identity or state", async () => {
  const { db, calls } = createMockDb();

  assert.equal(
    await saveWorkspaceAgentSession(db, {
      lineUserId: "",
      agent: "activity",
      step: "name",
    }),
    false,
  );

  assert.equal(
    await saveWorkspaceAgentSession(db, {
      lineUserId: "U1",
      agent: "",
      step: "name",
    }),
    false,
  );

  assert.equal(
    await saveWorkspaceAgentSession(db, {
      lineUserId: "U1",
      agent: "activity",
      step: "",
    }),
    false,
  );

  assert.equal(calls.length, 0);
});

test("clear deletes only the requested user session", async () => {
  const { db, calls } = createMockDb();

  const result =
    await clearWorkspaceAgentSession(
      db,
      " U_ADMIN ",
    );

  assert.equal(result, true);
  assert.match(
    calls[0].sql,
    /DELETE FROM workspace_agent_sessions/i,
  );

  assert.deepEqual(
    calls[0].bindArgs,
    ["U_ADMIN"],
  );
});

test("session operations fail safely on D1 errors", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const error = new Error("D1 unavailable");

    assert.equal(
      await ensureWorkspaceAgentSessionTable(
        createMockDb({ error }).db,
      ),
      false,
    );

    assert.equal(
      await getWorkspaceAgentSession(
        createMockDb({ error }).db,
        "U1",
      ),
      null,
    );

    assert.equal(
      await saveWorkspaceAgentSession(
        createMockDb({ error }).db,
        {
          lineUserId: "U1",
          agent: "activity",
          step: "name",
        },
      ),
      false,
    );

    assert.equal(
      await clearWorkspaceAgentSession(
        createMockDb({ error }).db,
        "U1",
      ),
      false,
    );
  } finally {
    console.warn = originalWarn;
  }
});
