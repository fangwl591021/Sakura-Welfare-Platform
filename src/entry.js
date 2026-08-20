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
  try {
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const userId = String((data && data.sub) || "").trim();
    return userId ? { userId, name: String(data.name || "") } : null;
  } catch (_) {
    return null;
  }
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
      return jsonResponse({ success: false, message: "收藏資料尚未就緒。", detail: String((error && error.message) || error) }, 500);
    }
  }

  if (request.method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch (_) { return jsonResponse({ success: false, message: "請提供有效的 JSON。" }, 400); }

    const storeId = String((payload && payload.store_id) || "").trim();
    if (!storeId || storeId.length > 200) return jsonResponse({ success: false, message: "店家識別碼無效。" }, 400);
    if (typeof payload.favorite !== "boolean") return jsonResponse({ success: false, message: "favorite 必須為布林值。" }, 400);

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
      return jsonResponse({ success: false, message: "收藏更新失敗。", detail: String((error && error.message) || error) }, 500);
    }
  }

  return jsonResponse({ success: false, message: "Method not allowed." }, 405);
}

function localeForPath(pathname) {
  if (pathname.endsWith("-th")) return "th";
  if (pathname.endsWith("-id") || pathname.endsWith("-vi")) return "id";
  return "zh";
}

function favoriteAddon(locale) {
  const copy = {
    zh: { add: "加入收藏", remove: "取消收藏", auth: "請從 LINE 開啟後再收藏", failed: "收藏更新失敗", filter: "收藏", noFavorite: "目前沒有符合條件的收藏店家" },
    id: { add: "Tambah favorit", remove: "Hapus favorit", auth: "Buka dari LINE untuk menyimpan favorit", failed: "Gagal memperbarui favorit", filter: "Favorit", noFavorite: "Tidak ada toko favorit yang sesuai" },
    th: { add: "เพิ่มรายการโปรด", remove: "ยกเลิกรายการโปรด", auth: "กรุณาเปิดจาก LINE เพื่อบันทึกรายการโปรด", failed: "อัปเดตรายการโปรดไม่สำเร็จ", filter: "รายการโปรด", noFavorite: "ไม่มีร้านโปรดที่ตรงเงื่อนไข" },
  }[locale] || null;

  return `<style id="sakura-favorite-style">
.favorite-heart{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:-2px 0;color:#e32636;font-size:23px;line-height:1;font-weight:900;cursor:pointer;user-select:none}.favorite-heart.busy{opacity:.45;pointer-events:none}.favorite-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);z-index:90;background:#071a33;color:#fff;border-radius:999px;padding:9px 13px;font-size:13px;font-weight:800;opacity:0;pointer-events:none;transition:.16s}.favorite-toast.show{opacity:1;transform:translate(-50%,0)}
.filters.sakura-favorite-filter-ready{grid-template-columns:repeat(4,minmax(0,1fr))}.favorite-filter-wrap{display:block}.favorite-filter-wrap label{display:block;font-size:11px;color:#526984;margin:0 0 3px;font-weight:800}.favorite-filter-btn{width:100%;min-height:38px;border:1px solid #cbd8ea;border-radius:10px;background:#fff;color:#df1748;font-size:14px;font-weight:800;padding:7px 6px;cursor:pointer;white-space:nowrap}.favorite-filter-btn.active{background:#ffe9ef;border-color:#f6a8bb;color:#d41445}.favorite-filter-btn .heart{font-size:18px;vertical-align:-1px;margin-right:3px}@media(max-width:430px){.filters.sakura-favorite-filter-ready{grid-template-columns:repeat(3,minmax(0,1fr))}.favorite-filter-wrap{grid-column:1/-1}.favorite-filter-btn{min-height:36px}}
</style>
<script id="sakura-favorite-addon">
(function(){
  const LIFF_ID=${JSON.stringify(SAKURA_LIFF_ID)};
  const API=${JSON.stringify(FAVORITES_API_PATH)};
  const COPY=${JSON.stringify(copy)};
  let token="";
  let favorites=new Set();
  let favoritesLoaded=false;
  let favoriteOnly=false;
  let currentStore=null;
  let sdkPromise=null;

  function sid(s){return String(s&&s.id||"").trim()}
  function toast(msg){let el=document.getElementById("sakuraFavoriteToast");if(!el){el=document.createElement("div");el.id="sakuraFavoriteToast";el.className="favorite-toast";document.body.appendChild(el)}el.textContent=msg;el.classList.add("show");clearTimeout(window.__favToast);window.__favToast=setTimeout(()=>el.classList.remove("show"),1500)}
  function loadSdk(){if(window.liff)return Promise.resolve();if(sdkPromise)return sdkPromise;sdkPromise=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://static.line-scdn.net/liff/edge/2/sdk.js";s.async=true;s.onload=resolve;s.onerror=reject;document.body.appendChild(s)});return sdkPromise}
  async function ensureToken(interactive){if(token)return token;try{await loadSdk();await liff.init({liffId:LIFF_ID});if(!liff.isLoggedIn()){if(interactive)liff.login({redirectUri:location.href});return ""}token=liff.getIDToken()||"";return token}catch(_){if(interactive)toast(COPY.auth);return ""}}
  function updateHeart(h,store){const active=favorites.has(sid(store));const next=active?"♥":"♡";if(h.textContent!==next)h.textContent=next;h.title=active?COPY.remove:COPY.add;h.setAttribute("aria-label",h.title)}
  function updateFilterButton(){const b=document.getElementById("favoriteFilterBtn");if(!b)return;b.classList.toggle("active",favoriteOnly);b.innerHTML='<span class="heart">'+(favoriteOnly?'♥':'♡')+'</span>'+COPY.filter;b.setAttribute("aria-pressed",favoriteOnly?'true':'false')}
  function applyFavoriteFilter(){const stores=window.__visibleStores||[];const cards=document.querySelectorAll("#grid .card");let visibleCount=0;cards.forEach((card,i)=>{const store=stores[i];const show=!favoriteOnly||(store&&favorites.has(sid(store)));card.style.display=show?'':'none';if(show)visibleCount++});const empty=document.getElementById("empty");if(empty){if(!empty.dataset.favoriteOriginalText)empty.dataset.favoriteOriginalText=empty.textContent||'';if(favoriteOnly&&visibleCount===0){empty.textContent=COPY.noFavorite;empty.style.display='block'}else if(favoriteOnly){empty.style.display='none'}else{empty.textContent=empty.dataset.favoriteOriginalText}}
  async function loadFavorites(interactive){if(favoritesLoaded)return true;const t=await ensureToken(!!interactive);if(!t)return false;try{const r=await fetch(API+"?ts="+Date.now(),{headers:{authorization:"Bearer "+t},cache:"no-store"});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||COPY.failed);favorites=new Set(Array.isArray(d.favorites)?d.favorites.map(String):[]);favoritesLoaded=true;refresh();return true}catch(e){if(interactive)toast(e&&e.message||COPY.failed);return false}}
  async function toggle(store,h){const id=sid(store);if(!id)return;const t=await ensureToken(true);if(!t)return;const desired=!favorites.has(id);h.classList.add("busy");try{const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+t},body:JSON.stringify({store_id:id,favorite:desired})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||COPY.failed);if(desired)favorites.add(id);else favorites.delete(id);favoritesLoaded=true;refresh()}catch(e){toast(e&&e.message||COPY.failed)}finally{h.classList.remove("busy")}}
  function makeHeart(store){const h=document.createElement("span");h.className="favorite-heart";h.dataset.storeId=sid(store);h.setAttribute("role","button");h.setAttribute("tabindex","0");updateHeart(h,store);const activate=function(e){e.preventDefault();e.stopPropagation();if(!h.classList.contains("busy"))toggle(store,h)};h.addEventListener("click",activate);h.addEventListener("pointerdown",function(e){e.stopPropagation()});h.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" ")activate(e)});return h}
  function bindCard(card,store){if(card.dataset.favoriteCardBound===sid(store))return;card.dataset.favoriteCardBound=sid(store);card.addEventListener("click",function(){currentStore=store;setTimeout(decorateSheet,0)})}
  function decorateCards(){const stores=window.__visibleStores||[];const cards=document.querySelectorAll("#grid .card");cards.forEach((card,i)=>{const store=stores[i];if(!store)return;bindCard(card,store);const cat=card.querySelector(".pill.cat");if(!cat)return;let h=card.querySelector(".favorite-heart");if(!h||h.dataset.storeId!==sid(store)){if(h)h.remove();h=makeHeart(store);cat.insertAdjacentElement("afterend",h)}else updateHeart(h,store)});applyFavoriteFilter()}
  function decorateSheet(){const tags=document.getElementById("sheetTags");if(!tags||!currentStore)return;const cat=tags.querySelector(".pill.cat");if(!cat)return;let h=tags.querySelector(".favorite-heart");if(!h||h.dataset.storeId!==sid(currentStore)){if(h)h.remove();h=makeHeart(currentStore);cat.insertAdjacentElement("afterend",h)}else updateHeart(h,currentStore)}
  function refresh(){decorateCards();decorateSheet();updateFilterButton();applyFavoriteFilter()}
  function ensureFilterControl(){const filters=document.querySelector(".filters");if(!filters||document.getElementById("favoriteFilterBtn"))return;const wrap=document.createElement("div");wrap.className="favorite-filter-wrap";const label=document.createElement("label");label.textContent=COPY.filter;const btn=document.createElement("button");btn.id="favoriteFilterBtn";btn.type="button";btn.className="favorite-filter-btn";btn.setAttribute("aria-pressed","false");btn.innerHTML='<span class="heart">♡</span>'+COPY.filter;btn.addEventListener("click",async function(e){e.preventDefault();e.stopPropagation();if(!favoriteOnly){const ok=await loadFavorites(true);if(!ok)return}favoriteOnly=!favoriteOnly;updateFilterButton();applyFavoriteFilter()});wrap.appendChild(label);wrap.appendChild(btn);filters.appendChild(wrap);filters.classList.add("sakura-favorite-filter-ready")}

  ["keyword","categoryFilter","regionFilter","businessFilter"].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener(id==="keyword"?"input":"change",()=>setTimeout(()=>{decorateCards();applyFavoriteFilter()},0))});

  ensureFilterControl();
  let tries=0;const timer=setInterval(()=>{tries++;ensureFilterControl();decorateCards();if(document.querySelector("#grid .card")||tries>=16){clearInterval(timer);setTimeout(()=>loadFavorites(false),300)}},250);
})();
</script>`;
}

async function handlePartnerStorePage(request, env, ctx, pathname) {
  const response = await worker.fetch(request, env, ctx);
  if (!response || !response.ok) return response;
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html")) return response;
  const html = await response.text();
  const addon = favoriteAddon(localeForPath(pathname));
  const next = html.includes("</body>") ? html.replace("</body>", addon + "</body>") : html + addon;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(next, { status: response.status, statusText: response.statusText, headers });
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