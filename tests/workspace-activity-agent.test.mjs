import test from "node:test";
import assert from "node:assert/strict";

import {
  saveWorkspaceActivity,
} from "../src/workspace/activity-writer.js";

import {
  ACTIVITY_AGENT_STEPS,
  createActivityAgent,
} from "../src/workspace/activity-agent.js";

import {
  AGENT_RESULT_TYPES,
  AGENT_STATUS,
} from "../src/workspace/agent/agent-types.js";

function createMockDb(rows = []) {
  const calls = [];
  let firstIndex = 0;

  return {
    calls,

    prepare(sql) {
      const call = {
        sql,
        bindArgs: [],
        runCalled: false,
      };

      calls.push(call);

      return {
        bind(...args) {
          call.bindArgs = args;
          return this;
        },

        async first() {
          const row = rows[firstIndex] ?? null;
          firstIndex += 1;
          return row;
        },

        async run() {
          call.runCalled = true;
          return {
            success: true,
          };
        },
      };
    },
  };
}

test("activity writer requires a title", async () => {
  const result = await saveWorkspaceActivity(
    createMockDb(),
    {},
  );

  assert.equal(result.success, false);
  assert.match(result.message, /活動名稱必填/);
});

test("activity writer writes supported fields", async () => {
  const db = createMockDb([
    null,
    {
      id: "event-1",
      title: "春酒",
      location: "中壢",
    },
  ]);

  const result = await saveWorkspaceActivity(
    db,
    {
      title: " 春酒 ",
      start_at: "2026-08-20 14:00",
      location: " 中壢 ",
    },
    {
      createId: () => "event-1",
      createQrToken: () => "qr-token",
      normalizeDate: (value) =>
        String(value || "").trim(),
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.event.id, "event-1");

  assert.match(
    db.calls[1].sql,
    /INSERT INTO welfare_activity_events/i,
  );

  assert.equal(
    db.calls[1].bindArgs[1],
    "春酒",
  );

  assert.equal(
    db.calls[1].bindArgs[3],
    "中壢",
  );
});

test("activity writer remains scoped to activity table", async () => {
  const db = createMockDb([
    null,
    {
      id: "event-1",
    },
  ]);

  await saveWorkspaceActivity(
    db,
    {
      title: "測試活動",
    },
    {
      createId: () => "event-1",
      createQrToken: () => "qr-token",
    },
  );

  for (const call of db.calls) {
    assert.match(
      call.sql,
      /welfare_activity_events/i,
    );
  }
});

test("activity agent starts with title step", async () => {
  const agent = createActivityAgent({
    saveActivity: async () => ({
      success: true,
    }),
  });

  const result = await agent.start();

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.CONTINUE,
  );

  assert.equal(
    result.step,
    ACTIVITY_AGENT_STEPS.TITLE,
  );
});

test("activity agent collects title date and location", async () => {
  const agent = createActivityAgent({
    saveActivity: async () => ({
      success: true,
    }),
  });

  const titleResult = await agent.resume({
    input: "春酒",
    session: {
      step: ACTIVITY_AGENT_STEPS.TITLE,
      payload: {},
    },
  });

  assert.equal(
    titleResult.step,
    ACTIVITY_AGENT_STEPS.START_AT,
  );

  const dateResult = await agent.resume({
    input: "2026-08-20 14:00",
    session: {
      step: titleResult.step,
      payload: titleResult.payload,
    },
  });

  assert.equal(
    dateResult.step,
    ACTIVITY_AGENT_STEPS.LOCATION,
  );

  const locationResult = await agent.resume({
    input: "中壢活動中心",
    session: {
      step: dateResult.step,
      payload: dateResult.payload,
    },
  });

  assert.equal(
    locationResult.type,
    AGENT_RESULT_TYPES.CONFIRM,
  );

  assert.equal(
    locationResult.status,
    AGENT_STATUS.CONFIRMING,
  );

  assert.match(locationResult.text, /春酒/);
  assert.match(locationResult.text, /中壢活動中心/);
});

test("activity agent confirms and calls writer", async () => {
  let received = null;

  const agent = createActivityAgent({
    saveActivity: async (db, data) => {
      received = data;

      return {
        success: true,
        event: {
          id: "event-1",
        },
      };
    },
  });

  const result = await agent.resume({
    db: {},
    input: "確認",
    session: {
      step: ACTIVITY_AGENT_STEPS.CONFIRM,
      payload: {
        title: "春酒",
        startAt: "2026-08-20 14:00",
        location: "中壢活動中心",
      },
    },
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.COMPLETE,
  );

  assert.equal(received.title, "春酒");
  assert.equal(
    received.start_at,
    "2026-08-20 14:00",
  );

  assert.equal(
    result.payload.eventId,
    "event-1",
  );
});

test("activity agent does not write without exact confirmation", async () => {
  let called = false;

  const agent = createActivityAgent({
    saveActivity: async () => {
      called = true;

      return {
        success: true,
      };
    },
  });

  const result = await agent.resume({
    input: "好",
    session: {
      step: ACTIVITY_AGENT_STEPS.CONFIRM,
      payload: {
        title: "春酒",
      },
    },
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.CONFIRM,
  );

  assert.equal(called, false);
});

test("activity agent supports cancellation", async () => {
  const agent = createActivityAgent({
    saveActivity: async () => ({
      success: true,
    }),
  });

  const result = await agent.resume({
    input: "取消",
    session: {
      step: ACTIVITY_AGENT_STEPS.START_AT,
      payload: {
        title: "春酒",
      },
    },
  });

  assert.equal(
    result.type,
    AGENT_RESULT_TYPES.CANCEL,
  );
});
