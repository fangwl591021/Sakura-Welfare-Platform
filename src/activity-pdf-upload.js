import { ACTIVITY_PDF_MAX_BYTES, extractActivityImport } from "./activity-import.js";

const filesUrl = "https://api.openai.com/v1/files";
const uploadError = (message, status = 400) => Object.assign(new Error(message), { status });

export async function extractActivityPdf(request, env, callAiContent, fetchApi = fetch) {
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > ACTIVITY_PDF_MAX_BYTES)) {
    throw uploadError("PDF 請使用 50 MB 以下的檔案。", 413);
  }
  if (!request.body || length === "0") throw uploadError("檔案不可為空。");
  if (!env.OPENAI_API_KEY || typeof callAiContent !== "function") throw new Error("AI unavailable");
  const reader = request.body.getReader();
  const uploadSignal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  let size = 0, completed = false, fileId = null, streamError = null;
  const initial = [], magic = new Uint8Array(5);
  const onAbort = () => { reader.cancel().catch(() => {}); };
  uploadSignal.addEventListener("abort", onAbort, { once: true });
  try {
    while (size < 5) {
      uploadSignal.throwIfAborted();
      const { value, done } = await reader.read();
      uploadSignal.throwIfAborted();
      if (done) throw uploadError(size ? "檔案不是有效的 PDF。" : "檔案不可為空。");
      if (size + value.byteLength > ACTIVITY_PDF_MAX_BYTES) throw uploadError("PDF 請使用 50 MB 以下的檔案。", 413);
      magic.set(value.subarray(0, 5 - size), size);
      size += value.byteLength; initial.push(value);
    }
    if (new TextDecoder().decode(magic) !== "%PDF-") throw uploadError("檔案不是有效的 PDF。");

    const boundary = "sakura-" + crypto.randomUUID();
    const encoder = new TextEncoder();
    const field = (name, value) => "--" + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + "\r\n";
    const prefix = encoder.encode(field("purpose", "user_data") + field("expires_after[anchor]", "created_at") + field("expires_after[seconds]", "3600")
      + "--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="activity.pdf"\r\nContent-Type: application/pdf\r\n\r\n');
    const suffix = encoder.encode("\r\n--" + boundary + "--\r\n");
    let prefixSent = false;
    // Stream multipart bytes with backpressure; FormData or base64 would buffer the whole PDF.
    const body = new ReadableStream({
      async pull(controller) {
        try {
          uploadSignal.throwIfAborted();
          if (!prefixSent) { prefixSent = true; controller.enqueue(prefix); return; }
          if (initial.length) { controller.enqueue(initial.shift()); return; }
          const { done, value } = await reader.read();
          uploadSignal.throwIfAborted();
          if (done) {
            if (length !== null && size !== Number(length)) throw uploadError("檔案上傳不完整，請重新選取。");
            completed = true; controller.enqueue(suffix); controller.close(); return;
          }
          size += value.byteLength;
          if (size > ACTIVITY_PDF_MAX_BYTES) throw uploadError("PDF 請使用 50 MB 以下的檔案。", 413);
          controller.enqueue(value);
        } catch (error) { streamError = error; controller.error(error); await reader.cancel().catch(() => {}); }
      },
      cancel() { return reader.cancel(); }
    }, { highWaterMark: 0 });
    const uploaded = await fetchApi(filesUrl, {
      method: "POST", headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "multipart/form-data; boundary=" + boundary },
      body, signal: uploadSignal, duplex: "half"
    }).catch(error => { throw streamError || error; });
    if (!uploaded.ok) throw new Error("AI file upload failed");
    const payload = await uploaded.json();
    if (typeof payload.id !== "string" || !/^file-[a-zA-Z0-9_-]{1,200}$/.test(payload.id)) throw new Error("Invalid uploaded file");
    fileId = payload.id;
    if (!completed || payload.bytes !== size) throw new Error("Incomplete file upload");
    uploadSignal.removeEventListener("abort", onAbort);
    request.signal.throwIfAborted();
    return await extractActivityImport(env, { type: "application/pdf", fileId }, callAiContent, 90000, request.signal);
  } finally {
    uploadSignal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    if (fileId) {
      try {
        const removed = await fetchApi(filesUrl + "/" + fileId, {
          method: "DELETE", headers: { Authorization: "Bearer " + env.OPENAI_API_KEY }, signal: AbortSignal.timeout(10000)
        });
        if (!removed.ok || (await removed.json()).deleted !== true) throw new Error("Cleanup failed");
      } catch { console.warn("Activity PDF temporary file cleanup failed; one-hour expiry remains active"); }
    }
  }
}
