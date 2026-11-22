export const activityCoverPanel = `<section id="ac-cover" aria-labelledby="ac-title"><h3 id="ac-title">活動封面／DM</h3>
  <input type="hidden" name="cover_image_url"><input type="hidden" name="cover_image_key">
  <label for="ac-file">選擇圖片或 PDF</label><input id="ac-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf">
  <img id="ac-preview" alt="活動封面預覽" hidden><div class="ac-actions"><button id="ac-remove" type="button" class="btn" hidden>移除封面</button><a id="ac-login" href="/sakura-admin?reauth=1" target="_blank" rel="noopener" hidden>管理員登入</a></div>
  <p id="ac-status" role="status" aria-live="polite">尚未設定活動封面。</p></section>`;

export const activityCoverStyles = `<style>
  #ac-cover{border-bottom:1px solid #dbe3ee;padding-bottom:16px;margin-bottom:16px;min-width:0}#ac-cover h3{font-size:16px;margin:0 0 12px}
  #ac-cover input[type=file]{width:100%;max-width:100%;font:inherit}#ac-preview{display:block;width:100%;max-height:400px;object-fit:contain;margin:12px 0}
  #ac-cover p{font-size:14px;line-height:1.6;overflow-wrap:anywhere}.ac-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ac-actions a{color:#1661ab}
  #ac-cover [hidden]{display:none!important}
</style>`;

export const installActivityCover = String.raw`function installActivityCover(headers) {
  const form = document.getElementById("eventForm"), el = id => document.getElementById("ac-" + id);
  const urlField = form.elements.namedItem("cover_image_url"), keyField = form.elements.namedItem("cover_image_key");
  let pending = null, preview = "", sequence = 0, converting = false, saving = false, pdfModule;
  const status = text => { el("status").textContent = text; };
  function picture(url) {
    if (preview) { URL.revokeObjectURL(preview); preview = ""; }
    el("preview").hidden = !url; el("remove").hidden = !url;
    if (url) el("preview").src = url; else el("preview").removeAttribute("src");
  }
  function reset(event = {}) {
    sequence++; converting = false; pending = null; el("file").value = ""; el("login").hidden = true;
    urlField.value = event.cover_image_url || ""; keyField.value = event.cover_image_key || "";
    picture(urlField.value); status(urlField.value ? "已載入活動封面。" : "尚未設定活動封面。");
  }
  async function pdfCover(file, current) {
    const base = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/";
    if (!pdfModule) pdfModule = import(base + "legacy/build/pdf.min.mjs").catch(error => { pdfModule = null; throw error; });
    let moduleTimer;
    const pdfjs = await Promise.race([pdfModule, new Promise((_, reject) => { moduleTimer = setTimeout(() => reject(new Error("PDF 工具載入逾時。")), 15000); })]).finally(() => clearTimeout(moduleTimer));
    if (current !== sequence) throw new Error("封面已切換。");
    pdfjs.GlobalWorkerOptions.workerSrc = base + "legacy/build/pdf.worker.min.mjs";
    const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
      cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/" });
    let timer;
    try {
      const work = (async () => {
        const document = await loading.promise, page = await document.getPage(1);
        const size = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1800 / Math.max(size.width, size.height));
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
        await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, background: "rgb(255,255,255)" }).promise;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
        canvas.width = 0; canvas.height = 0;
        if (!blob) throw new Error("無法轉換封面。");
        return new File([blob], "activity-cover.jpg", { type: "image/jpeg" });
      })();
      return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("PDF 轉圖逾時。")), 30000); })]);
    } finally { clearTimeout(timer); await loading.destroy().catch(() => {}); }
  }
  async function useFile(file) {
    if (!file) return;
    const current = ++sequence;
    converting = false;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || !file.size
      || file.size > (file.type === "application/pdf" ? 49999999 : 8 * 1024 * 1024)) {
      status("請選擇 8 MB 以內的 JPG／PNG／WebP，或 50 MB 以下的 PDF。原封面保留。"); return;
    }
    converting = true; status(file.type === "application/pdf" ? "正在將 PDF 第一頁轉成封面…" : "正在載入圖片…");
    try {
      const image = file.type === "application/pdf" ? await pdfCover(file, current) : file;
      if (current !== sequence) return;
      const check = await createImageBitmap(image); check.close();
      if (current !== sequence) return;
      pending = image; urlField.value = ""; keyField.value = "";
      picture(""); preview = URL.createObjectURL(image); el("preview").src = preview;
      el("preview").hidden = false; el("remove").hidden = false;
      status(file.type === "application/pdf" ? "PDF 第一頁已設為封面，儲存活動後生效。" : "圖片已選取，儲存活動後生效。");
    } catch {
      if (current === sequence) status("封面處理失敗，原封面保留。請另選圖片；活動文字不受影響。");
    } finally { if (current === sequence) converting = false; }
  }
  async function prepare() {
    if (converting) throw new Error("封面仍在處理，請稍候再儲存。");
    if (!pending) return;
    const current = sequence, selected = pending, auth = await headers();
    if (current !== sequence) throw new Error("活動或封面已切換，未送出儲存。");
    if (!auth.Authorization) { el("login").hidden = false; throw new Error("請先登入管理後台，再上傳活動封面。"); }
    status("正在上傳活動封面…");
    const body = new FormData(); body.set("file", selected);
    const response = await fetch("/workspace-api/upload", { method: "POST", headers: auth, body, signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (current !== sequence) throw new Error("活動或封面已切換，未送出儲存。");
    if (!response.ok || !result.success) {
      el("login").hidden = false; throw new Error(result.message || "封面上傳失敗，尚未儲存活動。");
    }
    urlField.value = result.data.coverImageUrl; keyField.value = result.data.coverImageKey;
    pending = null; picture(urlField.value);
  }
  el("file").onchange = () => useFile(el("file").files[0]);
  el("remove").onclick = () => { reset(); status("封面已移除，儲存活動後生效。"); };
  const originalFill = window.fill;
  window.fill = function(event) { originalFill(event); reset(event); };
  form.addEventListener("reset", () => reset());
  const originalSubmit = form.onsubmit;
  form.onsubmit = async event => {
    event.preventDefault(); if (saving) return;
    saving = true; const current = sequence; status("正在儲存活動…");
    try {
      await prepare();
      if (current !== sequence) throw new Error("活動或封面已切換，未送出儲存。");
      const result = await originalSubmit(event);
      if (current === sequence) {
        if (result?.data?.event?.id) form.elements.namedItem("id").value = result.data.event.id;
        status("活動與封面已儲存。");
      }
    }
    catch (error) { if (current === sequence) status(error.message || "儲存失敗，請稍後重試。"); }
    finally { saving = false; }
  };
  window.addEventListener("pagehide", () => { sequence++; if (preview) URL.revokeObjectURL(preview); });
  return { useFile, headers };
}`;
