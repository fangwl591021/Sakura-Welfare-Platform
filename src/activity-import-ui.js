import { ACTIVITY_PDF_MAX_BYTES } from "./activity-import.js";

export const activityImportPanel = `<section id="ai-import" aria-labelledby="ai-import-title">
  <h3 id="ai-import-title">從 DM／PDF 新增活動</h3>
  <label for="ai-import-file">PDF 50 MB 以下／圖片 5 MB 以內</label>
  <input id="ai-import-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf">
  <img id="ai-import-image" alt="活動 DM 預覽" hidden>
  <p class="ai-import-privacy">檔案將交由平台 AI 辨識，請勿上傳敏感個資。PDF 暫存檔於辨識後刪除，最遲 1 小時到期。</p>
  <div class="ai-import-actions"><button id="ai-import-read" class="btn red" type="button" disabled>AI 辨識活動</button><button id="ai-import-cancel" class="btn" type="button" hidden>取消</button></div>
  <div id="ai-import-status" role="status" aria-live="polite"></div>
  <a id="ai-import-login" href="/sakura-admin?reauth=1" target="_blank" rel="noopener" hidden>管理員登入</a>
  <section id="ai-import-result" hidden><h3>辨識結果</h3><dl id="ai-import-fields"></dl><ul id="ai-import-warnings"></ul><button id="ai-import-apply" class="btn green" type="button">帶入新增活動</button></section>
</section>`;

export const activityImportStyles = `<style>
  #ai-import{border-bottom:1px solid #dbe3ee;padding:0 0 18px;margin-bottom:18px;min-width:0}
  #ai-import h3{font-size:16px;margin:10px 0}#ai-import label{display:block;margin-bottom:8px}
  #ai-import input{width:100%;max-width:100%;box-sizing:border-box;font-size:14px}
  #ai-import input::file-selector-button{font:inherit;padding:8px 10px;margin-right:8px;border:1px solid #dbe3ee;border-radius:6px;background:#fff;color:#071226;cursor:pointer}
  #ai-import-image{display:block;width:100%;max-height:240px;object-fit:contain;margin-top:12px}
  .ai-import-privacy{font-size:12px;color:#586878;line-height:1.5}
  .ai-import-actions{display:flex;gap:8px;flex-wrap:wrap}#ai-import button{min-height:40px;border-radius:6px;font-family:inherit}#ai-import button:disabled{opacity:.55;cursor:wait}
  #ai-import-status{margin-top:10px;line-height:1.6;overflow-wrap:anywhere}
  #ai-import-fields{font-size:14px;line-height:1.6}#ai-import-fields dt{font-weight:700;margin-top:8px}
  #ai-import-fields dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
  #ai-import-warnings{padding-left:20px;color:#964512;font-size:13px;line-height:1.6}
  #ai-import [hidden]{display:none!important}
</style>`;

