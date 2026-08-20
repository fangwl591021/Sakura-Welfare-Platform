import worker from "./index.js";

const SAKURA_LIFF_ID = "2009117474-pwyW1R4u";
const SAKURA_LINE_LOGIN_CHANNEL_ID = "2009117474";
const FAVORITES_API_PATH = "/api/partner-store-favorites";
const PARTNER_STORE_PATHS = new Set([
  "/partner-stores",
  "/partner-stores-id",
  "/partner-stores-vi",
  "/partner-stores-th",
]);

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
  if (!env.DB) return jsonResponse({ success: false, message: "D1 binding DB is not configured." }, 500);
  const identity = await verifyLineIdToken(getBearerToken(request));
  if (!identity) return jsonResponse({ success: false, message: "LINE 身分驗證失敗，請從 LINE 重新開啟。" }, 401);

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
      return jsonResponse({ success: false, message: "收藏資料尚未就緒。", detail: String(error && error.message || error) }, 500);
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
      return jsonResponse({ success: false, message: "收藏更新失敗。", detail: String(error && error.message || error) }, 500);
    }
  }

  return jsonResponse({ success: false, message: "Method not allowed." }, 405);
}

function localeForPartnerStorePath(pathname) {
  if (pathname.endsWith("-th")) return "th";
  if (pathname.endsWith("-id") || pathname.endsWith("-vi")) return "id";
  return "zh";
}

function favoriteUiScript(locale) {
  const labels = {
    zh: { add: "加入收藏", remove: "取消收藏", auth: "請先登入 LINE 後再收藏", failed: "收藏更新失敗" },
    id: { add: "Tambah favorit", remove: "Hapus favorit", auth: "Silakan masuk LINE untuk menyimpan favorit", failed: "Gagal memperbarui favorit" },
    th: { add: "เพิ่มรายการโปรด", remove: "ยกเลิกรายการโปรด", auth: "กรุณาเข้าสู่ระบบ LINE ก่อนบันทึกรายการโปรด", failed: "อัปเดตรายการโปรดไม่สำเร็จ" },
  };
  const copy = labels[locale] || labels.zh;
  return `<script id="sakura-partner-favorites-script">
(function(){
  const LIFF_ID=${JSON.stringify(SAKURA_LIFF_ID)};
  const API=${JSON.stringify(FAVORITES_API_PATH)};
  const COPY=${JSON.stringify(copy)};
  let idToken="";
  let favoriteSet=new Set();
  let currentStore=null;
  let favoriteLoadStarted=false;

  function storeId(store){ return String(store && store.id || "").trim(); }
  function isFavorite(store){ const id=storeId(store); return !!id && favoriteSet.has(id); }
  function heartText(active){ return active ? "♥" : "♡"; }
  function heartTitle(active){ return active ? COPY.remove : COPY.add; }
  function setHeartState(el,active){
    if(!el) return;
    const text=heartText(active);
    const title=heartTitle(active);
    if(el.textContent!==text) el.textContent=text;
    if(el.classList.contains("active")!==!!active) el.classList.toggle("active",!!active);
    if(el.getAttribute("title")!==title) el.setAttribute("title",title);
    if(el.getAttribute("aria-label")!==title) el.setAttribute("aria-label",title);
  }
  function flash(message){
    let toast=document.getElementById("sakuraFavoriteToast");
    if(!toast){
      toast=document.createElement("div");
      toast.id="sakuraFavoriteToast";
      toast.className="favorite-toast";
      document.body.appendChild(toast);
    }
    if(toast.textContent!==message) toast.textContent=message;
    toast.classList.add("show");
    clearTimeout(window.__sakuraFavoriteToastTimer);
    window.__sakuraFavoriteToastTimer=setTimeout(function(){toast.classList.remove("show")},1600);
  }
  async function ensureIdentity(interactive){
    if(idToken) return idToken;
    if(!window.liff){ if(interactive) flash(COPY.auth); return ""; }
    try{
      await liff.init({liffId:LIFF_ID});
      if(!liff.isLoggedIn()){
        if(interactive) liff.login({redirectUri:location.href});
        return "";
      }
      idToken=liff.getIDToken()||"";
      if(!idToken && interactive) flash(COPY.auth);
      return idToken;
    }catch(_){ if(interactive) flash(COPY.auth); return ""; }
  }
  async function loadFavorites(){
    if(favoriteLoadStarted) return;
    favoriteLoadStarted=true;
    const token=await ensureIdentity(false);
    if(!token) return;
    try{
      const res=await fetch(API+"?ts="+Date.now(),{headers:{authorization:"Bearer "+token},cache:"no-store"});
      const data=await res.json();
      if(res.ok&&data.success&&Array.isArray(data.favorites)) favoriteSet=new Set(data.favorites.map(String));
    }catch(_){ }
    refreshAllHearts();
  }
  async function setFavorite(store,desired,el){
    const id=storeId(store);
    if(!id) return;
    const token=await ensureIdentity(true);
    if(!token) return;
    if(el) el.classList.add("busy");
    try{
      const res=await fetch(API,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({store_id:id,favorite:desired})});
      const data=await res.json();
      if(!res.ok||!data.success) throw new Error(data.message||COPY.failed);
      if(desired) favoriteSet.add(id); else favoriteSet.delete(id);
      refreshAllHearts();
    }catch(err){ flash(err&&err.message||COPY.failed); }
    finally{ if(el) el.classList.remove("busy"); }
  }
  function makeHeart(store){
    const span=document.createElement("span");
    span.className="favorite-heart";
    span.dataset.storeId=storeId(store);
    setHeartState(span,isFavorite(store));
    span.addEventListener("pointerdown",function(event){event.stopPropagation()});
    span.addEventListener("click",function(event){
      event.preventDefault();
      event.stopPropagation();
      if(span.classList.contains("busy")) return;
      setFavorite(store,!isFavorite(store),span);
    });
    return span;
  }
  function enhanceCards(){
    const stores=window.__visibleStores||[];
    document.querySelectorAll("#grid .card").forEach(function(card,index){
      const store=stores[index];
      if(!store) return;
      const id=storeId(store);
      let heart=card.querySelector(".favorite-heart");
      if(heart&&heart.dataset.storeId!==id){heart.remove();heart=null;}
      if(!heart){
        const category=card.querySelector(".pill.cat");
        if(category){heart=makeHeart(store);category.insertAdjacentElement("afterend",heart);}
      }
      setHeartState(heart,isFavorite(store));
    });
  }
  function enhanceSheet(){
    const tags=document.getElementById("sheetTags");
    if(!tags||!currentStore) return;
    let heart=tags.querySelector(".favorite-heart");
    const id=storeId(currentStore);
    if(heart&&heart.dataset.storeId!==id){heart.remove();heart=null;}
    if(!heart){
      const category=tags.querySelector(".pill.cat");
      if(category){heart=makeHeart(currentStore);category.insertAdjacentElement("afterend",heart);}
    }
    setHeartState(heart,isFavorite(currentStore));
  }
  function refreshAllHearts(){ enhanceCards(); enhanceSheet(); }
  function wrapOpenSheet(){
    if(typeof window.openSheet!=="function"||window.openSheet.__favoritesWrapped) return;
    const original=window.openSheet;
    function wrapped(index){
      currentStore=(window.__visibleStores||[])[index]||null;
      const result=original.apply(this,arguments);
      Promise.resolve().then(enhanceSheet);
      return result;
    }
    wrapped.__favoritesWrapped=true;
    window.openSheet=wrapped;
  }
  function watchStoreGrid(){
    const grid=document.getElementById("grid");
    if(!grid) return;
    const observer=new MutationObserver(function(mutations){
      if(!mutations.some(function(m){return m.type==="childList"&&m.target===grid})) return;
      enhanceCards();
    });
    observer.observe(grid,{childList:true});
  }
  wrapOpenSheet();
  watchStoreGrid();
  enhanceCards();
  loadFavorites();
})();
</script>`;
}

