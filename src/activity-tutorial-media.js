// Only these synthetic, versioned teaching videos are public through this route.
export const ACTIVITY_TUTORIALS = Object.freeze({
  create: { title: "建立活動與 DM／PDF 匯入", path: "/activity-tutorials/activity-create-20260916-v1.mp4", key: "tutorials/activity/activity-create-20260916-v1.mp4" },
  form: { title: "AI 報名欄位設定", path: "/activity-tutorials/activity-form-20260916-v1.mp4", key: "tutorials/activity/activity-form-20260916-v1.mp4" },
  checkin: { title: "管理員掃描個人 QR 核銷出席", path: "/activity-tutorials/activity-checkin-20260916-v1.mp4", key: "tutorials/activity/activity-checkin-20260916-v1.mp4" },
  keyword: { title: "LINE 關鍵字簽到流程", path: "/activity-tutorials/activity-keyword-20260916-v1.mp4", key: "tutorials/activity/activity-keyword-20260916-v1.mp4" },
  roster: { title: "報名名單查詢、下載與列印", path: "/activity-tutorials/activity-roster-20260930-v1.mp4", key: "tutorials/activity/activity-roster-20260930-v1.mp4" },
  lottery: { title: "活動抽獎操作教學", path: "/activity-tutorials/activity-lottery-20261124-v4.mp4", key: "tutorials/activity/activity-lottery-20261124-v4.mp4" },
  adminAccess: { title: "後台帳號與 LINE 輔助登入設定", path: "/activity-tutorials/admin-access-20261001-v1.mp4", key: "tutorials/admin/admin-access-20261001-v1.mp4" },
  vendorPage: { title: "店家編輯自己的店家頁面", path: "/activity-tutorials/vendor-page-20261001-v1.mp4", key: "tutorials/vendor/vendor-page-20261001-v1.mp4" },
  vendorDocuments: { title: "店家上傳文件與客戶下載", path: "/activity-tutorials/vendor-documents-20261004-v1.mp4", key: "tutorials/vendor/vendor-documents-20261004-v1.mp4" }
});

const previousLotteryTutorials = ["activity-lottery-20261124-v2.mp4", "activity-lottery-20261124-v3.mp4"].map(file => ({
  path: "/activity-tutorials/" + file,
  key: "tutorials/activity/" + file,
}));

// Public, synthetic training videos. Exact paths are allowlisted like the existing
// activity tutorials; no arbitrary R2 keys or member data are exposed.
export const PUSH_TUTORIALS = Object.freeze({
  admin: { title: "後台推播操作教學", path: "/activity-tutorials/push-admin-20261102-v1.mp4", key: "tutorials/push/push-admin-20261102-v1.mp4" },
  chat: { title: "聊天室推播操作教學", path: "/activity-tutorials/push-chat-20261102-v1.mp4", key: "tutorials/push/push-chat-20261102-v1.mp4" }
});

export const VENDOR_TUTORIALS = Object.freeze({
  operators: { title: "廠商新增操作人", path: "/activity-tutorials/vendor-operators-20261112-v1.mp4", key: "tutorials/vendor/vendor-operators-20261112-v1.mp4" },
  branchQr: { title: "分店 QR 掃碼核銷", path: "/activity-tutorials/vendor-branch-qr-20261112-v1.mp4", key: "tutorials/vendor/vendor-branch-qr-20261112-v1.mp4" }
});

export async function handleActivityTutorialMedia(request, bucket) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/activity-tutorials/")) return null;
  const tutorial = [...Object.values(ACTIVITY_TUTORIALS), ...Object.values(PUSH_TUTORIALS), ...Object.values(VENDOR_TUTORIALS), ...previousLotteryTutorials].find(item => item.path === path);
  if (!tutorial) return new Response("Not found", { status: 404 });
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  try {
    if (!bucket) throw new Error("Tutorial storage unavailable");
    const metadata = await bucket.head(tutorial.key);
    if (!metadata) return new Response(null, { status: 404 });
    const headers = new Headers({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Length": String(metadata.size) });
    if (metadata.httpEtag) headers.set("ETag", metadata.httpEtag);
    if (request.method === "HEAD") return new Response(null, { headers });
    let range;
    const requested = request.headers.get("Range");
    const ifRange = request.headers.get("If-Range");
    if (requested && (!ifRange || ifRange === metadata.httpEtag)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(requested.trim());
      let start = NaN, end = NaN;
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, metadata.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= metadata.size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}`, "Accept-Ranges": "bytes" } });
      }
      range = { offset: start, length: end - start + 1 };
      headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
      headers.set("Content-Length", String(range.length));
    }
    const object = await bucket.get(tutorial.key, range ? { range } : undefined);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch {
    return new Response(request.method === "HEAD" ? null : "Tutorial temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
