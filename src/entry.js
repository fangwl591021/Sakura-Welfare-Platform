import worker from "./index.js";

const SAKURA_LIFF_ID = "2009117474-pwyW1R4u";
const SAKURA_LINE_LOGIN_CHANNEL_ID = "2009117474";
const FAVORITES_API_PATH = "/api/partner-store-favorites";
const PARTNER_STORE_PATHS = new Set(["/partner-stores", "/partner-stores-id", "/partner-stores-vi", "/partner-stores-th"]);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" } });
}
function getBearerToken(request) {
  const header = String(request.headers.get("authorization") || "").trim();
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}
async function verifyLineIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!token) return null;
  const body = new URLSearchParams({ id_token: token, client_id: SAKURA_LINE_LOGIN_CHANNEL_ID });
  try {
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!response.ok) return null;
    const data = await response.json();
    const userId = String(data && data.sub || "").trim();
    return userId ? { userId } : null;
  } catch (_) { return null; }
}
async function handleFavoriteApi(request, env) {
  if (!env.DB) return jsonResponse({ success: false, message: "D1 binding DB is not configured." }, 500);
  const identity = await verifyLineIdToken(getBearerToken(request));
  if (!identity) return jsonResponse({ success: false, message: "LINE 身分驗證失敗，請從 LINE 重新開啟。" }, 401);
  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare("SELECT store_id FROM welfare_store_favorites WHERE line_user_id = ? ORDER BY created_at DESC").bind(identity.userId).all();
      return jsonResponse({ success: true, favorites: (result.results || []).map(r => String(r.store_id || "")).filter(Boolean) });
    } catch (error) { return jsonResponse({ success: false, message: "收藏資料尚未就緒。", detail: String(error && error.message || error) }, 500); }
  }
  if (request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch (_) { return jsonResponse({ success: false, message: "請提供有效的 JSON。" }, 400); }
    const storeId = String(payload && payload.store_id || "").trim();
    if (!storeId || storeId.length > 200 || typeof payload.favorite !== "boolean") return jsonResponse({ success: false, message: "收藏參數無效。" }, 400);
    try {
      if (payload.favorite) await env.DB.prepare("INSERT OR IGNORE INTO welfare_store_favorites (line_user_id, store_id, created_at) VALUES (?, ?, ?)").bind(identity.userId, storeId, new Date().toISOString()).run();
      else await env.DB.prepare("DELETE FROM welfare_store_favorites WHERE line_user_id = ? AND store_id = ?").bind(identity.userId, storeId).run();
      return jsonResponse({ success: true, store_id: storeId, favorite: payload.favorite });
    } catch (error) { return jsonResponse({ success: false, message: "收藏更新失敗。", detail: String(error && error.message || error) }, 500); }
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
    zh: { add:"加入收藏", remove:"取消收藏", auth:"請從 LINE 開啟後再收藏", failed:"收藏更新失敗", filter:"收藏", address:"搜尋地址", noFavorite:"目前沒有符合條件的收藏店家" },
    id: { add:"Tambah favorit", remove:"Hapus favorit", auth:"Buka dari LINE untuk menyimpan favorit", failed:"Gagal memperbarui favorit", filter:"Favorit", address:"Cari alamat", noFavorite:"Tidak ada toko favorit yang sesuai" },
    th: { add:"เพิ่มรายการโปรด", remove:"ยกเลิกรายการโปรด", auth:"กรุณาเปิดจาก LINE เพื่อบันทึกรายการโปรด", failed:"อัปเดตรายการโปรดไม่สำเร็จ", filter:"รายการโปรด", address:"ค้นหาที่อยู่", noFavorite:"ไม่มีร้านโปรดที่ตรงเงื่อนไข" }
  }[locale];
  return `<style id="sakura-favorite-style">
.favorite-heart{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:-2px 0;color:#e32636;font-size:23px;line-height:1;font-weight:900;cursor:pointer;user-select:none}.favorite-heart.busy{opacity:.45;pointer-events:none}.favorite-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);z-index:90;background:#071a33;color:#fff;border-radius:999px;padding:9px 13px;font-size:13px;font-weight:800;opacity:0;pointer-events:none;transition:.16s}.favorite-toast.show{opacity:1;transform:translate(-50%,0)}
.sakura-search-row{display:grid;grid-template-columns:minmax(0,1fr) 108px;gap:9px;margin-top:14px}.sakura-search-row .search{margin-top:0}.favorite-filter-btn{border:1px solid #f3a5b7;border-radius:14px;background:#fff;color:#df1748;font-size:15px;font-weight:900;cursor:pointer;white-space:nowrap}.favorite-filter-btn.active{background:#ffe9ef;border-color:#e32636;color:#d41445}.address-search{width:100%;margin-top:9px;border:1px solid #cbd8ea;border-radius:14px;padding:12px 14px;font-size:16px}.filters{grid-template-columns:repeat(3,minmax(0,1fr))!important}.favorite-filter-wrap{display:none!important}@media(max-width:390px){.sakura-search-row{grid-template-columns:minmax(0,1fr) 92px;gap:7px}.favorite-filter-btn{font-size:14px}.address-search{font-size:15px}}
</style><script id="sakura-favorite-addon">(function(){
const LIFF_ID=${JSON.stringify(SAKURA_LIFF_ID)},API=${JSON.stringify(FAVORITES_API_PATH)},COPY=${JSON.stringify(copy)};let token="",favorites=new Set(),favoritesLoaded=false,favoriteOnly=false,currentStore=null,sdkPromise=null;
const sid=s=>String(s&&s.id||"").trim();
function toast(msg){let e=document.getElementById("sakuraFavoriteToast");if(!e){e=document.createElement("div");e.id="sakuraFavoriteToast";e.className="favorite-toast";document.body.appendChild(e)}e.textContent=msg;e.classList.add("show");clearTimeout(window.__favToast);window.__favToast=setTimeout(()=>e.classList.remove("show"),1500)}
function loadSdk(){if(window.liff)return Promise.resolve();if(sdkPromise)return sdkPromise;sdkPromise=new Promise((ok,bad)=>{const s=document.createElement("script");s.src="https://static.line-scdn.net/liff/edge/2/sdk.js";s.async=true;s.onload=ok;s.onerror=bad;document.body.appendChild(s)});return sdkPromise}
async function ensureToken(interactive){if(token)return token;try{await loadSdk();await liff.init({liffId:LIFF_ID});if(!liff.isLoggedIn()){if(interactive)liff.login({redirectUri:location.href});return""}token=liff.getIDToken()||"";return token}catch(_){if(interactive)toast(COPY.auth);return""}}
function updateHeart(h,s){const a=favorites.has(sid(s));h.textContent=a?"♥":"♡";h.title=a?COPY.remove:COPY.add}
function updateFilter(){const b=document.getElementById("favoriteFilterBtn");if(b){b.classList.toggle("active",favoriteOnly);b.innerHTML=(favoriteOnly?"♥ ":"♡ ")+COPY.filter}}
function matchesAddress(s){const q=(document.getElementById("addressFilter")?.value||"").trim().toLowerCase();if(!q)return true;return [s&&s.city,s&&s.district,s&&s.address].filter(Boolean).join(" ").toLowerCase().includes(q)}
function applyExtraFilters(){const stores=window.__visibleStores||[],cards=document.querySelectorAll("#grid .card");let n=0;cards.forEach((card,i)=>{const s=stores[i],show=!!s&&matchesAddress(s)&&(!favoriteOnly||favorites.has(sid(s)));card.style.display=show?"":"none";if(show)n++});const empty=document.getElementById("empty");if(empty&&favoriteOnly&&n===0){empty.textContent=COPY.noFavorite;empty.style.display="block"}else if(empty&&n>0)empty.style.display="none"}
async function loadFavorites(interactive){if(favoritesLoaded)return true;const t=await ensureToken(interactive);if(!t)return false;try{const r=await fetch(API+"?ts="+Date.now(),{headers:{authorization:"Bearer "+t},cache:"no-store"}),d=await r.json();if(!r.ok||!d.success)throw Error(d.message||COPY.failed);favorites=new Set((d.favorites||[]).map(String));favoritesLoaded=true;refresh();return true}catch(e){if(interactive)toast(e.message||COPY.failed);return false}}
async function toggle(s,h){const t=await ensureToken(true);if(!t)return;const id=sid(s),desired=!favorites.has(id);h.classList.add("busy");try{const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+t},body:JSON.stringify({store_id:id,favorite:desired})}),d=await r.json();if(!r.ok||!d.success)throw Error(d.message||COPY.failed);desired?favorites.add(id):favorites.delete(id);favoritesLoaded=true;refresh()}catch(e){toast(e.message||COPY.failed)}finally{h.classList.remove("busy")}}
function makeHeart(s){const h=document.createElement("span");h.className="favorite-heart";h.dataset.storeId=sid(s);updateHeart(h,s);h.onclick=e=>{e.preventDefault();e.stopPropagation();toggle(s,h)};h.onpointerdown=e=>e.stopPropagation();return h}
function decorateCards(){const stores=window.__visibleStores||[];document.querySelectorAll("#grid .card").forEach((card,i)=>{const s=stores[i];if(!s)return;card.onclick=(()=>{const old=card.onclick;return function(e){currentStore=s;if(old)return old.call(this,e)}})();const cat=card.querySelector(".pill.cat");if(!cat)return;let h=card.querySelector(".favorite-heart");if(!h||h.dataset.storeId!==sid(s)){if(h)h.remove();h=makeHeart(s);cat.after(h)}else updateHeart(h,s)});applyExtraFilters()}
function refresh(){decorateCards();updateFilter();applyExtraFilters()}
function setupSearchArea(){const hero=document.querySelector(".hero"),keyword=document.getElementById("keyword");if(!hero||!keyword||document.getElementById("favoriteFilterBtn"))return;keyword.placeholder=keyword.placeholder.replace(/、?地址/g,"");const row=document.createElement("div");row.className="sakura-search-row";keyword.parentNode.insertBefore(row,keyword);row.appendChild(keyword);const fav=document.createElement("button");fav.type="button";fav.id="favoriteFilterBtn";fav.className="favorite-filter-btn";fav.innerHTML="♡ "+COPY.filter;fav.onclick=async e=>{e.preventDefault();if(!favoriteOnly&&!await loadFavorites(true))return;favoriteOnly=!favoriteOnly;updateFilter();applyExtraFilters()};row.appendChild(fav);const addr=document.createElement("input");addr.id="addressFilter";addr.className="address-search";addr.placeholder=COPY.address;addr.addEventListener("input",applyExtraFilters);row.after(addr);document.querySelectorAll(".favorite-filter-wrap").forEach(e=>e.remove())}
["keyword","categoryFilter","regionFilter","businessFilter"].forEach(id=>{const e=document.getElementById(id);if(e)e.addEventListener(id==="keyword"?"input":"change",()=>setTimeout(decorateCards,0))});setupSearchArea();let tries=0,t=setInterval(()=>{tries++;setupSearchArea();decorateCards();if(document.querySelector("#grid .card")||tries>16){clearInterval(t);setTimeout(()=>loadFavorites(false),300)}},250);
})();</script>`;
}
async function handlePartnerStorePage(request, env, ctx, pathname) {
  const response = await worker.fetch(request, env, ctx); if (!response || !response.ok) return response;
  const type=String(response.headers.get("content-type")||"").toLowerCase(); if(!type.includes("text/html"))return response;
  const html=await response.text(),addon=favoriteAddon(localeForPath(pathname)),next=html.includes("</body>")?html.replace("</body>",addon+"</body>"):html+addon;
  const headers=new Headers(response.headers);headers.delete("content-length");headers.set("cache-control","no-store");return new Response(next,{status:response.status,statusText:response.statusText,headers});
}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname===FAVORITES_API_PATH&&(request.method==="GET"||request.method==="POST"))return handleFavoriteApi(request,env);if(request.method==="GET"&&PARTNER_STORE_PATHS.has(url.pathname))return handlePartnerStorePage(request,env,ctx,url.pathname);return worker.fetch(request,env,ctx)}};