function injectPartnerStoreFavorites(html, locale) {
  if (!html || html.includes("sakura-partner-favorites-script")) return html;
  const style = `<style id="sakura-partner-favorites-style">
.favorite-heart{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;margin:-3px 0;border-radius:999px;color:#e32636;font-size:24px;line-height:1;font-weight:900;cursor:pointer;user-select:none;vertical-align:middle;transition:transform .12s ease,opacity .12s ease}.favorite-heart.active{color:#e32636}.favorite-heart:active{transform:scale(.88)}.favorite-heart.busy{opacity:.45;pointer-events:none}.favorite-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,18px);z-index:80;background:#071a33;color:#fff;border-radius:999px;padding:10px 14px;font-size:13px;font-weight:800;opacity:0;pointer-events:none;transition:.18s ease;max-width:86vw;text-align:center}.favorite-toast.show{opacity:1;transform:translate(-50%,0)}
</style><script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>`;
  const script = favoriteUiScript(locale);
  let next = html.includes("</head>") ? html.replace("</head>", style + "</head>") : style + html;
  next = next.includes("</body>") ? next.replace("</body>", script + "</body>") : next + script;
  return next;
}

async function handlePartnerStorePage(request, env, ctx, pathname) {
  const response = await worker.fetch(request, env, ctx);
  if (!response || !response.ok) return response;
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html")) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(injectPartnerStoreFavorites(html, localeForPartnerStorePath(pathname)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === FAVORITES_API_PATH && (request.method === "GET" || request.method === "POST")) {
      return handleFavoriteApi(request, env);
    }
    if (request.method === "GET" && PARTNER_STORE_PATHS.has(url.pathname)) {
      return handlePartnerStorePage(request, env, ctx, url.pathname);
    }
    return worker.fetch(request, env, ctx);
  },
};
