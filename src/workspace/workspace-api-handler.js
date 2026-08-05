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
      coverImageKey: normalizeString(
        data.coverImageKey ||
        data.cover_image_key,
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



function sanitizeUploadFileName(value) {
  return normalizeString(value || "activity-image")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

async function handleActivityUpload({
  request,
  db,
  requireAdmin,
  bucket,
  origin,
}) {
  const authorization = await authorizeAdmin({
    request,
    db,
    requireAdmin,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  if (!bucket || typeof bucket.put !== "function") {
    return {
      success: false,
      message: "R2 \u5716\u7247\u5132\u5b58\u672a\u8a2d\u5b9a\u3002",
    };
  }

  let formData;

  try {
    formData = await request.formData();
  } catch {
    return {
      success: false,
      message: "\u4e0a\u50b3\u8cc7\u6599\u683c\u5f0f\u4e0d\u6b63\u78ba\u3002",
    };
  }

  const file = formData.get("file");

  if (!(file instanceof File) || !file.size) {
    return {
      success: false,
      message: "\u8acb\u9078\u64c7\u5716\u7247\u6a94\u6848\u3002",
    };
  }

  const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  if (!allowedTypes.has(file.type)) {
    return {
      success: false,
      message: "\u53ea\u652f\u63f4 JPG\u3001PNG\u3001WebP \u5716\u7247\u3002",
    };
  }

  if (file.size > 8 * 1024 * 1024) {
    return {
      success: false,
      message: "\u5716\u7247\u4e0d\u53ef\u8d85\u904e 8 MB\u3002",
    };
  }

  const extensionMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };

  const originalName =
    sanitizeUploadFileName(file.name || "activity-image");

  const extension =
    extensionMap[file.type] || "";

  const baseName =
    originalName.replace(/\.[A-Za-z0-9]+$/, "");

  const key =
    `workspace/activity/${Date.now()}_${crypto.randomUUID()}_${baseName}${extension}`;

  try {
    await bucket.put(
      key,
      await file.arrayBuffer(),
      {
        httpMetadata: {
          contentType: file.type,
        },
      },
    );

    const fileUrl =
      `${String(origin || "").replace(/\/+$/, "")}/file/${encodeURIComponent(key)}`;

    return {
      success: true,
      message: "\u5716\u7247\u4e0a\u50b3\u6210\u529f\u3002",
      data: {
        coverImageUrl: fileUrl,
        coverImageKey: key,
        fileName: file.name || "",
        mimeType: file.type,
        fileSize: file.size,
      },
    };
  } catch (error) {
    console.warn("handleActivityUpload failed", error);

    return {
      success: false,
      message: "\u5716\u7247\u4e0a\u50b3\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002",
    };
  }
}

async function handleActivityList({
  request,
  db,
  requireAdmin,
  ensureActivityTables,
}) {
  const authorization = await authorizeAdmin({
    request,
    db,
    requireAdmin,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  if (typeof ensureActivityTables === "function") {
    await ensureActivityTables(db);
  }

  try {
    const result = await db.prepare(`
      SELECT
        id,
        title,
        description,
        location,
        start_at,
        end_at,
        status,
        audience_scope,
        cover_image_url,
        cover_image_key,
        created_at,
        updated_at
      FROM welfare_activity_events
      WHERE status <> 'archived'
      ORDER BY
        COALESCE(NULLIF(start_at, ''), created_at) DESC
      LIMIT 20
    `).all();

    return {
      success: true,
      data: {
        activities: result.results || [],
      },
    };
  } catch (error) {
    console.warn("handleActivityList failed", error);

    return {
      success: false,
      message: "\u6d3b\u52d5\u5217\u8868\u8b80\u53d6\u5931\u6557\u3002",
      data: {
        activities: [],
      },
    };
  }
}

async function handleActivityGet({
  request,
  db,
  requireAdmin,
  ensureActivityTables,
  activityId,
}) {
  const authorization = await authorizeAdmin({
    request,
    db,
    requireAdmin,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  if (typeof ensureActivityTables === "function") {
    await ensureActivityTables(db);
  }

  const id = normalizeString(activityId);

  if (!id) {
    return {
      success: false,
      message: "\u7f3a\u5c11\u6d3b\u52d5 ID\u3002",
    };
  }

  try {
    const event = await db.prepare(`
      SELECT *
      FROM welfare_activity_events
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!event) {
      return {
        success: false,
        message: "\u627e\u4e0d\u5230\u6d3b\u52d5\u3002",
      };
    }

    return {
      success: true,
      data: {
        event,
      },
    };
  } catch (error) {
    console.warn("handleActivityGet failed", error);

    return {
      success: false,
      message: "\u6d3b\u52d5\u8b80\u53d6\u5931\u6557\u3002",
    };
  }
}

async function handleActivityUpdate({
  request,
  db,
  requireAdmin,
  ensureActivityTables,
  normalizeActivityDate,
  activityId,
}) {
  const authorization = await authorizeAdmin({
    request,
    db,
    requireAdmin,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  const id = normalizeString(activityId);

  if (!id) {
    return {
      success: false,
      message: "\u7f3a\u5c11\u6d3b\u52d5 ID\u3002",
    };
  }

  const existing = await db.prepare(`
    SELECT
      id,
      status,
      cover_image_url,
      cover_image_key
    FROM welfare_activity_events
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();

  if (!existing) {
    return {
      success: false,
      message: "\u627e\u4e0d\u5230\u6d3b\u52d5\u3002",
    };
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
      id,
      title: data.title,
      description: data.description,
      start_at: data.startAt,
      end_at: data.endAt,
      location: data.location,
      status:
        normalizeString(incoming.status) ||
        existing.status ||
        "active",
      audience_scope: ["employee"],
      cover_image_url:
        data.coverImageUrl ||
        normalizeString(existing.cover_image_url),
      cover_image_key:
        data.coverImageKey ||
        normalizeString(existing.cover_image_key),
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
    message: "\u6d3b\u52d5\u5df2\u66f4\u65b0\u3002",
    data: {
      event: result.event,
    },
  };
}

async function handleActivityArchive({
  request,
  db,
  requireAdmin,
  ensureActivityTables,
  activityId,
}) {
  const authorization = await authorizeAdmin({
    request,
    db,
    requireAdmin,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  const id = normalizeString(activityId);

  if (!id) {
    return {
      success: false,
      message: "\u7f3a\u5c11\u6d3b\u52d5 ID\u3002",
    };
  }

  if (typeof ensureActivityTables === "function") {
    await ensureActivityTables(db);
  }

  const existing = await db.prepare(`
    SELECT id, status
    FROM welfare_activity_events
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();

  if (!existing) {
    return {
      success: false,
      message: "\u627e\u4e0d\u5230\u6d3b\u52d5\u3002",
    };
  }

  if (
    normalizeString(existing.status) ===
    "archived"
  ) {
    return {
      success: true,
      message: "\u6d3b\u52d5\u5df2\u5c01\u5b58\u3002",
      data: {
        id,
        status: "archived",
      },
    };
  }

  try {
    await db.prepare(`
      UPDATE welfare_activity_events
      SET
        status = 'archived',
        updated_at =
          datetime('now', '+8 hours')
      WHERE id = ?
    `).bind(id).run();

    return {
      success: true,
      message: "\u6d3b\u52d5\u5df2\u5c01\u5b58\u3002",
      data: {
        id,
        status: "archived",
        archivedBy: {
          id:
            authorization.user?.id || "",
          username:
            authorization.user?.username ||
            "",
        },
      },
    };
  } catch (error) {
    console.warn(
      "handleActivityArchive failed",
      error,
    );

    return {
      success: false,
      message:
        "\u6d3b\u52d5\u5c01\u5b58\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002",
    };
  }
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
      cover_image_url: data.coverImageUrl,
      cover_image_key: data.coverImageKey,
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
  bucket,
  origin,
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
    url.pathname === "/workspace-api/upload"
  ) {
    return handleActivityUpload({
      request,
      db,
      requireAdmin,
      bucket,
      origin,
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/workspace-api/activities"
  ) {
    return handleActivityList({
      request,
      db,
      requireAdmin,
      ensureActivityTables,
    });
  }

  const activityArchivePathMatch =
    url.pathname.match(
      /^\/workspace-api\/activity\/([^/]+)\/archive$/,
    );

  if (
    activityArchivePathMatch &&
    request.method === "PUT"
  ) {
    return handleActivityArchive({
      request,
      db,
      requireAdmin,
      ensureActivityTables,
      activityId:
        decodeURIComponent(
          activityArchivePathMatch[1],
        ),
    });
  }

  const activityPathMatch =
    url.pathname.match(
      /^\/workspace-api\/activity\/([^/]+)$/,
    );

  if (
    activityPathMatch &&
    request.method === "GET"
  ) {
    return handleActivityGet({
      request,
      db,
      requireAdmin,
      ensureActivityTables,
      activityId:
        decodeURIComponent(activityPathMatch[1]),
    });
  }

  if (
    activityPathMatch &&
    request.method === "PUT"
  ) {
    return handleActivityUpdate({
      request,
      db,
      requireAdmin,
      ensureActivityTables,
      normalizeActivityDate,
      activityId:
        decodeURIComponent(activityPathMatch[1]),
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
