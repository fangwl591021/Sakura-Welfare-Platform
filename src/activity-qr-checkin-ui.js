const installActivityQrScript = String.raw`function installActivityQrWorkspace() {
  const el = id => document.getElementById('aq-' + id);
  let preview = null, busy = false, generation = 0, stream = null, timer = 0, decoderPromise, scanning = false;
  const status = message => { el('status').textContent = message; };
  function clearPreview() { preview = null; el('preview').hidden = true; el('confirm').disabled = true; el('ack').checked = false; }
  function stopCamera() { generation++; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; el('video').srcObject = null; el('camera').hidden = true; scanning = false; }
  async function api(body) {
    const headers = await window.activityCover.headers();
    const response = await fetch('/admin-api/activity-qr-checkin' + (body ? '' : '?event_id=' + encodeURIComponent(el('event').value)), {
      method: body ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.message || '無法完成核銷。');
    return result;
  }
  function counts(summary) {
    el('registered').textContent = summary ? summary.registered_count : '—';
    el('checked').textContent = summary ? summary.checkin_count : '—';
  }
  async function refresh() {
    if (busy) return; busy = true; clearPreview(); stopCamera(); status('正在載入活動…');
    try {
      const result = await api(); el('event').replaceChildren(new Option('選擇活動', ''));
      for (const event of result.events) el('event').append(new Option(event.title, event.id));
      el('event').value = result.selected_event_id; counts(result.summary);
      status(!result.open_count ? '目前沒有簽到時段內的活動。' : result.selected_event_id ? '活動已帶入，請掃描報名者個人 QR。' : '有多個活動可簽到，請先選擇活動。');
    } catch (error) { status(error.message); counts(null); } finally { busy = false; }
  }
  async function inspect(raw) {
    if (busy) return; stopCamera(); clearPreview();
    if (!el('event').value) { status('請先選擇活動。'); return; }
    if (!raw.trim()) { status('請掃描或貼上個人 QR 內容。'); return; }
    busy = true; el('event').disabled = true; status('正在檢查報名與簽到時間…');
    try {
      const eventId = el('event').value, result = await api({ action: 'preview', event_id: eventId, qr: raw });
      if (el('qr').value !== raw) { status('QR 內容已變更，請重新查詢。'); return; }
      preview = { ...result.preview, qr: raw }; el('person').textContent = preview.display_name;
      el('title').textContent = preview.event_title; el('preview').hidden = false;
      status(preview.already_checked_in ? '已完成簽到：' + preview.checked_at + '，不會重複核銷。' : '報名與簽到時間符合，請核對本人姓名後確認。');
    } catch (error) { status(error.message); } finally { busy = false; el('event').disabled = false; }
  }
  async function decoder() {
    if (typeof window.jsQR === 'function') return;
    if (!decoderPromise) decoderPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      const timeout = setTimeout(() => { s.remove(); reject(new Error('掃碼工具載入逾時，請改用貼上 QR 內容。')); }, 15000);
      s.onload = () => { clearTimeout(timeout); typeof window.jsQR === 'function' ? resolve() : reject(new Error('掃碼工具無法使用。')); };
      s.onerror = () => { clearTimeout(timeout); reject(new Error('掃碼工具載入失敗，請改用貼上 QR 內容。')); }; document.head.append(s);
    }).catch(error => { decoderPromise = null; throw error; });
    return decoderPromise;
  }
  function decodeImage(image, width, height) {
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(width, height));
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(pixels.data, pixels.width, pixels.height)?.data || '';
  }
  el('start').onclick = () => { el('section').hidden = false; el('section').scrollIntoView({ block: 'start' }); refresh(); };
  el('close').onclick = () => { if (busy) return; stopCamera(); clearPreview(); el('qr').value = ''; el('section').hidden = true; el('start').focus(); };
  el('refresh').onclick = refresh; el('event').onchange = () => { clearPreview(); el('qr').value = ''; refresh(); };
  el('qr').oninput = clearPreview; el('lookup').onclick = () => inspect(el('qr').value);
  el('ack').onchange = () => { el('confirm').disabled = busy || !preview || preview.already_checked_in || !el('ack').checked; };
  el('confirm').onclick = async () => {
    if (busy || !preview || preview.already_checked_in || !el('ack').checked) return;
    if (preview.qr !== el('qr').value || preview.event_id !== el('event').value) { clearPreview(); status('資料已變更，請重新掃碼。'); return; }
    busy = true; el('confirm').disabled = true; el('event').disabled = true; status('正在核銷…');
    const current = preview;
    try {
      const result = await api({ action: 'confirm', event_id: current.event_id, qr: current.qr, registration_id: current.registration_id, confirmed: true });
      clearPreview(); el('qr').value = ''; counts(result.summary);
      status(result.message + ' ' + result.data.display_name + ' · ' + result.data.checked_at + (result.summary ? '' : '（統計暫時無法更新，請重新整理）'));
      // Refresh the existing dashboard only after commit; it does not submit either editor.
      if (typeof window.load === 'function') window.load(current.event_id).catch(() => {});
    } catch (error) { clearPreview(); status(error.message + ' 請重新掃碼確認結果。'); }
    finally { busy = false; el('event').disabled = false; }
  };
  el('scan').onclick = async () => {
    if (busy || scanning) return;
    if (!el('event').value) { status('請先選擇活動。'); return; }
    clearPreview(); stopCamera(); scanning = true; const seq = generation;
    try {
      await api(); // Authorize before opening a camera or reading a QR.
      if (seq !== generation) return;
      if (window.liff?.isInClient?.() && typeof liff.scanCodeV2 === 'function') {
        const result = await liff.scanCodeV2(); scanning = false;
        if (seq !== generation) return;
        if (result?.value) { el('qr').value = result.value; await inspect(result.value); } else status('已取消掃碼。');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('此瀏覽器不支援相機，請使用 QR 圖片或貼上 QR 內容。');
      await decoder(); if (seq !== generation) return;
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (seq !== generation) { media.getTracks().forEach(t => t.stop()); return; }
      stream = media; el('camera').hidden = false; el('video').srcObject = stream; await el('video').play(); status('請將個人 QR 放入畫面。');
      const tick = async () => {
        if (seq !== generation) return;
        const video = el('video');
        try { if (video.videoWidth) { const value = decodeImage(video, video.videoWidth, video.videoHeight); if (value) { el('qr').value = value; await inspect(value); return; } } }
        catch { stopCamera(); status('無法解析影像，請改用 QR 圖片或貼上內容。'); return; }
        timer = setTimeout(tick, 300);
      }; tick();
    } catch { stopCamera(); status('掃碼取消或相機無法使用，請選擇 QR 圖片或貼上 QR 內容。'); }
  };
  el('stop').onclick = () => { stopCamera(); status('已停止掃碼。'); };
  el('file').onchange = async () => {
    const file = el('file').files[0]; el('file').value = ''; if (!file || busy) return;
    stopCamera(); clearPreview(); const seq = generation;
    if (file.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { status('請選擇 5 MB 以內的 QR 圖片。'); return; }
    try { await api(); await decoder(); const image = await createImageBitmap(file);
      try { if (seq !== generation) return; const value = decodeImage(image, image.width, image.height); if (!value) throw new Error('找不到 QR。'); el('qr').value = value; await inspect(value); } finally { image.close(); }
    } catch { status('無法讀取 QR 圖片，請重試或貼上 QR 內容。'); }
  };
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
}`;

