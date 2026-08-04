import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_QUICK_START_ACTION,
  createWorkspaceActivityRuntime,
  handleWorkspaceAgentTurn,
} from "../src/workspace/workspace-agent-entry-handler.js";

import {
  clearWorkspaceAgentSession,
  getWorkspaceAgentSession,
  saveWorkspaceAgentSession,
} from "../src/workspace/workspace-agent-session.js";

function createMemoryDb() {
  const sessions = new Map();
  const events = new Map();
  const calls = [];

  return {
    calls,
    sessions,
    events,

    prepare(sql) {
      const call = {
        sql,
        bindArgs: [],
      };

      calls.push(call);

      return {
        bind(...args) {
          call.bindArgs = args;
          return this;
        },

        async run() {
          if (
            /CREATE TABLE IF NOT EXISTS workspace_agent_sessions/i
              .test(sql)
          ) {
            return { success: true };
          }

          if (
            /INSERT INTO workspace_agent_sessions/i
              .test(sql)
          ) {
            const [
              lineUserId,
              agent,
              step,
              status,
              payloadJson,
              expiresAt,
            ] = call.bindArgs;

            sessions.set(lineUserId, {
              line_user_id: lineUserId,
              agent_name: agent,
              current_step: step,
              status,
              payload_json: payloadJson,
              created_at:
                "2026-08-04T00:00:00.000Z",
              updated_at:
                "2026-08-04T00:00:00.000Z",
              expires_at: expiresAt,
            });

            return { success: true };
          }

          if (
            /DELETE FROM workspace_agent_sessions/i
              .test(sql)
          ) {
            sessions.delete(call.bindArgs[0]);
            return { success: true };
          }

          if (
            /INSERT INTO welfare_activity_events/i
              .test(sql)
          ) {
            const [
              id,
              title,
              description,
              location,
              startAt,
              endAt,
              checkinStartAt,
              checkinEndAt,
              status,
              audienceScope,
              qrToken,
            ] = call.bindArgs;

            events.set(id, {
              id,
              title,
              description,
              location,
              start_at: startAt,
              end_at: endAt,
              checkin_start_at: checkinStartAt,
              checkin_end_at: checkinEndAt,
              status,
              audience_scope: audienceScope,
              qr_token: qrToken,
            });

            return { success: true };
          }

          return { success: true };
        },

        async first() {
          if (
            /FROM workspace_agent_sessions/i
              .test(sql)
          ) {
            return (
              sessions.get(call.bindArgs[0]) ||
              null
            );
          }

          if (
            /SELECT qr_token/i.test(sql)
          ) {
            return (
              events.get(call.bindArgs[0]) ||
              null
            );
          }

          if (
            /SELECT \*/i.test(sql) &&
            /FROM welfare_activity_events/i
              .test(sql)
          ) {
            return (
              events.get(call.bindArgs[0]) ||
              null
            );
          }

          return null;
        },
      };
    },
  };
}

function createRuntime() {
  let idCounter = 0;

  return createWorkspaceActivityRuntime({
    ensureActivityTables:
      async () => true,

    normalizeActivityDate:
      (value) => String(value || "").trim(),

    createId: () => {
      idCounter += 1;
      return `event-${idCounter}`;
    },
  });
}

const findAdmin =
  async () => ({
    admin: true,
    role: "admin",
  });

test("unrelated text without session is ignored", async () => {
  const db = createMemoryDb();

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_ADMIN",
      input: "一般訊息",
      isPostback: false,
      findAdmin,
      runtime: createRuntime(),
    });

  assert.equal(result, null);
});

test("activity start postback starts agent", async () => {
  const db = createMemoryDb();

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_ADMIN",
      input: ACTIVITY_QUICK_START_ACTION,
      isPostback: true,
      findAdmin,
      runtime: createRuntime(),
    });

  assert.equal(result.handled, true);
  assert.equal(result.authorized, true);
  assert.equal(result.agent, "activity");
  assert.match(result.text, /活動名稱/);

  const session =
    await getWorkspaceAgentSession(
      db,
      "U_ADMIN",
    );

  assert.equal(
    session.step,
    "activity_title",
  );
});

test("non-admin cannot start activity agent", async () => {
  const db = createMemoryDb();

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_MEMBER",
      input: ACTIVITY_QUICK_START_ACTION,
      isPostback: true,
      findAdmin: async () => null,
      runtime: createRuntime(),
    });

  assert.equal(result.handled, true);
  assert.equal(result.authorized, false);
  assert.match(result.text, /授權管理員/);

  assert.equal(
    await getWorkspaceAgentSession(
      db,
      "U_MEMBER",
    ),
    null,
  );
});

test("normal text resumes running agent session", async () => {
  const db = createMemoryDb();
  const runtime = createRuntime();

  await handleWorkspaceAgentTurn({
    db,
    lineUserId: "U_ADMIN",
    input: ACTIVITY_QUICK_START_ACTION,
    isPostback: true,
    findAdmin,
    runtime,
  });

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_ADMIN",
      input: "春酒活動",
      isPostback: false,
      findAdmin,
      runtime,
    });

  assert.match(result.text, /日期時間/);

  const session =
    await getWorkspaceAgentSession(
      db,
      "U_ADMIN",
    );

  assert.equal(
    session.payload.title,
    "春酒活動",
  );
});

test("activity flow reaches confirmation", async () => {
  const db = createMemoryDb();
  const runtime = createRuntime();

  await handleWorkspaceAgentTurn({
    db,
    lineUserId: "U_ADMIN",
    input: ACTIVITY_QUICK_START_ACTION,
    isPostback: true,
    findAdmin,
    runtime,
  });

  await handleWorkspaceAgentTurn({
    db,
    lineUserId: "U_ADMIN",
    input: "春酒活動",
    findAdmin,
    runtime,
  });

  await handleWorkspaceAgentTurn({
    db,
    lineUserId: "U_ADMIN",
    input: "2026-08-20 14:00",
    findAdmin,
    runtime,
  });

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_ADMIN",
      input: "中壢活動中心",
      findAdmin,
      runtime,
    });

  assert.match(result.text, /請確認活動資料/);
  assert.match(result.text, /春酒活動/);
  assert.match(result.text, /中壢活動中心/);
});

test("cancel clears active session", async () => {
  const db = createMemoryDb();
  const runtime = createRuntime();

  await handleWorkspaceAgentTurn({
    db,
    lineUserId: "U_ADMIN",
    input: ACTIVITY_QUICK_START_ACTION,
    isPostback: true,
    findAdmin,
    runtime,
  });

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_ADMIN",
      input: "取消",
      findAdmin,
      runtime,
    });

  assert.match(result.text, /已取消/);

  assert.equal(
    await getWorkspaceAgentSession(
      db,
      "U_ADMIN",
    ),
    null,
  );
});

test("unrelated postback does not resume session", async () => {
  const db = createMemoryDb();
  const runtime = createRuntime();

  await handleWorkspaceAgentTurn({
    db,
    lineUserId: "U_ADMIN",
    input: ACTIVITY_QUICK_START_ACTION,
    isPostback: true,
    findAdmin,
    runtime,
  });

  const result =
    await handleWorkspaceAgentTurn({
      db,
      lineUserId: "U_ADMIN",
      input: "action=workspace.push.create",
      isPostback: true,
      findAdmin,
      runtime,
    });

  assert.equal(result, null);
});
