import worker from "./index.js";

const SAKURA_LINE_LOGIN_CHANNEL_ID = "2009117474";
const FAVORITES_API_PATH = "/api/partner-store-favorites";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function getBearerToken(request) {
  const header = String(request.headers.get("authorization") || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

async function verifyLineIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!token) return null;

  const body = new URLSearchParams();
  body.set("id_token", token);
  body.set("client_id", SAKURA_LINE_LOGIN_CHANNEL_ID);

  let response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (_) {
    return null;
  }

  if (!response.ok) return null;

  let data;
  try {
    data = await response.json();
  } catch (_) {
    return null;
  }

  const userId = String((data && data.sub) || "").trim();
  return userId ? { userId, name: String(data.name || "") } : null;
}

async function handleFavoriteApi(request, env) {
  if (!env.DB) {
    return jsonResponse({ success: false, message: "D1 binding DB is not configured." }, 500);
  }

  const identity = await verifyLineIdToken(getBearerToken(request));
  if (!identity) {
    return jsonResponse({ success: false, message: "LINE 身分驗證失敗，請從 LINE 重新開啟。" }, 401);
  }

  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT store_id FROM welfare_store_favorites WHERE line_user_id = ? ORDER BY created_at DESC"
      ).bind(identity.userId).all();

      return jsonResponse({
        success: true,
        favorites: (result.results || []).map((row) => String(row.store_id || "")).filter(Boolean),
      });
    } catch (error) {
      return jsonResponse({
        success: false,
        message: "收藏資料尚未就緒。",
        detail: String((error && error.message) || error),
      }, 500);
    }
  }

  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return jsonResponse({ success: false, message: "請提供有效的 JSON。" }, 400);
    }

    const storeId = String((payload && payload.store_id) || "").trim();
    if (!storeId || storeId.length > 200) {
      return jsonResponse({ success: false, message: "店家識別碼無效。" }, 400);
    }

    if (typeof payload.favorite !== "boolean") {
      return jsonResponse({ success: false, message: "favorite 必須為布林值。" }, 400);
    }

    try {
      if (payload.favorite) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO welfare_store_favorites (line_user_id, store_id, created_at) VALUES (?, ?, ?)"
        ).bind(identity.userId, storeId, new Date().toISOString()).run();
      } else {
        await env.DB.prepare(
          "DELETE FROM welfare_store_favorites WHERE line_user_id = ? AND store_id = ?"
        ).bind(identity.userId, storeId).run();
      }

      return jsonResponse({ success: true, store_id: storeId, favorite: payload.favorite });
    } catch (error) {
      return jsonResponse({
        success: false,
        message: "收藏更新失敗。",
        detail: String((error && error.message) || error),
      }, 500);
    }
  }

  return jsonResponse({ success: false, message: "Method not allowed." }, 405);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === FAVORITES_API_PATH && (request.method === "GET" || request.method === "POST")) {
      return handleFavoriteApi(request, env);
    }

    // Emergency compatibility rule:
    // every existing Sakura route, including /partner-stores and /api/partner-stores,
    // is returned directly by the original Worker with zero HTML rewriting.
    return worker.fetch(request, env, ctx);
  },
};