// Keep browser code literal: bundler-generated helpers cannot cross into inline scripts.
export const installActivityImport = String.raw`function installActivityImport(headers, cover) {
  const el = id => document.getElementById("ai-import-" + id);
  const form = document.getElementById("eventForm");
  const labels = { title: "活動名稱", location: "地點", description: "活動內容", start_at: "活動開始", end_at: "活動結束", checkin_start_at: "報到開始", checkin_end_at: "報到結束" };
  let file = null, result = null, generation = 0, controller = null, preview = null, timer = null;
  function status(text) { el("status").textContent = text; }
  function stop(message) {
    generation++; controller?.abort(); controller = null; clearTimeout(timer);
    el("read").disabled = !file; el("file").disabled = false; el("cancel").hidden = true;
    el("read").textContent = "AI 辨識活動";
    if (message) status(message);
  }
  el("file").onchange = () => {
    stop(); result = null; el("result").hidden = true; el("login").hidden = true;
    if (preview) URL.revokeObjectURL(preview);
    preview = null; el("image").hidden = true; el("image").removeAttribute("src");
    file = el("file").files[0] || null;
    if (file && !file.size) {
      file = null; status("檔案不可為空。");
    } else if (file && file.size > (file.type === "application/pdf" ? ${ACTIVITY_PDF_MAX_BYTES} : 5 * 1024 * 1024)) {
      status(file.type === "application/pdf" ? "PDF 請使用 50 MB 以下的檔案。" : "圖片不得超過 5 MB。"); file = null;
    } else if (file && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      file = null; status("請選取 JPG、PNG、WebP 或 PDF。");
    } else {
      status(file ? "已選取：" + file.name : "");
      if (file?.type.startsWith("image/")) {
        preview = URL.createObjectURL(file); el("image").src = preview; el("image").hidden = false;
      }
    }
    el("read").disabled = !file;
  };
  el("cancel").onclick = () => stop("已取消辨識，原表單未變更。");
  el("read").onclick = async () => {
    if (!file || controller) return;
    const current = ++generation, selected = file;
    controller = new AbortController(); const signal = controller.signal;
    el("read").disabled = true; el("file").disabled = true; el("cancel").hidden = false;
    el("read").textContent = "辨識中…"; el("result").hidden = true; el("login").hidden = true;
    const isPdf = selected.type === "application/pdf";
    result = null; status(isPdf ? "PDF 上傳與辨識中…" : "正在辨識活動內容…");
    timer = setTimeout(() => stop("辨識逾時，原表單未變更，請稍後重試。"), isPdf ? 180000 : 60000);
    try {
      const auth = await headers();
      if (current !== generation) return;
      const data = isPdf ? null : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("無法讀取檔案，請重新選取。"));
        reader.readAsDataURL(selected);
      });
      if (current !== generation) return;
      const response = await fetch("/admin-api/activity-import", {
        method: "POST", headers: { ...auth, "Content-Type": isPdf ? "application/pdf" : "application/json" }, signal,
        body: isPdf ? selected : JSON.stringify({ file: { type: selected.type, base64: data } })
      });
      const body = await response.json();
      if (current !== generation) return;
      if (!response.ok || !body.success) {
        el("login").hidden = ![401, 403].includes(response.status);
        throw new Error(body.message || "辨識失敗，原表單未變更。");
      }
      result = body.fields;
      el("fields").replaceChildren(); el("warnings").replaceChildren();
      for (const [key, label] of Object.entries(labels)) {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = label + (key.endsWith("_at") ? "（台北時間）" : "");
        dd.textContent = (key.endsWith("_at") ? result[key]?.replace("T", " ") : result[key]) || "待確認";
        el("fields").append(dt, dd);
      }
      for (const warning of body.warnings || []) {
        const li = document.createElement("li"); li.textContent = warning; el("warnings").append(li);
      }
      el("result").hidden = false;
      status("辨識完成，請確認後帶入新增活動。尚未儲存或上架。");
    } catch (error) {
      if (current === generation) {
        if (error.auth) el("login").hidden = false;
        status(error.message || "辨識失敗，原表單未變更。");
      }
    } finally { if (current === generation) stop(); }
  };
  el("apply").onclick = () => {
    if (!result) return;
    const hasContent = ["id", "title", "location", "description", "start_at", "end_at", "checkin_start_at", "checkin_end_at"].some(key => form.elements.namedItem(key).value);
    if (hasContent && !window.confirm("帶入將取代目前表單內容，另建一筆新活動；不會修改已儲存的活動。要繼續嗎？")) return;
    form.reset(); form.elements.namedItem("id").value = "";
    for (const key of Object.keys(labels)) form.elements.namedItem(key).value = result[key] || "";
    form.elements.namedItem("status").value = "draft";
    if (file && cover) cover.useFile(file);
    el("result").hidden = true; result = null;
    status("已帶入新增活動，狀態為草稿。請確認表單後儲存。");
    form.elements.namedItem("title").focus();
  };
  window.addEventListener("pagehide", () => { stop(); if (preview) URL.revokeObjectURL(preview); });
}`;
