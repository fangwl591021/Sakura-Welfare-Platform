import { lotteryDefaultVideoPath, lotteryVideoAdminPath, maxLotteryVideoBytes } from './activity-lottery-video.js';

export const activityLotteryPanel = `<div id="activity-lottery-entry" class="ae-attendance-only">
  <button id="activity-lottery-open" class="btn" type="button">抽獎與獎項</button>
</div>`;

export const activityLotteryDialog = `<dialog id="activity-lottery" aria-labelledby="lottery-heading">
  <header class="lottery-header"><div><h2 id="lottery-heading">抽獎與獎項</h2><p id="lottery-event"></p></div><button id="lottery-close" type="button">關閉／返回活動</button></header>
  <p id="lottery-message" role="status" aria-live="polite"></p>
  <div class="lottery-actions"><button id="lottery-refresh" type="button">重新載入</button><button id="lottery-retry" type="button" hidden>重試同一次操作</button></div>
  <section id="lottery-playback" hidden aria-labelledby="lottery-playback-heading">
    <h3 id="lottery-playback-heading">抽獎過場</h3>
    <video id="lottery-player" controls playsinline preload="none" aria-label="抽獎過場影片"></video>
    <div class="lottery-actions"><button id="lottery-skip-video" type="button">略過影片，顯示結果</button></div>
  </section>
  <fieldset id="lottery-workspace" hidden>
    <p id="lottery-attendance" class="lottery-attendance"></p>
    <details open><summary>抽獎設定</summary>
      <form id="lottery-settings" class="lottery-form">
        <label>抽獎資格<select id="lottery-mode"><option value="employee_only">未開放攜眷｜每位員工一個名額</option><option value="with_family">開放攜眷｜依簽到的實到人數</option></select></label>
        <label>中獎規則<select id="lottery-policy"><option value="event_once">全場每個名額最多中一次</option><option value="per_prize">每個獎項各可中一次</option></select></label>
        <button id="lottery-save-settings" type="submit">儲存設定</button>
        <p id="lottery-lock"></p>
      </form>
      <details id="lottery-video-options">
        <summary>抽獎過場影片</summary>
        <p id="lottery-video-status" role="status" aria-live="polite"></p>
        <label for="lottery-video-file">上傳本活動的 MP4（20 MB 以下）</label>
        <input id="lottery-video-file" type="file" accept=".mp4,video/mp4">
        <div class="lottery-actions">
          <button id="lottery-upload-video" type="button" disabled>上傳影片</button>
          <button id="lottery-preview-video" type="button">預覽影片</button>
          <button id="lottery-reset-video" type="button" hidden>恢復預設影片</button>
          <label><input id="lottery-video-sound" type="checkbox">播放音效</label>
        </div>
      </details>
    </details>
    <div class="lottery-columns"><section>
      <h3>獎項管理</h3>
      <form id="lottery-prize-form" class="lottery-form">
        <label>獎項名稱<input id="lottery-prize-name" required maxlength="100"></label>
        <label>名額<input id="lottery-quantity" type="number" min="1" max="1000" step="1" value="1" required></label>
        <div class="lottery-actions"><button id="lottery-prize-save" type="submit">新增獎項</button><button id="lottery-prize-reset" type="button" hidden>取消編輯</button></div>
      </form>
      <div id="lottery-prizes"></div>
    </section><section>
      <h3 id="lottery-results-heading">中獎結果</h3>
      <div class="lottery-actions" id="lottery-exports" hidden><button type="button" data-lottery-export="xlsx">下載 Excel</button><button type="button" data-lottery-export="csv">下載 CSV</button></div>
      <div id="lottery-trial" hidden></div>
      <div id="lottery-results"></div>
      <form id="lottery-redraw" class="lottery-form" hidden>
        <label id="lottery-reason-label" for="lottery-reason">缺席原因</label><input id="lottery-reason" maxlength="200" required>
        <div class="lottery-actions"><button type="submit">確認缺席並補抽</button><button id="lottery-redraw-cancel" type="button">取消</button></div>
      </form>
    </section></div>
  </fieldset>
</dialog>`;

