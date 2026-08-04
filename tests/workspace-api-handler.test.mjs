import test from "node:test";
import assert from "node:assert/strict";

import {
  getWorkspaceBearerToken,
  maybeHandleWorkspaceApiRequest,
} from "../src/workspace/workspace-api-handler.js";

function createRequest(
  path,
  {
    body = {},
    token = "",
  } = {},
) {
  const headers = {
    "content-type": "application/json",
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return new Request(
    `https://example.test${path}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

function createActivityDb() {
  const calls = [];
  let selectedEvent = null;

  return {
    calls,

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
            /INSERT INTO welfare_activity_events/i
              .test(sql)
          ) {
            selectedEvent = {
              id: call.bindArgs[0],
              title: call.bindArgs[1],
              description: call.bindArgs[2],
              location: call.bindArgs[3],
              start_at: call.bindArgs[4],
              end_at: call.bindArgs[5],
              status: call.bindArgs[8],
              audience_scope:
                call.bindArgs[9],
              qr_token: call.bindArgs[10],
            };
          }

          return {
            success: true,
          };
        },

        async first() {
          if (
            /SELECT qr_token/i.test(sql)
          ) {
            return null;
          }

          if (
            /SELECT \*/i.test(sql) &&
            /welfare_activity_events/i.test(sql)
          ) {
            return selectedEvent;
          }

          return null;
        },
      };
    },
  };
}

test("bearer token is parsed safely", () => {
  const request = new Request(
    "https://example.test",
    {
      headers: {
        authorization:
          "Bearer session-token",
      },
    },
  );

  assert.equal(
    getWorkspaceBearerToken(request),
    "session-token",
  );
});

test("login delegates to existing loginAdmin", async () => {
  let received = null;

  const request = createRequest(
    "/workspace-api/login",
    {
      body: {
        username: "admin",
        password: "secret",
      },
    },
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db: {},
      loginAdmin: async (data, db, req) => {
        received = {
          data,
          db,
          request: req,
        };

        return {
          success: true,
          data: {
            token: "session-token",
          },
        };
      },
    });

  assert.equal(result.success, true);
  assert.equal(
    result.data.token,
    "session-token",
  );

  assert.equal(
    received.data.username,
    "admin",
  );

  assert.equal(received.request, request);
});

test("activity creation requires bearer token", async () => {
  const request = createRequest(
    "/workspace-api/activity",
    {
      body: {
        title: "員工活動",
      },
    },
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db: createActivityDb(),
      requireAdmin: async () => ({
        ok: true,
      }),
    });

  assert.equal(result.success, false);
  assert.match(result.message, /登入/);
});

test("expired session is rejected", async () => {
  const request = createRequest(
    "/workspace-api/activity",
    {
      token: "expired-token",
      body: {
        title: "員工活動",
        startAt: "2026-09-20T18:00",
        endAt: "2026-09-20T21:00",
        location: "本廠",
      },
    },
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db: createActivityDb(),
      requireAdmin: async () => ({
        ok: false,
        response: {
          success: false,
          message: "登入已過期。",
        },
      }),
    });

  assert.equal(result.success, false);
  assert.match(result.message, /過期/);
});

test("activity API validates required fields", async () => {
  const request = createRequest(
    "/workspace-api/activity",
    {
      token: "session-token",
      body: {
        title: "",
      },
    },
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db: createActivityDb(),
      requireAdmin: async () => ({
        ok: true,
        user: {
          id: "admin-1",
          username: "admin",
        },
      }),
    });

  assert.equal(result.success, false);
  assert.match(result.message, /活動名稱/);
});

test("activity API rejects invalid time range", async () => {
  const request = createRequest(
    "/workspace-api/activity",
    {
      token: "session-token",
      body: {
        title: "員工活動",
        startAt: "2026-09-20T21:00",
        endAt: "2026-09-20T18:00",
        location: "本廠",
      },
    },
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db: createActivityDb(),
      requireAdmin: async () => ({
        ok: true,
        user: {
          id: "admin-1",
          username: "admin",
        },
      }),
    });

  assert.equal(result.success, false);
  assert.match(
    result.message,
    /結束時間必須晚於開始時間/,
  );
});

test("authorized admin creates employee activity", async () => {
  const db = createActivityDb();

  const request = createRequest(
    "/workspace-api/activity",
    {
      token: "session-token",
      body: {
        title: " 健行社中秋烤肉 ",
        description: " 員工限定 ",
        startAt: "2026-09-20T18:00",
        endAt: "2026-09-20T21:00",
        location: " 本廠 ",
      },
    },
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db,
      requireAdmin: async (data) => {
        assert.equal(
          data.sessionToken,
          "session-token",
        );

        return {
          ok: true,
          user: {
            id: "admin-1",
            username: "admin",
            display_name: "Tony",
          },
        };
      },
      ensureActivityTables:
        async () => true,
      normalizeActivityDate:
        (value) => String(value || "").trim(),
    });

  assert.equal(result.success, true);
  assert.equal(
    result.data.event.title,
    "健行社中秋烤肉",
  );

  assert.equal(
    result.data.event.location,
    "本廠",
  );

  assert.equal(
    result.data.event.audience_scope,
    JSON.stringify(["employee"]),
  );

  assert.equal(
    result.data.createdBy.displayName,
    "Tony",
  );
});

test("unknown workspace API path is ignored", async () => {
  const request = createRequest(
    "/workspace-api/unknown",
  );

  const result =
    await maybeHandleWorkspaceApiRequest({
      request,
      url: new URL(request.url),
      db: {},
    });

  assert.equal(result, null);
});
