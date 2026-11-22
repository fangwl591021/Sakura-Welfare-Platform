import { ACTIVITY_TUTORIALS, VENDOR_TUTORIALS } from "./activity-tutorial-media.js";

// Keep browser code literal to avoid bundler helpers leaking into inline scripts.
const installTutorials = String.raw`function installActivityTutorials(tutorials) {
  const dialog = document.getElementById('at-dialog');
  const video = document.getElementById('at-video');
  const status = document.getElementById('at-status');
  const title = document.getElementById('at-title');
  const link = document.getElementById('at-open');
  let trigger, selected, startAt = 0;
  const topics = [
    [document.getElementById('eventForm')?.closest('.panel')?.querySelector('h2'), 'create', 0, '新增／編輯活動'],
    [document.getElementById('ai-import-title'), 'create', 29, '從 DM／PDF 新增活動'],
    [document.getElementById('ac-title'), 'create', 68.3, '活動封面／DM'],
    [document.getElementById('af-registration-heading'), 'create', 126, '活動報名 QR 與網址'],
    [document.querySelector('#af-section .af-top h2'), 'form', 0, '報名自填欄位'],
    [document.querySelector('label[for="af-requirements"]'), 'form', 30.7, 'AI 欄位需求'],
    [document.querySelector('#af-section .af-preview h3'), 'form', 97.4, '報名表預覽'],
    [document.getElementById('af-rules')?.previousElementSibling, 'form', 109.5, '人數驗證'],
    [document.getElementById('aq-heading'), 'checkin', 0, '活動 QR 核銷'],
    [document.querySelector('label[for="activity-checkin-keyword"]'), 'keyword', 0, 'LINE 簽到關鍵字'],
    [document.getElementById('af-roster-heading'), 'roster', 0, '報名名單'],
    [document.getElementById('af-roster-dialog-title'), 'roster', 0, '報名名單查詢與下載'],
    [document.getElementById('admin-access-heading'), 'adminAccess', 0, '後台帳號與 LINE 輔助登入'],
    [document.getElementById('vendor-page-editor-heading'), 'vendorPage', 0, '編輯自己的店家頁面'],
    [document.querySelector('#br-pos-workspace h2'), 'branchQr', 0, '分店 QR 掃碼核銷']
  ];
  function load() {
    status.textContent = '影片載入中…';
    video.src = selected.path;
    video.load();
  }
  function attach(heading, episode, time, name) {
    if (!heading || !tutorials[episode] || heading.parentElement?.classList.contains('at-heading')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'at-help';
    button.textContent = '▶ 操作教學';
    button.setAttribute('aria-label', '操作教學：' + name);
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'at-dialog');
    button.dataset.tutorial = episode;
    // A button must not be inside a label: that could also focus/change its input.
    const host = document.createElement('div'); host.className = 'at-heading';
    heading.before(host); host.append(heading, button);
    button.onclick = () => {
      trigger = button; selected = tutorials[episode]; startAt = time;
      title.textContent = selected.title; link.href = selected.path + '#t=' + time;
      dialog.showModal(); load();
    };
  }
  for (const topic of topics) attach(...topic);
  const vendorView = document.getElementById('view');
  if (vendorView) {
    const attachVendor = () => {
      for (const heading of vendorView.querySelectorAll('[aria-label="廠商 LINE 帳號"] h3')) attach(heading, 'operators', 0, '廠商新增操作人');
    };
    attachVendor();
    new MutationObserver(attachVendor).observe(vendorView, { childList: true, subtree: true });
  }
  window.SakuraTutorials = { attach };
  video.onloadedmetadata = () => {
    if (!dialog.open) return;
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(startAt, Math.max(0, video.duration - 1));
    status.textContent = '';
    video.play().catch(() => { if (dialog.open) status.textContent = '請按播放鍵開始觀看。'; });
  };
  video.onerror = () => { if (dialog.open) status.textContent = '影片暫時無法播放，請重試或另開影片。'; };
  document.getElementById('at-retry').onclick = load;
  document.getElementById('at-close').onclick = () => dialog.close();
  dialog.onclick = event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
  };
  dialog.addEventListener('close', () => {
    video.pause(); video.removeAttribute('src'); video.load(); status.textContent = '';
    trigger?.focus({ preventScroll: true });
  });
}`;

