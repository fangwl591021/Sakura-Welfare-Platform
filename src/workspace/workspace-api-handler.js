import {
  saveWorkspaceActivity,
} from "./activity-writer.js";

function normalizeString(value) {
  return String(value || "").trim();
}

export function getWorkspaceBearerToken(request) {
  const authorization = normalizeString(
    request?.headers?.get?.("authorization"),
  );

  const match = authorization.match(
    /^Bearer\s+(.+)$/i,
  );

  return match
    ? normalizeString(match[1])
    : "";
}

function validateActivityInput(data = {}) {
  const title = normalizeString(data.title);
  const startAt = normalizeString(
    data.startAt || data.start_at,
  );
  const endAt = normalizeString(
    data.endAt || data.end_at,
  );
  const location = normalizeString(data.location);

  if (!title) {
    return {
      ok: false,
      message: "請輸入活動名稱。",
    };
  }

  if (!startAt) {
    return {
      ok: false,
      message: "請選擇開始時間。",
    };
  }

  if (!endAt) {
    return {
      ok: false,
      message: "請選擇結束時間。",
    };
  }

  const startTime = new Date(startAt).getTime();
  const endTime = new Date(endAt).getTime();

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime)
  ) {
    return {
      ok: false,
      message: "活動時間格式不正確。",
    };
  }

  if (endTime <= startTime) {
    return {
      ok: false,
      message: "結束時間必須晚於開始時間。",
    };
  }

  if (!location) {
    return {
      ok: false,
      message: "請輸入活動地點。",
    };
  }

  return {
    ok: true,
    data: {
      title,
      description: normalizeString(
        data.description,
      ),
      startAt,
      endAt,
      location,
      coverImageUrl: normalizeString(
        data.coverImageUrl ||
        data.cover_image_url,
      ),
    },
  };
}

async function handleLogin({
  request,
  db,
  loginAdmin,
}) {
  if (typeof loginAdmin !== "function") {
    return {
      success: false,
      message: "Workspace login is unavailable.",
    };
  }

  const data = await request
    .json()
    .catch(() => ({}));

  return loginAdmin(data, db, request);
}

async function authorizeAdmin({
  request,
  db,
  requireAdmin,
}) {
  const token = getWorkspaceBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: {
        success: false,
        message: "請先登入 Workspace。",
      },
    };
  }

  if (typeof requireAdmin !== "function") {
    return {
      ok: false,
      response: {
        success: false,
        message: "Workspace authorization is unavailable.",
      },
    };
  }

  return requireAdmin(
    {
      sessionToken: token,
    },
    db,
  );
}

async function handleActivityCreate({
  request,
  db,
  requireAdmin,
  ensureActivityTables,
  normalizeActivityDate,
}) {
  const authorization = await authorizeAdmin({
    request,
    db,
    requireAdmin,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  const incoming = await request
    .json()
    .catch(() => ({}));

  const validation =
    validateActivityInput(incoming);

  if (!validation.ok) {
    return {
      success: false,
      message: validation.message,
    };
  }

  const data = validation.data;

  const result = await saveWorkspaceActivity(
    db,
    {
      title: data.title,
      description: data.description,
      start_at: data.startAt,
      end_at: data.endAt,
      location: data.location,
      status: "active",
      audience_scope: ["employee"],
    },
    {
      ensureTables: ensureActivityTables,
      normalizeDate:
        typeof normalizeActivityDate === "function"
          ? normalizeActivityDate
          : undefined,
    },
  );

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    message: "員工活動建立成功。",
    data: {
      event: result.event,
      createdBy: {
        id: authorization.user?.id || "",
        username:
          authorization.user?.username || "",
        displayName:
          authorization.user?.display_name ||
          authorization.user?.username ||
          "",
      },
    },
  };
}

export async function maybeHandleWorkspaceApiRequest({
  request,
  url,
  db,
  loginAdmin,
  requireAdmin,
  ensureActivityTables,
  normalizeActivityDate,
} = {}) {
  if (!request || !url) {
    return null;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/workspace-api/login"
  ) {
    return handleLogin({
      request,
      db,
      loginAdmin,
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/workspace-api/activity"
  ) {
    return handleActivityCreate({
      request,
      db,
      requireAdmin,
      ensureActivityTables,
      normalizeActivityDate,
    });
  }

  return null;
}