export const activityLotteryStyles = `<style>
#activity-lottery-entry{margin:0 0 12px}
#activity-lottery{color:#182333;width:min(1000px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;border:1px solid #d2dce7;border-radius:14px;padding:20px;background:#fff;box-sizing:border-box}
#activity-lottery::backdrop{background:#111f36a3}
#activity-lottery [hidden]{display:none!important}
.lottery-header,.lottery-actions,.lottery-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.lottery-header{justify-content:space-between;align-items:flex-start}
.lottery-header h2,#lottery-event{margin:0 0 6px}
#lottery-message:not(:empty),.lottery-attendance{padding:10px 12px;background:#eef4fb;border-radius:8px;line-height:1.55}
#lottery-workspace{margin:12px 0 0;border:0;padding:0;min-width:0}
#activity-lottery button{padding:8px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;color:#182333;min-height:40px;font:inherit}
#activity-lottery button[data-primary]{background:#ab1745;color:#fff;border-color:#ab1745}
#activity-lottery button:disabled{opacity:.55;cursor:default}
#activity-lottery details,.lottery-columns>section{padding:12px;border:1px solid #dbe2ea;border-radius:10px;min-width:0}
.lottery-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:12px;margin-top:12px}
.lottery-columns h3{margin:0 0 8px}
.lottery-form{display:grid;align-items:end;gap:8px;margin:8px 0}
.lottery-form input,.lottery-form select{box-sizing:border-box;width:100%;margin:4px 0 0}
#lottery-settings{grid-template-columns:1.4fr 1fr auto}
#lottery-lock{grid-column:1/-1;margin:0;color:#475569}
#lottery-video-options{margin-top:12px}
#lottery-video-file{display:block;max-width:100%;margin:6px 0 10px}
#lottery-playback{margin-top:12px}
#lottery-player{display:block;background:#111827;width:100%;max-height:60vh;margin:0 0 10px;border-radius:8px}
.lottery-row{justify-content:space-between;border-top:1px solid #dbe2ea;padding:10px 0;overflow-wrap:anywhere}
.lottery-row p{margin:4px 0 0;color:#475569}
.lottery-row small{display:block;color:#475569}
#lottery-trial{margin:8px 0;background:#fff5d8;border-radius:8px;padding:10px;overflow-wrap:anywhere}
@media(max-width:680px){#lottery-settings,.lottery-columns{grid-template-columns:1fr}#activity-lottery{padding:12px}}
</style>`;