export function decorateActivityTutorialHtml(html) {
  if (html.includes('id="at-dialog"')) return html;
  const tutorials = Object.fromEntries(Object.entries({...ACTIVITY_TUTORIALS, ...VENDOR_TUTORIALS}).map(([id, item]) => [id, { title: item.title, path: item.path }]));
  const style = `<style>
    .panel>.at-heading{padding:12px 16px;border-bottom:1px solid #dbe3ee}.panel>.at-heading>h2{padding:0;border:0}
    #af-roster>.at-heading{padding-right:16px}#af-roster>.at-heading>#af-roster-heading{flex:1 1 220px}#af-roster>.at-heading>.at-help{margin:8px 0 8px 16px}
    .at-heading{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}.at-heading>h2,.at-heading>h3{flex:0 1 auto;min-width:0}.at-heading>label{margin:0}.at-help{display:inline-flex!important;align-items:center;flex:0 0 auto;width:auto!important;min-height:36px!important;padding:5px 9px!important;font:normal 13px/1.4 "Microsoft JhengHei",sans-serif!important;color:#165e93!important;background:#fff!important;border:1px solid #cedce8!important;border-radius:5px!important;cursor:pointer;white-space:nowrap}.at-help:focus-visible,#at-dialog button:focus-visible{outline:3px solid #2877c9;outline-offset:2px}
    #at-dialog{width:min(960px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);box-sizing:border-box;padding:0;border:1px solid #cedce8;border-radius:8px;background:#fff;color:#142b36;overflow:auto}#at-dialog::backdrop{background:#0009}#at-dialog .at-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;position:sticky;top:0;background:#fff;z-index:1}#at-title{margin:0;flex:1;font-size:18px;line-height:1.4;overflow-wrap:anywhere}#at-close{width:40px;height:40px;flex:0 0 40px;padding:0;border:1px solid #cedce8;border-radius:5px;background:#fff;font-size:26px;cursor:pointer}#at-video{display:block;width:100%;aspect-ratio:16/9;max-height:65dvh;background:#111}#at-dialog .at-footer{padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:14px}#at-status{flex:1 1 250px;margin:0}#at-retry{width:auto;padding:6px 12px;background:#fff;border:1px solid #cedce8;border-radius:5px;cursor:pointer}#at-open{color:#165e93}
  </style>`;
  const modal = `<dialog id="at-dialog" aria-labelledby="at-title"><div class="at-bar"><h2 id="at-title">操作教學</h2><button type="button" id="at-close" aria-label="關閉操作教學" title="關閉操作教學">×</button></div><video id="at-video" controls playsinline preload="none" aria-label="活動操作教學影片"></video><div class="at-footer"><p id="at-status" role="status" aria-live="polite"></p><button type="button" id="at-retry">重新載入</button><a id="at-open" target="_blank" rel="noopener">另開影片</a></div></dialog>`;
  return html.replace("</head>", style + "</head>").replace("</body>", modal + `<script>(${installTutorials})(${JSON.stringify(tutorials)});</script></body>`);
}

export function renderVendorTutorialPage(topic = 'branchQr') {
  const selected = Object.hasOwn(VENDOR_TUTORIALS, topic) ? topic : 'branchQr';
  const tutorial = VENDOR_TUTORIALS[selected];
  const description = selected === 'operators'
    ? '由管理員提供廠商共用序號，讓同店人員在 LINE 完成關聯。核銷仍使用原有廠商登入。'
    : '店員選分店並展示 QR，用戶用 LINE 掃碼發起消費，店員核對後才完成核銷。';
  const tabs = Object.entries(VENDOR_TUTORIALS).map(([key, item]) => `<a href="/vendor-tutorials?topic=${key}"${key === selected ? ' aria-current="page"' : ''}>${item.title}</a>`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${tutorial.title}｜櫻花福委會操作教學</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#10263b;font:18px/1.65 system-ui,"Microsoft JhengHei",sans-serif}header{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #dbe3ee;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px}header strong{font-size:18px}button,a{font:inherit}button{padding:9px 16px;border:1px solid #b7c5d2;border-radius:8px;background:#fff;color:#15374b;cursor:pointer}main{max-width:1000px;margin:auto;padding:24px 20px 40px}h1{font-size:30px;line-height:1.4;margin:20px 0 12px}nav{display:flex;flex-wrap:wrap;gap:10px}nav a{padding:9px 14px;border:1px solid #b7c5d2;border-radius:8px;color:#164c70;background:white;text-decoration:none}nav a[aria-current]{background:#14394c;color:#fff}p{margin:12px 0;color:#3b5366}video{display:block;background:#111;width:100%;aspect-ratio:16/9;border-radius:10px;margin:20px 0}.actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.actions a{color:#145e8b}.note{font-size:16px}button:focus-visible,a:focus-visible{outline:3px solid #2877c9;outline-offset:2px}@media(max-width:480px){h1{font-size:25px}main{padding:18px 14px}header{padding:10px 14px}nav a{font-size:16px}}
  </style></head><body><header><strong>櫻花福委會操作教學</strong><button type="button" id="tutorial-back">返回／關閉</button></header><main><nav aria-label="教學主題">${tabs}</nav><h1>${tutorial.title}</h1><p>${description}</p><video id="vendor-tutorial-video" controls playsinline preload="none" src="${tutorial.path}" aria-label="${tutorial.title}教學影片"></video><p id="tutorial-status" role="status" aria-live="polite">按播放即可觀看，影片含中文旁白與字幕。</p><div class="actions"><button id="tutorial-retry" type="button" hidden>重新載入影片</button><a href="${tutorial.path}" target="_blank" rel="noopener">另開影片</a></div><p class="note">影片中的店家、帳號及交易皆為示範資料。</p></main><script>
  const video=document.getElementById('vendor-tutorial-video'),status=document.getElementById('tutorial-status'),retry=document.getElementById('tutorial-retry');
  video.addEventListener('error',()=>{status.textContent='影片暫時無法播放，請重新載入或另開影片。';retry.hidden=false;});
  video.addEventListener('playing',()=>{status.textContent='';retry.hidden=true;});
  retry.onclick=()=>{status.textContent='影片載入中…';retry.hidden=true;video.load();video.play().catch(()=>{status.textContent='請按播放鍵開始觀看。';});};
  document.getElementById('tutorial-back').onclick=()=>{video.pause();if(history.length>1)history.back();else{window.close();setTimeout(()=>{location.href='/vendor-portal';},150);}};
  </script></body></html>`;
}