export function decorateActivityQrWorkspace(html) {
  const panel = `<section id="aq-section" hidden aria-labelledby="aq-heading"><header><h2 id="aq-heading">活動 QR 核銷</h2><button id="aq-close" type="button" aria-label="關閉核銷工作台" title="關閉核銷工作台">×</button></header>
    <div class="aq-toolbar"><label for="aq-event">活動</label><select id="aq-event"><option value="">選擇活動</option></select><button id="aq-refresh" type="button" aria-label="重新整理核銷統計" title="重新整理核銷統計">↻</button><a href="/sakura-admin?reauth=1" target="_blank" rel="noopener">管理員登入</a></div>
    <div class="aq-counts"><span>報名 <strong id="aq-registered">—</strong></span><span>已簽到 <strong id="aq-checked">—</strong></span></div>
    <div class="aq-toolbar"><button id="aq-scan" type="button">掃描個人 QR</button><label class="aq-file">讀取 QR 圖片<input id="aq-file" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
    <div id="aq-camera" hidden><video id="aq-video" autoplay playsinline muted></video><button id="aq-stop" type="button">停止掃碼</button></div>
    <label for="aq-qr">個人 QR 內容</label><div class="aq-toolbar"><input id="aq-qr" maxlength="4096" autocomplete="off" spellcheck="false"><button id="aq-lookup" type="button">查詢報名</button></div>
    <div id="aq-preview" hidden><h3 id="aq-title"></h3><p id="aq-person"></p><label><input type="checkbox" id="aq-ack">已核對現場本人與報名姓名</label><button id="aq-confirm" type="button" disabled>確認核銷出席</button></div><p id="aq-status" role="status" aria-live="polite"></p></section>`;
  const style = `<style>#aq-section{margin-top:24px;padding:20px;background:#fff;border-top:2px solid #d31848;scroll-margin-top:16px}#aq-section header{display:flex;align-items:center;justify-content:space-between;gap:12px}#aq-heading{font-size:20px;margin:0}#aq-section button,#aq-section select,#aq-qr{font:inherit;min-height:42px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:8px 12px;max-width:100%}#aq-close{font-size:24px!important;width:42px;flex-shrink:0}#aq-section button{cursor:pointer}#aq-section button:disabled{opacity:.5;cursor:not-allowed}.aq-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0}#aq-event,#aq-qr{flex:1;min-width:160px}#aq-qr{width:100%}.aq-counts{display:flex;gap:28px;padding:12px 0;border-block:1px solid #e0e7ed}.aq-counts strong{font-size:24px;margin-left:8px}#aq-scan,#aq-confirm{background:#d31848!important;color:#fff}.aq-file{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.aq-file input{max-width:100%;width:240px}#aq-camera{max-width:480px}#aq-video{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#111}#aq-preview{padding:16px 0;border-block:1px solid #e0e7ed}#aq-title{font-size:18px}#aq-person{font-size:22px;font-weight:700}#aq-preview label{display:block;margin-bottom:14px}#aq-status{line-height:1.7;overflow-wrap:anywhere}#aq-section [hidden]{display:none!important}</style>`;
  return html.replace('</head>', style + '</head>')
    .replace('<a href="#af-section">報名自填欄位</a>', '<a href="#af-section">報名自填欄位</a> <button type="button" class="btn" id="aq-start">開始核銷</button>')
    .replace('</main>', panel + '</main>')
    .replace('async function api(path,opt){const r=await fetch(path,opt||{});', 'async function api(path,opt){const h=await window.activityCover.headers();const r=await fetch(path,{...(opt||{}),headers:{...h,...(opt?.headers||{})}});')
    .replace('load().catch(e=>toast(e.message));', 'window.addEventListener("DOMContentLoaded",()=>load().catch(e=>toast(e.message)));')
    .replace('</body>', '<script>(' + installActivityQrScript + ')();</script></body>');
}