export const installActivityLottery = String.raw`function installActivityLottery(headers, selectedEvent) {
  const el = id => document.getElementById('lottery-' + id);
  const dialog = document.getElementById('activity-lottery');
  const open = document.getElementById('activity-lottery-open');
  if (!dialog || !open) return;
  const workspace = el('workspace'), status = el('message');
  let data = null, activeId = '', busy = false, pending = null, editing = '', redraw = null, visiblePrize = '';
  let customVideo = null, videoStatusRead = 0, playbackId = 0, videoRequest = null, objectUrl = '';
  const endpoint = '/admin-api/activity-lottery';
  const videoEndpoint = '${lotteryVideoAdminPath}';
  const defaultVideo = '${lotteryDefaultVideoPath}';
  const maxVideoSize = ${maxLotteryVideoBytes};
  const query = () => endpoint + '?event_id=' + encodeURIComponent(activeId);
  const videoQuery = () => videoEndpoint + '?event_id=' + encodeURIComponent(activeId);
  const date = value => new Date(value).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hourCycle:'h23' });
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  function button(label, onClick, disabled = false) {
    const b = node('button', label); b.type = 'button'; b.onclick = onClick; b.disabled = disabled; return b;
  }
  function lock(value) {
    busy = value;
    workspace.disabled = value || !!pending;
    el('retry').disabled = value;
    el('retry').hidden = !pending;
    el('refresh').disabled = value || !el('playback').hidden;
    el('close').disabled = value;
  }
  async function request(url, body) {
    const auth = await headers();
    return fetch(url, { cache:'no-store', signal:AbortSignal.timeout(35000), method:body ? 'POST' : 'GET',
      headers:{...auth, ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {}) });
  }
  async function checked(response) {
    const result = await response.json();
    if (!response.ok || !result.success) throw Object.assign(new Error(result.message || '操作未完成。'), { definite:response.status < 500 });
    return result;
  }
  function renderVideoStatus(message) {
    el('video-status').textContent = message || (customVideo === null ? '正在讀取影片設定…'
      : customVideo ? '目前使用本活動的自訂影片。' : '目前使用系統預設影片。');
    el('reset-video').hidden = customVideo !== true;
    el('upload-video').disabled = !el('video-file').files.length;
  }
  async function videoFetch(url, method = 'GET', file, signal = AbortSignal.timeout(45000)) {
    const auth = await headers();
    return fetch(url, { method, cache:'no-store', signal,
      headers:{...auth, ...(file ? {'Content-Type':'video/mp4'} : {})}, ...(file ? {body:file} : {}) });
  }
  async function readVideoStatus() {
    const requestId = ++videoStatusRead;
    try {
      const result = await checked(await videoFetch(videoQuery() + '&view=status','GET',undefined,AbortSignal.timeout(7000)));
      if (requestId === videoStatusRead && dialog.open) { customVideo = result.custom; renderVideoStatus(); }
    } catch {
      if (requestId === videoStatusRead && dialog.open && customVideo === null) renderVideoStatus('暫時無法讀取影片設定，仍可使用系統預設影片。');
    }
  }
  function finishVideo(message) {
    playbackId++;
    if (videoRequest) videoRequest.abort();
    videoRequest = null;
    const video = el('player');
    video.onended = null; video.onerror = null;
    if (video.hasAttribute('src')) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
    el('playback').hidden = true;
    el('refresh').disabled = busy;
    workspace.hidden = !data;
    if (message) status.textContent = message;
  }
  async function playVideo(preview = false) {
    const token = ++playbackId, video = el('player');
    const failure = () => { if (token === playbackId) finishVideo('影片無法播放，已回到抽獎頁面。'); };
    workspace.hidden = true; el('playback').hidden = false; el('refresh').disabled = true;
    el('skip-video').textContent = preview ? '結束預覽' : '略過影片，顯示結果';
    el('skip-video').focus();
    let source = defaultVideo;
    if (customVideo === null) await readVideoStatus();
    if (token !== playbackId || !dialog.open) return;
    if (customVideo === true) {
      const controller = new AbortController();
      videoRequest = controller;
      try {
        const response = await videoFetch(videoQuery(),'GET',undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
        if (response.ok) {
          const blob = await response.blob();
          if (token !== playbackId || !dialog.open) return;
          objectUrl = URL.createObjectURL(blob); source = objectUrl;
        }
      } catch { /* Use the bundled default when custom media is temporarily unavailable. */ }
    }
    if (token !== playbackId || !dialog.open) return;
    video.muted = !el('video-sound').checked;
    video.onended = () => { if (token === playbackId) finishVideo(); };
    video.onerror = failure;
    video.src = source;
    try { await video.play(); }
    catch (error) {
      if (token !== playbackId) return;
      if (error.name !== 'NotAllowedError') { failure(); return; }
      video.muted = true;
      try { await video.play(); } catch { failure(); }
    }
  }
  async function changeVideo(file) {
    if (busy || !data) return;
    if (file && (!/\.mp4$/i.test(file.name) || file.size < 12 || file.size > maxVideoSize)) {
      renderVideoStatus('請選擇 20 MB 以下的 MP4 影片。'); return;
    }
    videoStatusRead++;
    lock(true);
    renderVideoStatus(file ? '影片上傳中…' : '正在恢復預設影片…');
    try {
      const result = await checked(await videoFetch(videoQuery(),file ? 'PUT' : 'DELETE',file));
      customVideo = result.custom; el('video-file').value = '';
      renderVideoStatus(file ? '已上傳，本活動將使用自訂影片。' : '已恢復系統預設影片。');
    } catch (error) { renderVideoStatus(error.message || '影片操作未確認，請重新載入後核對。'); }
    finally { lock(false); }
  }
  function resetPrize() {
    editing = ''; el('prize-form').reset(); el('prize-reset').hidden = true; el('prize-save').textContent = '新增獎項';
  }
  function closeRedraw() { redraw = null; el('redraw').hidden = true; el('redraw').reset(); }
  function paintAttendance() {
    const { attendance, attendancePreview, frozenAt, mode } = data;
    const preview = attendancePreview?.mode === el('mode').value ? attendancePreview : null;
    const count = preview || attendance, family = (preview?.mode || mode) === 'with_family';
    el('attendance').textContent = (preview ? '預覽（尚未儲存）｜' : frozenAt ? '已鎖定｜' : '目前｜')
      + '可列入名單 ' + count.people + ' 人（員工 ' + count.groups + ' 人、眷屬 ' + count.companions + ' 人）'
      + (family && count.unknown ? '。有 ' + count.unknown + ' 筆簽到未記錄實到人數，各計入員工本人 1 人。' : '');
  }
  function paint() {
    const { event, attendance, frozenAt, prizes, winners, trial, policy, mode } = data;
    workspace.hidden = false;
    const family = mode === 'with_family';
    el('event').textContent = event.title;
    el('mode').value = mode; el('policy').value = policy;
    paintAttendance();
    for (const id of ['mode','policy','save-settings']) el(id).disabled = !!frozenAt;
    el('lock').textContent = frozenAt ? '首次開獎於 ' + date(frozenAt) + ' 鎖定名單與中獎規則。' : '首次正式開獎時會鎖定這場活動的簽到名單與規則。';
    if (!visiblePrize || !prizes.some(p => p.id === visiblePrize)) visiblePrize = prizes[0]?.id || '';
    const prizeList = el('prizes'), results = el('results');
    prizeList.replaceChildren(); results.replaceChildren();
    if (!prizes.length) prizeList.append(node('p','請先新增獎項。'));
    for (const prize of prizes) {
      const row = node('div',''); row.className = 'lottery-row';
      const description = node('div',''); description.append(node('strong',prize.name), node('p','已抽 ' + prize.drawn + '／' + prize.quantity + ' 位 · 目前可抽 ' + prize.eligible + ' 人'));
      const actions = node('div',''); actions.className = 'lottery-actions';
      const needed = prize.quantity - prize.drawn;
      if (prizes.length > 1) {
        const select = button('查看結果', () => { visiblePrize = prize.id; data.trial = null; closeRedraw(); paint(); }, visiblePrize === prize.id);
        actions.append(select);
      }
      if (needed) {
        actions.append(button('編輯', () => {
          editing=prize.id; el('prize-name').value=prize.name; el('quantity').value=prize.quantity; el('prize-save').textContent='儲存獎項'; el('prize-reset').hidden=false; el('prize-name').focus();
        }, needed !== prize.quantity));
        actions.append(button('試抽', () => {
          if (el('mode').value !== mode || el('policy').value !== policy) {
            status.textContent = '抽獎設定尚未儲存，請先儲存後再試抽。'; return;
          }
          visiblePrize = prize.id; closeRedraw(); send({action:'trial',prize_id:prize.id});
        }, needed > prize.eligible));
        const draw = button('正式抽出 ' + needed + ' 位', () => {
          if (el('mode').value !== mode || el('policy').value !== policy) {
            status.textContent = '抽獎設定尚未儲存，請先儲存後再正式抽獎。'; return;
          }
          const unknown = !frozenAt && family && attendance.unknown;
          const notes = unknown ? '\n其中 ' + unknown + ' 筆缺少實到人數，各只計員工本人一名。' : '';
          if (!window.confirm('確認從 ' + prize.eligible + ' 個名額抽出「' + prize.name + '」' + needed + ' 位？' + notes)) return;
          visiblePrize = prize.id; closeRedraw();
          send({action:'draw',prize_id:prize.id,confirmed:true,confirmedUnknown:!!unknown});
        }, needed > prize.eligible);
        draw.dataset.primary = ''; actions.append(draw);
      }
      row.append(description,actions); prizeList.append(row);
    }
    const active = prizes.find(prize => prize.id === visiblePrize);
    el('results-heading').textContent = active ? active.name + '｜中獎結果' : '中獎結果';
    el('exports').hidden = !winners.length;
    el('trial').hidden = !trial;
    el('trial').textContent = trial ? '試抽（未存檔） ' + trial.map(row => row.label + '〔' + row.code + '〕').join('、') : '';
    const rows = winners.filter(row => row.prizeId === visiblePrize);
    const byId = new Map(rows.map(row => [row.id,row]));
    if (!rows.length) results.append(node('p','尚無正式中獎結果。'));
    for (const winner of rows) {
      const row = node('div',''); row.className = 'lottery-row';
      const label = node('div','');
      label.append(node('strong', winner.label + '〔' + winner.code + '〕'),
        node('small',(winner.ordinal ? '眷屬' : '員工') + ' · ' + {drawn:'待領獎',claimed:'已領獎',absent:'缺席'}[winner.status]
        + (winner.replaces ? ' · 補抽 ' + byId.get(winner.replaces)?.code : '') + (winner.reason ? ' · ' + winner.reason : '')));
      row.append(label);
      if (winner.status === 'drawn') {
        const actions = node('div',''); actions.className = 'lottery-actions';
        actions.append(button('確認領獎', () => {
          if (window.confirm('確認「' + winner.label + '〔' + winner.code + '〕」已領獎？')) send({action:'claim',prize_id:winner.prizeId,winner_id:winner.id});
        }), button('缺席補抽', () => {
          redraw = winner; el('reason-label').textContent = winner.label + '〔' + winner.code + '〕的缺席原因';
          el('redraw').hidden = false; el('reason').focus();
        }, active.eligible < 1));
        row.append(actions);
      }
      results.append(row);
    }
  }
  async function load() {
    lock(true); status.textContent = '正在載入抽獎資料…';
    try { data = await checked(await request(query())); pending = null; closeRedraw(); resetPrize(); paint(); status.textContent = ''; }
    catch (error) { status.textContent = error.message; }
    finally { lock(false); if (data) await readVideoStatus(); }
  }
  async function send(values) {
    if (busy || (!pending && !values)) return;
    const body = pending || {...values, event_id:activeId, revision:data.revision, rosterVersion:data.rosterVersion, request_id:crypto.randomUUID()};
    lock(true); status.textContent = '處理中…';
    try {
      data = await checked(await request(endpoint,body)); pending = null;
      if (body.action === 'save_prize') resetPrize();
      closeRedraw(); paint();
      status.textContent = data.replayed ? '已讀回前次操作結果。' : body.action === 'trial' ? '試抽完成。'
        : ({draw:'正式中獎名單已儲存。',redraw:'已保留原紀錄並補抽一位。',claim:'已確認領獎。'})[body.action] || '已儲存。';
      if (!data.replayed && ['trial','draw','redraw'].includes(body.action)) void playVideo();
    } catch (error) {
      pending = error.definite || body.action === 'trial' ? null : body;
      status.textContent = pending ? '尚未確認操作結果。請重試同一次操作，或重新載入核對。' : error.message;
    } finally { lock(false); }
  }
  open.onclick = () => {
    const selected = selectedEvent();
    if (!selected) { window.alert('請先選擇活動。'); return; }
    data = null; activeId = selected.id; pending = null; visiblePrize = ''; workspace.hidden = true; customVideo = null; videoStatusRead++;
    el('video-file').value = ''; el('video-options').open = false; renderVideoStatus();
    el('event').textContent = selected.title; dialog.showModal(); load();
  };
  el('close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => finishVideo());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  el('refresh').onclick = load;
  el('retry').onclick = () => send();
  el('prize-reset').onclick = resetPrize;
  el('redraw-cancel').onclick = closeRedraw;
  el('skip-video').onclick = () => finishVideo();
  el('video-file').onchange = () => { el('upload-video').disabled = !el('video-file').files.length; };
  el('upload-video').onclick = () => { const file = el('video-file').files[0]; if (file) void changeVideo(file); };
  el('reset-video').onclick = () => { if (window.confirm('確定移除本活動的自訂影片並恢復預設？')) void changeVideo(); };
  el('preview-video').onclick = () => { if (!busy) void playVideo(true); };
  el('mode').onchange = paintAttendance;
  el('settings').onsubmit = event => {
    event.preventDefault(); send({action:'save_settings',mode:el('mode').value,policy:el('policy').value});
  };
  el('prize-form').onsubmit = event => {
    event.preventDefault(); send({action:'save_prize',prize_id:editing,name:el('prize-name').value,quantity:Number(el('quantity').value)});
  };
  el('redraw').onsubmit = event => {
    event.preventDefault();
    if (redraw) send({action:'redraw',prize_id:redraw.prizeId,winner_id:redraw.id,reason:el('reason').value,confirmed:true});
  };
  for (const b of el('exports').querySelectorAll('button')) b.onclick = async () => {
    lock(true);
    try {
      const format = b.dataset.lotteryExport, response = await request(query() + '&export=' + format);
      if (!response.ok) await checked(response);
      const url = URL.createObjectURL(await response.blob()), link = node('a','');
      link.href = url; link.download = data.event.title + '-抽獎紀錄.' + format;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
    } catch (error) { status.textContent = error.message; }
    finally { lock(false); }
  };
}`;
