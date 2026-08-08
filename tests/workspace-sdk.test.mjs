import test from "node:test";
import assert from "node:assert/strict";

import {
  WorkspaceSdk,
  createWorkspaceSdk,
} from "../chrome-extension/sdk/workspace-sdk.js";

function jsonResponse(
  body,
  {
    status = 200,
  } = {},
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

test("SDK requires baseUrl", () => {
  assert.throws(
    () => createWorkspaceSdk(),
    /baseUrl/,
  );
});

test("login stores returned token", async () => {
  let request = null;

  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test/",
    fetchImpl: async (url, options) => {
      request = {
        url,
        options,
      };

      return jsonResponse({
        success: true,
        data: {
          token: "session-token",
        },
      });
    },
  });

  await sdk.login({
    username: "admin",
    password: "secret",
  });

  assert.equal(
    sdk.token,
    "session-token",
  );

  assert.equal(
    request.url,
    "https://example.test/workspace-api/login",
  );

  assert.equal(
    request.options.method,
    "POST",
  );
});

test("createActivity sends normalized data and bearer token", async () => {
  let request = null;

  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test",
    token: "session-token",
    fetchImpl: async (url, options) => {
      request = {
        url,
        options,
      };

      return jsonResponse({
        success: true,
        data: {
          event: {
            id: "event-1",
          },
        },
      });
    },
  });

  const result = await sdk.createActivity({
    title: " 員工烤肉 ",
    description: " 活動說明 ",
    startAt: "2026-09-20T18:00",
    endAt: "2026-09-20T21:00",
    checkinStartAt: "2026-09-20T17:30",
    checkinEndAt: "2026-09-20T21:30",
    location: " 本廠 ",
    audienceScope: ["employee"],
    status: "active",
  });

  assert.equal(
    result.data.event.id,
    "event-1",
  );

  assert.equal(
    request.options.headers.get(
      "Authorization",
    ),
    "Bearer session-token",
  );

  const body = JSON.parse(
    request.options.body,
  );

  assert.equal(body.title, "員工烤肉");
  assert.equal(body.location, "本廠");
  assert.equal(body.checkinStartAt, "2026-09-20T17:30");
  assert.equal(body.checkinEndAt, "2026-09-20T21:30");
  assert.deepEqual(body.audienceScope, ["employee"]);
  assert.equal(body.status, "active");
});

test("API errors become JavaScript errors", async () => {
  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test",
    fetchImpl: async () =>
      jsonResponse(
        {
          success: false,
          message: "登入失敗",
        },
        {
          status: 401,
        },
      ),
  });

  await assert.rejects(
    () => sdk.login({
      username: "admin",
      password: "wrong",
    }),
    /登入失敗/,
  );
});

test("logout always clears local token", async () => {
  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test",
    token: "session-token",
    fetchImpl: async () =>
      jsonResponse({
        success: true,
      }),
  });

  await sdk.logout();

  assert.equal(sdk.token, "");
});

test("listActivities calls activities endpoint", async () => {
  let request = null;

  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test",
    token: "session-token",
    fetchImpl: async (url, options) => {
      request = {
        url,
        options,
      };

      return jsonResponse({
        success: true,
        data: {
          activities: [],
        },
      });
    },
  });

  await sdk.listActivities();

  assert.equal(
    request.url,
    "https://example.test/workspace-api/activities",
  );
  assert.equal(
    request.options.method,
    "GET",
  );
});

test("getActivity requires id and calls detail endpoint", async () => {
  let request = null;

  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test",
    token: "session-token",
    fetchImpl: async (url, options) => {
      request = {
        url,
        options,
      };

      return jsonResponse({
        success: true,
        data: {
          event: {
            id: "activity-1",
          },
        },
      });
    },
  });

  await assert.rejects(
    () => sdk.getActivity(""),
    /activity id/,
  );

  await sdk.getActivity("activity-1");

  assert.equal(
    request.url,
    "https://example.test/workspace-api/activity/activity-1",
  );
});

test("updateActivity sends PUT payload", async () => {
  let request = null;

  const sdk = new WorkspaceSdk({
    baseUrl: "https://example.test",
    token: "session-token",
    fetchImpl: async (url, options) => {
      request = {
        url,
        options,
      };

      return jsonResponse({
        success: true,
        data: {
          event: {
            id: "activity-1",
          },
        },
      });
    },
  });

  await sdk.updateActivity(
    "activity-1",
    {
      title: "更新後活動",
      description: "說明",
      startAt: "2026-09-20T18:00",
      endAt: "2026-09-20T21:00",
      checkinStartAt: "2026-09-20T17:45",
      checkinEndAt: "2026-09-20T21:15",
      location: "本廠",
      audienceScope: ["all", "employee"],
    },
  );

  assert.equal(
    request.options.method,
    "PUT",
  );

  const body = JSON.parse(
    request.options.body,
  );

  assert.equal(body.title, "更新後活動");
  assert.equal(body.location, "本廠");
  assert.equal(body.checkinStartAt, "2026-09-20T17:45");
  assert.equal(body.checkinEndAt, "2026-09-20T21:15");
  assert.deepEqual(body.audienceScope, ["all", "employee"]);
});
