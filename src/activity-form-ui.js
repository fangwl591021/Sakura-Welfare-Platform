// Keep browser source literal so Worker bundling cannot inject server-side helpers.
import { activityImportPanel, activityImportStyles, installActivityImport } from "./activity-import-ui.js";
import { ACTIVITY_COPY, normalizeActivityLocale, activityLocaleBrowser } from "./activity-locale.js";
import { activityCoverPanel, activityCoverStyles, installActivityCover } from "./activity-cover-ui.js";
import { activityKeywordPanel } from "./activity-keyword-ui.js";
import { decorateActivityTutorialHtml } from "./activity-tutorial-ui.js";
import { decorateActivityQrWorkspace } from "./activity-qr-checkin-ui.js";
import { activityLotteryPanel, activityLotteryDialog, activityLotteryStyles, installActivityLottery } from "./activity-lottery-ui.js";

const activityFormWidgets = String.raw`function activityFormWidgets() {
  function node(tag, text, attrs = {}) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }
  function renderForm(root, schema, answers = {}, readonly = false, requiredValidation = true, translate = value => value, lockedFields = []) {
    root.replaceChildren();
    const controls = new Map();
    const groups = new Map();
    for (const field of schema.fields || []) {
      const group = node("div", null, { class: "af-field" });
      const label = node("label", translate(field.label) + (field.required ? " *" : ""));
      group.append(label);
      const id = "af-answer-" + field.id;
      let input;
      if (field.type === "multiselect") {
        input = node("div", null, { class: "af-options", id });
        for (const option of field.options || []) {
          const item = node("label");
          const check = node("input", null, { type: "checkbox", value: option });
          check.checked = Array.isArray(answers[field.id]) && answers[field.id].includes(option);
          item.append(check, document.createTextNode(translate(option)));
          input.append(item);
        }
      } else {
        input = node(field.type === "textarea" ? "textarea" : field.type === "select" ? "select" : "input", null, { id });
        if (field.type === "select") {
          input.append(node("option", translate("請選擇"), { value: "" }));
          for (const option of field.options || []) input.append(node("option", translate(option), { value: option }));
        } else if (field.type !== "textarea") input.type = ["number", "tel"].includes(field.type) ? field.type : "text";
        if (field.type === "number") { input.min = field.min ?? 0; input.max = field.max ?? 10000; input.step = "1"; }
        else input.maxLength = field.type === "textarea" ? 3000 : 300;
        input.value = answers[field.id] ?? "";
        if (lockedFields.includes(field.id) && ["text", "textarea"].includes(field.type)) {
          input.readOnly = true;
          input.setAttribute("aria-readonly", "true");
        }
        label.htmlFor = id;
      }
      group.append(input);
      if (field.help) group.append(node("small", translate(field.help)));
      root.append(group);
      groups.set(field.id, group);
      controls.set(field.id, input);
    }
    const valueOf = field => field.type === "multiselect"
      ? [...controls.get(field.id).querySelectorAll("input:checked")].map(el => el.value)
      : controls.get(field.id).value;
    function update() {
      const visible = new Set();
      for (const field of schema.fields || []) {
        const parent = schema.fields.find(f => f.id === field.showWhen?.field);
        const show = !field.showWhen || (visible.has(parent?.id) && valueOf(parent) === field.showWhen.equals);
        const group = groups.get(field.id), input = controls.get(field.id);
        group.hidden = !show;
        if (show) visible.add(field.id);
        if (field.type === "multiselect") {
          const checks = [...input.querySelectorAll("input")];
          checks.forEach(check => { check.disabled = readonly || !show; check.required = false; });
          if (checks[0]) checks[0].required = requiredValidation && show && !readonly && field.required && !checks.some(c => c.checked);
        } else { input.disabled = readonly || !show; input.required = requiredValidation && show && !readonly && field.required; }
      }
    }
    root.onchange = update;
    update();
    return () => Object.fromEntries((schema.fields || []).filter(f => !groups.get(f.id).hidden).map(f => [f.id, valueOf(f)]));
  }
  return { node, renderForm };
}`;

export const activityEditorSections = String.raw`function installActivityEditorSections(selectEvent, allowEventChange) {
  const requested = new URL(location.href).searchParams.get('section');
  const valid = value => value === 'manage' || value === 'attendance';
  let enabled = false, current = valid(requested) ? requested : 'manage', picker = null;
  let selected = '', events = [], selecting = false;
  const top = document.querySelector('.top'), title = top?.querySelector('h1'), hint = top?.querySelector('.hint');
  const originalTitle = title?.textContent, originalHint = hint?.textContent;
  function closeScanner() {
    const scanner = document.getElementById('aq-section');
    if (!scanner || scanner.hidden) return true;
    document.getElementById('aq-close')?.click();
    if (scanner.hidden) return true;
    const status = document.getElementById('ae-selection-status');
    if (status) status.textContent = '簽到操作正在處理，請完成後再切換。';
    return false;
  }
  function mark(id, className, container) {
    const el = document.getElementById(id);
    const target = container ? el?.closest(container) : el;
    if (target) target.classList.add(className);
  }
  function setSection(section) {
    if (!enabled || !valid(section)) return false;
    if (section !== current && !closeScanner()) return false;
    current = section; document.body.dataset.activityWorkspace = section;
    if (title) title.textContent = section === 'manage' ? '活動管理' : '報名簽到';
    if (hint) hint.textContent = section === 'manage' ? '編輯活動內容、封面與報名欄位；報名名單及出席請切換「報名簽到」。' : '先選擇活動，再查看報名名單、下載名冊或辦理出席簽到。';
    const heading = document.querySelector('.ae-section-heading');
    if (heading) heading.textContent = section === 'manage' ? '活動行事曆與清單' : '報名名單與出席';
    if (window.parent !== window) window.parent.postMessage({type:'sakura-activity-section-changed',section},location.origin);
    return true;
  }
  window.sakuraActivityWorkspace = {setSection};
  function setup() {
    mark('eventForm','ae-management-only','.panel');
    for (const id of ['calendarBox','af-event-list','af-section']) mark(id,'ae-management-only');
    for (const id of ['af-registration','qrPanel','af-roster','af-attendance-heading','aq-start','aq-section']) mark(id,'ae-attendance-only');
    mark('attendanceRows','ae-attendance-only','table');
    const sectionLink = top?.querySelector('a[href="#af-section"]');
    if (sectionLink) sectionLink.classList.add('ae-management-only');
    const listPanel = document.getElementById('eventRows')?.closest('.panel');
    const listHeading = listPanel?.querySelector('h2');
    if (listHeading) { listHeading.dataset.activityOriginalHeading = listHeading.textContent; listHeading.classList.add('ae-section-heading'); }
    picker = document.createElement('section'); picker.id = 'ae-picker'; picker.className = 'field ae-attendance-only';
    const label = document.createElement('label'); label.htmlFor = 'ae-event'; label.textContent = '目前活動';
    const select = document.createElement('select'); select.id = 'ae-event';
    const message = document.createElement('p'); message.id = 'ae-selection-status'; message.setAttribute('role','status');
    picker.append(label,select,message); top.after(picker);
    select.onchange = async () => {
      const next = select.value;
      if (selecting || !enabled || !events.some(row => row.id === next) || next === selected) { select.value = selected; return; }
      if (!closeScanner()) { select.value = selected; return; }
      if (!allowEventChange()) { select.value = selected; return; }
      const previous = selected; selecting = true; select.disabled = true; message.textContent = '正在切換活動…';
      try { await selectEvent(next); message.textContent = ''; }
      catch { select.value = previous; message.textContent = '活動切換未完成，請重新載入活動後再試。'; }
      finally { selecting = false; select.disabled = !enabled || !events.length; }
    };
    const settings = document.getElementById('af-registration-settings');
    if (settings) { const original = settings.onclick; settings.onclick = event => { if (!enabled || setSection('manage')) return original?.call(settings,event); }; }
    const start = document.getElementById('aq-start');
    if (start) { const original = start.onclick; start.onclick = event => {
      if (enabled) {
        const choice = document.getElementById('aq-event'), row = events.find(item => item.id === selected);
        if (choice && row) choice.replaceChildren(new Option(row.title,row.id,true,true));
      }
      return original?.call(start,event);
    }; }
  }
  function update(data) {
    enabled = data?.editor_role === 'activity_editor';
    if (!enabled) {
      delete document.body.dataset.activityWorkspace;
      if (picker) picker.hidden = true;
      if (title) title.textContent = originalTitle;
      if (hint) hint.textContent = originalHint;
      const heading = document.querySelector('.ae-section-heading');
      if (heading) heading.textContent = heading.dataset.activityOriginalHeading;
      return;
    }
    if (!picker) setup(); picker.hidden = false;
    events = Array.isArray(data.events) ? data.events : [];
    selected = data.selected_event_id || events[0]?.id || '';
    const select = document.getElementById('ae-event');
    select.replaceChildren(new Option(events.length ? '選擇活動' : '目前沒有活動',''),...events.map(row => new Option(row.title,row.id)));
    select.value = selected; select.disabled = selecting || !events.length;
    setSection(current);
  }
  return {update};
}`;

const activityEditorSectionStyles = `<style>
body[data-activity-workspace] .wrap{max-width:none;padding:18px}body[data-activity-workspace] .top{gap:12px;flex-wrap:wrap}body[data-activity-workspace] h1{font-size:24px}
body[data-activity-workspace=manage] .ae-attendance-only,body[data-activity-workspace=attendance] .ae-management-only{display:none!important}
body[data-activity-workspace=attendance] .grid{grid-template-columns:minmax(0,1fr)}
body[data-activity-workspace=manage] .grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
body[data-activity-workspace] #ae-picker{padding:16px;background:#fff;border:1px solid #dbe3ee;border-radius:10px;margin-bottom:16px}#ae-picker select{max-width:680px}#ae-selection-status:empty{display:none}
@media(max-width:900px){body[data-activity-workspace=manage] .grid{grid-template-columns:minmax(0,1fr)}body[data-activity-workspace] .wrap{padding:12px}body[data-activity-workspace] .stats{grid-template-columns:repeat(3,minmax(0,1fr))}body[data-activity-workspace] .stat{padding:10px}}
</style>`;

const installActivityFormEditor = String.raw`function installActivityFormEditor(widgets, installImport, installCover, installSections, installLottery) {
  const { node, renderForm } = widgets();
  const $af = id => document.getElementById(id);
  const section = $af("af-section"), select = $af("af-event"), form = $af("af-editor");
  let eventId = "", revision = 0, schema = { version: 1, fields: [], rules: [] };
  let dirty = false, busy = false, sequence = 0, ready = false;
  let rosterSequence = 0;
  const editorSections = installSections(async id => {
    await window.load(id);
    const row = state.events.find(event => event.id === state.selected);
    if (row) window.fill(row);
  }, () => {
    if (busy) return false;
    if (dirty && !confirm("放棄此活動尚未儲存的欄位草稿？")) return false;
    dirty = false; return true;
  });
  const savedRevisions = new Map();
  const status = text => { $af("af-status").textContent = text; };
  function adminShell(){try{return window.parent!==window&&window.parent.location.origin===location.origin&&typeof window.parent.sakuraAdminEnsureSession==="function"?window.parent:null;}catch{return null;}}
  function resumeInAdmin(){const shell=adminShell();if(shell)shell.postMessage({type:"sakura-admin-session-required"},location.origin);return !!shell;}
  function embeddedAuthMessage(){return adminShell()?.sakuraAdminSessionRole&&adminShell().sakuraAdminSessionRole!=="admin"?"目前後台帳號沒有活動管理權限，不需要再次登入。":"活動頁沿用後台登入；請在後台處理登入狀態，草稿會保留並自動恢復。";}
  function registrationEntry() {
    const event = (state.events || []).find(row => row.id === state.selected);
    const panel = $af("af-registration"), image = $af("af-registration-qr");
    panel.hidden = !event;
    if (!event) {
      image.removeAttribute("src"); delete image.dataset.url;
      $af("af-registration-open").removeAttribute("href");
      $af("af-registration-url").value = ""; return;
    }
    const url = new URL("/activity-registration", location.origin);
    url.searchParams.set("event_id", event.id);
    $af("af-registration-title").textContent = event.title;
    $af("af-registration-url").value = url.href;
    $af("af-registration-open").href = url.href;
    if (image.dataset.url !== url.href) {
      image.dataset.url = url.href;
      $af("af-registration-qr-error").hidden = true;
      image.src = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=" + encodeURIComponent(url.href);
    }
    const notes = [];
    if (event.status !== "active") notes.push("活動尚未啟用，未開放報名。");
    if (!savedRevisions.has(event.id)) notes.push("報名欄位尚未確認。");
    else if (!savedRevisions.get(event.id)) notes.push("尚未設定報名欄位。");
    else notes.push("已設定報名欄位；實際報名依活動期限與身分資格判定。");
    $af("af-registration-status").textContent = notes.join(" ");
  }
  $af("af-registration-qr").onerror = () => { $af("af-registration-qr-error").hidden = false; };
  $af("af-registration-qr").onload = () => { $af("af-registration-qr-error").hidden = true; };
  $af("af-registration-copy").onclick = async () => {
    const input = $af("af-registration-url"), url = input.value;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); $af("af-registration-copy-status").textContent = "已複製報名網址。"; }
    catch { input.focus(); input.select(); $af("af-registration-copy-status").textContent = "無法自動複製，請複製已選取的報名網址。"; }
  };
  $af("af-registration-settings").onclick = () => {
    const id = state.selected;
    if (!id || busy) return;
    if (id !== eventId) {
      if (dirty && !confirm("放棄此活動尚未儲存的欄位草稿？")) return;
      loadForm(id);
    }
    section.scrollIntoView({ block: "start" }); select.focus({ preventScroll: true });
  };
  function authRequired(message) {
    const error = new Error(message); error.auth = true; return error;
  }
  function showError(error) {
    status(error.message);
    if (error.auth) {
      ready = false;
      $af("af-auth-notice").hidden = false;
      const embedded=resumeInAdmin();showLoginLinks(!embedded);
      $af("af-auth-message").textContent = embedded?embeddedAuthMessage():"管理員登入已失效或尚未完成驗證。請重新登入，已輸入的需求與草稿會保留。";
    }
  }
  function changed() { dirty = true; $af("af-confirm").checked = false; status("草稿尚未儲存。"); }
  function choice(values, current, onChange) {
    const el = node("select");
    for (const [value, label] of values) el.append(node("option", label, { value }));
    el.value = current;
    el.onchange = () => { onChange(el.value); changed(); draw(); };
    return el;
  }
  function fieldInput(labelText, value, onChange, type = "text") {
    const label = node("label", labelText), input = node("input", null, { type });
    if (type === "checkbox") input.checked = !!value;
    else input.value = value ?? "";
    input.oninput = () => { onChange(type === "checkbox" ? input.checked : type === "number" ? Number(input.value) : input.value); changed(); };
    input.onchange = () => draw();
    label.append(input);
    return label;
  }
  const icon = (text, title, action) => {
    const b = node("button", text, { type: "button", title, "aria-label": title, class: "af-icon" });
    b.onclick = () => { action(); changed(); draw(); };
    return b;
  };
  function draw() {
    const fields = $af("af-fields"); fields.replaceChildren();
    schema.fields.forEach((field, i) => {
      const row = node("fieldset", null, { class: "af-field-editor" });
      row.append(node("legend", "欄位 " + (i + 1)));
      const tools = node("div", null, { class: "af-actions" });
      const up = icon("↑", "上移欄位", () => { [schema.fields[i - 1], schema.fields[i]] = [schema.fields[i], schema.fields[i - 1]]; });
      const down = icon("↓", "下移欄位", () => { [schema.fields[i + 1], schema.fields[i]] = [schema.fields[i], schema.fields[i + 1]]; });
      up.disabled = i === 0; down.disabled = i === schema.fields.length - 1;
      tools.append(up, down, icon("×", "刪除欄位", () => {
        schema.fields.splice(i, 1);
        schema.fields.forEach(f => { if (f.showWhen?.field === field.id) delete f.showWhen; });
        schema.rules = schema.rules.filter(r => r.target !== field.id && r.other !== field.id && !r.fields?.includes(field.id));
      }));
      row.append(tools, fieldInput("名稱", field.label, v => { field.label = v; }));
      const typeLabel = node("label", "類型");
      typeLabel.append(choice([["text", "單行文字"], ["textarea", "多行文字"], ["tel", "電話"], ["number", "人數／整數"], ["select", "單選"], ["multiselect", "複選"]], field.type, v => {
        field.type = v;
        if (["select", "multiselect"].includes(v)) field.options ||= ["是", "否"];
        if (v === "number") { field.min ??= 0; field.max ??= 10000; }
      }));
      row.append(typeLabel, fieldInput("必填", field.required, v => { field.required = v; }, "checkbox"), fieldInput("補充說明", field.help, v => { field.help = v; }));
      if (["select", "multiselect"].includes(field.type)) {
        const label = node("label", "選項（每行一項）"), input = node("textarea");
        input.value = (field.options || []).join("\n");
        input.oninput = () => { field.options = input.value.split("\n").map(v => v.trim()).filter(Boolean); changed(); };
        input.onchange = () => draw(); label.append(input); row.append(label);
      }
      if (field.type === "number") row.append(fieldInput("最少", field.min, v => { field.min = v; }, "number"), fieldInput("最多", field.max, v => { field.max = v; }, "number"));
      const condition = node("label", "顯示條件");
      const parents = schema.fields.slice(0, i).filter(f => f.type === "select");
      condition.append(choice([["", "一律顯示"], ...parents.map(f => [f.id, f.label])], field.showWhen?.field || "", v => {
        if (!v) delete field.showWhen;
        else field.showWhen = { field: v, equals: parents.find(f => f.id === v).options[0] };
      }));
      row.append(condition);
      if (field.showWhen) {
        const parent = parents.find(f => f.id === field.showWhen.field);
        if (parent) row.append(choice((parent.options || []).map(v => [v, v]), field.showWhen.equals, v => { field.showWhen.equals = v; }));
        else row.append(node("p", "顯示條件無效，請把對應的單選欄位移到前方。", { class: "af-warning" }));
      }
      fields.append(row);
    });
    if (!schema.fields.length) fields.append(node("p", "尚未設定報名欄位。"));
    const rules = $af("af-rules"); rules.replaceChildren();
    const numeric = schema.fields.filter(f => f.type === "number" && !f.showWhen);
    schema.rules.forEach((rule, i) => {
      const row = node("fieldset", null, { class: "af-rule" });
      row.append(node("legend", "驗證 " + (i + 1)));
      row.append(choice([["sum", "總數等於各項加總"], ["max", "人數不超過另一欄位"]], rule.type, v => {
        rule.type = v;
        if (v === "sum") { rule.fields = []; rule.constant = 0; } else rule.other = "";
      }));
      row.append(choice([["", "選擇目標欄位"], ...numeric.map(f => [f.id, f.label])], rule.target, v => { rule.target = v; }));
      if (rule.type === "sum") {
        row.append(fieldInput("加上固定人數（如員工本人 1 人）", rule.constant, v => { rule.constant = v; }, "number"));
        for (const f of numeric.filter(f => f.id !== rule.target)) row.append(fieldInput(f.label, rule.fields?.includes(f.id), checked => {
          rule.fields = checked ? [...(rule.fields || []), f.id] : (rule.fields || []).filter(id => id !== f.id);
        }, "checkbox"));
      } else row.append(choice([["", "選擇上限欄位"], ...numeric.filter(f => f.id !== rule.target).map(f => [f.id, f.label])], rule.other, v => { rule.other = v; }));
      row.append(fieldInput("錯誤提示", rule.message, v => { rule.message = v; }), icon("×", "刪除驗證規則", () => { schema.rules.splice(i, 1); }));
      rules.append(row);
    });
    renderForm($af("af-preview"), schema, {}, false, false);
    $af("af-revision").textContent = "版本 " + revision;
    $af("af-save").disabled = !ready || busy || !schema.fields.length;
  }
  let lineReady;
  function ensureLineReady() {
    if (!lineReady) lineReady = new Promise((resolve, reject) => {
      let script = document.getElementById("af-line-sdk");
      const timer = setTimeout(() => {
        if (script) script.remove();
        reject(new Error("LINE 驗證載入逾時，請重新載入。"));
      }, 10000);
      const finish = error => {
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const init = () => Promise.resolve().then(() => window.liff.init({ liffId: "__SAKURA_LIFF_ID__" })).then(() => finish(), () => finish(new Error("LINE 驗證暫時無法連線，請重新載入。")));
      if (window.liff) { init(); return; }
      const existing = !!script;
      script = script || document.createElement("script");
      script.id = "af-line-sdk";
      script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
      script.onload = init;
      script.onerror = () => { script.remove(); finish(new Error("LINE 驗證暫時無法載入，請重新載入。")); };
      if (!existing) document.head.appendChild(script);
    }).catch(error => { lineReady = null; throw error; });
    return lineReady;
  }
  function showLoginLinks(visible) {
    document.querySelectorAll('[data-activity-login]').forEach(link => { link.hidden = !visible || !!adminShell(); });
  }
  async function headers() {
    const shell=adminShell();
    if(shell&&!await shell.sakuraAdminEnsureSession())throw authRequired("請在後台完成登入，活動頁會自動恢復。");
    let session;
    try { session = JSON.parse(localStorage.getItem("sakura_admin_session") || "null"); } catch { /* Login link remains available. */ }
    if (session?.token) return { Authorization: "Bearer " + session.token };
    if(shell)throw authRequired("請在後台完成登入，活動頁會自動恢復。");
    await ensureLineReady();
    if (!liff.isLoggedIn()) throw authRequired("請先完成管理員登入。");
    const token = liff.getIDToken();
    if (!token) throw authRequired("無法取得 LINE 登入驗證，請重新登入。");
    return { "X-Line-Id-Token": token };
  }
  async function api(data, selectedId = eventId, rosterPage = 1) {
    const h = await headers();
    const response = await fetch("/admin-api/activity-form" + (data ? "" : "?event_id=" + encodeURIComponent(selectedId) + (rosterPage > 1 ? "&roster_page=" + rosterPage : "")), {
      method: data ? "POST" : "GET", headers: { ...h, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(35000)
    });
    const result = await response.json();
    if (!result.success) {
      const message = result.message || "操作失敗。";
      throw [401, 403].includes(response.status) ? authRequired(message) : new Error(message);
    }
    return result;
  }
  function rosterActions(root, id) {
    root.replaceChildren();
    const actions = node("div", null, { class: "af-registration-actions" });
    const message = node("p", "", { role: "status", "aria-live": "polite" });
    for (const [format, label] of [["xlsx", "下載 Excel 出席名單"], ["csv", "下載報名名冊 CSV"], ["print", "下載列印簽到表"]]) {
      const button = node("button", label, { type: "button", class: "btn", "data-roster-format": format });
      button.onclick = async () => {
        for (const b of actions.querySelectorAll("button")) b.disabled = true;
        message.textContent = "正在匯出完整報名名冊...";
        try {
          const response = await fetch("/admin-api/activity-form?event_id=" + encodeURIComponent(id) + "&export=" + format,
            { headers: await headers(), signal: AbortSignal.timeout(35000), cache: "no-store" });
          if (!response.ok) {
            const result = await response.json();
            throw [401, 403].includes(response.status) ? authRequired(result.message) : new Error(result.message || "名冊下載失敗。");
          }
          const blob = await response.blob();
          const disposition = response.headers.get("Content-Disposition") || "";
          const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
          const filename = encoded ? decodeURIComponent(encoded) : "activity-roster." + (format === "xlsx" ? "xlsx" : format === "csv" ? "csv" : "html");
          const url = URL.createObjectURL(blob), link = node("a", "", { href: url, download: filename });
          document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          message.textContent = "報名名冊已下載。";
        } catch (error) {
          message.textContent = error.name === "TimeoutError" ? "名冊匯出逾時，請稍後重試。" : error.message;
          if (error.auth) showError(error);
        } finally { for (const b of actions.querySelectorAll("button")) b.disabled = false; }
      };
      actions.append(button);
    }
    root.append(actions, message);
  }
  function lock(value) { busy = value; $af("af-controls").disabled = value; select.disabled = value; }
  function resetRoster(message, id = "") {
    const seq = ++rosterSequence;
    $af("af-responses").replaceChildren();
    $af("af-roster-count").textContent = "";
    $af("af-roster-dialog-count").textContent = "";
    $af("af-roster-open").disabled = !id;
    $af("af-roster-preview").textContent = message;
    $af("af-roster-event").textContent = (state.events || []).find(row => row.id === id)?.title || "";
    $af("af-roster-status").textContent = message;
    $af("af-roster-refresh").disabled = !id;
    return seq;
  }
  async function loadRoster(id, page = 1) {
    const seq = resetRoster(id ? "正在載入報名名單..." : "請先選取活動。", id);
    if (!id) return;
    $af("af-roster-refresh").disabled = true;
    try {
      const result = await api(undefined, id, page);
      if (seq !== rosterSequence) return;
      $af("af-roster-count").textContent = "（" + result.registration_count + " 筆）";
      $af("af-roster-dialog-count").textContent = $af("af-roster-count").textContent;
      $af("af-roster-preview").textContent = $af("af-roster-event").textContent;
      $af("af-roster-status").textContent = result.registration_count ? "" : "尚無報名紀錄。";
      const downloads = node("div"); rosterActions(downloads, id); $af("af-responses").append(downloads);
      if (Number.isSafeInteger(result.checked_in_count) && Number.isSafeInteger(result.not_checked_in_count)) {
        $af("af-responses").append(node("p", "報名 " + result.registration_count + " 筆｜已簽到 " + result.checked_in_count + " 筆｜未簽到 " + result.not_checked_in_count + " 筆", { class: "af-attendance-summary", role: "status" }));
      }
      if (Number.isSafeInteger(result.attendance_people) && Number.isSafeInteger(result.attendance_unknown)) {
        $af("af-responses").append(node("p", "已記錄實到 " + result.attendance_people + " 人" + (result.attendance_unknown ? "｜另有 " + result.attendance_unknown + " 筆簽到未記錄人數" : ""), { class: "af-attendance-summary", role: "status" }));
      }
      const cancel = async (entry = null) => {
        if (seq !== rosterSequence || state.selected !== id) return;
        const title = result.event.title;
        const accepted = entry
          ? window.confirm('取消「' + title + '」中「' + (entry.display_name || 'LINE 會員') + '」的報名？取消紀錄會保留，對方可重新報名。')
          : window.prompt('將取消「' + title + '」全部 ' + result.registration_count + ' 筆報名。取消紀錄會保留；已簽到者不會被取消。請輸入「取消全部」確認。') === '取消全部';
        if (!accepted) return;
        const controls = [...$af("af-responses").querySelectorAll("button"), $af("af-roster-refresh")];
        controls.forEach(button => { button.disabled = true; });
        $af("af-roster-status").textContent = "正在取消報名，請勿重複操作...";
        try {
          const response = await api({ action: entry ? 'cancel_registration' : 'cancel_all_registrations',
            event_id: id, event_title: title, registration_id: entry?.id || null,
            expected_count: result.registration_count, roster_revision: result.roster_revision,
            request_id: crypto.randomUUID(), confirmed: true });
          if (seq !== rosterSequence || state.selected !== id) return;
          await loadRoster(id);
          if (state.selected === id) $af("af-roster-status").textContent = response.message;
        } catch (error) {
          if (seq === rosterSequence) {
            $af("af-roster-status").textContent = "取消未確認成功：" + error.message + " 請重新載入名單確認結果，再決定是否重試。";
            if (error.auth) showError(error);
          }
        } finally { if (seq === rosterSequence) controls.forEach(button => { button.disabled = false; }); }
      };
      const cancelAll = node("button", "全部取消報名", { type: "button", class: "af-cancel-button", "data-cancel-all": "" });
      cancelAll.disabled = !result.registration_count || !result.roster_revision;
      cancelAll.title = result.roster_revision ? "僅取消目前活動的報名" : "一次最多取消 500 筆，請逐筆處理";
      cancelAll.onclick = () => cancel(); downloads.querySelector(".af-registration-actions").append(cancelAll);
      const list = node("div", null, { class: "af-response-list" });
      for (const entry of result.registrations || []) {
        const details = node("details");
        const summary = node("summary");
        summary.append(node("span", entry.display_name || "LINE 會員"), node("time", new Date(entry.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })));
        details.append(summary);
        const rawCheckedAt = String(entry.checked_at || "");
        const checkedDate = rawCheckedAt ? new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawCheckedAt) ? rawCheckedAt : rawCheckedAt.replace(" ", "T") + "+08:00") : null;
        const checkedTime = checkedDate && Number.isFinite(checkedDate.getTime()) ? checkedDate.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hourCycle: "h23" }) : "時間待確認";
        const attendance = node("p", entry.checked_in ? "已簽到｜簽到時間（臺北）：" + checkedTime + (Number.isSafeInteger(entry.attendance_count) ? "｜實到人數：" + entry.attendance_count + " 人" : "｜實到人數未記錄") : "未簽到｜簽到時間（臺北）：—", { class: "af-registration-attendance", "data-attendance": entry.checked_in ? "checked-in" : "not-checked-in" });
        const dl = node("dl");
        for (const f of entry.schema.fields) if (Object.hasOwn(entry.answers, f.id)) {
          dl.append(node("dt", f.label), node("dd", Array.isArray(entry.answers[f.id]) ? entry.answers[f.id].join("、") : String(entry.answers[f.id])));
        }
        details.append(dl);
        const row = node("div", null, { class: "af-response-row" });
        const cancelOne = node("button", "取消報名", { type: "button", class: "af-cancel-button", "data-registration-cancel": entry.id,
          "aria-label": "取消「" + (entry.display_name || "LINE 會員") + "」的報名" });
        cancelOne.onclick = () => cancel(entry);
        const info = node("div", null, { class: "af-response-info" }); info.append(details, attendance);
        row.append(info, cancelOne); list.append(row);
      }
      $af("af-responses").append(list);
      if (result.registration_count > 100) {
        const pageNumber = result.roster_page || 1, pages = result.roster_pages || Math.ceil(result.registration_count / 100);
        const pagination = node("div", null, { class: "af-registration-actions", "aria-label": "報名名單分頁" });
        const previous = node("button", "上一頁", { type: "button", class: "btn", "data-roster-previous": "" });
        const next = node("button", "下一頁", { type: "button", class: "btn", "data-roster-next": "" });
        previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= pages;
        previous.onclick = () => loadRoster(id, pageNumber - 1); next.onclick = () => loadRoster(id, pageNumber + 1);
        pagination.append(previous, node("span", "第 " + pageNumber + "／" + pages + " 頁（每頁 100 筆）"), next);
        $af("af-responses").append(pagination);
      }
    } catch (error) {
      if (seq !== rosterSequence) return;
      $af("af-roster-status").textContent = "報名名單載入失敗：" + error.message;
      $af("af-roster-preview").textContent = "名單載入失敗";
      if (error.auth) showError(error);
    } finally { if (seq === rosterSequence) $af("af-roster-refresh").disabled = false; }
  }
  $af("af-roster-refresh").onclick = () => loadRoster(state.selected);
  const rosterDialog = $af("af-roster-dialog");
  let previousBodyOverflow = "", outsideRoster = false;
  $af("af-roster-open").onclick = () => {
    if (rosterDialog.open || !state.selected) return;
    previousBodyOverflow = document.body.style.overflow;
    rosterDialog.showModal(); document.body.style.overflow = "hidden";
    $af("af-roster-close").focus();
    loadRoster(state.selected);
  };
  $af("af-roster-close").onclick = () => rosterDialog.close();
  const outsideDrawer = event => {
    const box = rosterDialog.getBoundingClientRect();
    return event.target === rosterDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  rosterDialog.addEventListener("pointerdown", event => { outsideRoster = outsideDrawer(event); });
  rosterDialog.addEventListener("click", event => { if (outsideRoster && outsideDrawer(event)) rosterDialog.close(); outsideRoster = false; });
  rosterDialog.addEventListener("close", () => {
    document.body.style.overflow = previousBodyOverflow;
    $af("af-roster-open").focus({ preventScroll: true });
  });
  async function loadForm(id, { preserveDraft = false } = {}) {
    const seq = ++sequence;
    const keepDraft = preserveDraft && dirty && id === eventId;
    eventId = id; select.value = id; ready = false;
    if (!keepDraft) {
      dirty = false; schema = { version: 1, fields: [], rules: [] }; revision = 0;
      $af("af-confirm").checked = false; $af("af-warnings").replaceChildren();
    }
    $af("af-link").hidden = true;
    draw();
    if (!id) { status("請先儲存並選取活動。"); return; }
    status("正在讀取報名欄位...");
    lock(true);
    try {
      const result = await api();
      if (seq !== sequence) return;
      savedRevisions.set(id, result.revision); registrationEntry();
      if (!keepDraft) { schema = result.schema; revision = result.revision; }
      ready = true; $af("af-auth-notice").hidden = true;
      const link = $af("af-link");
      link.href = "/activity-registration?event_id=" + encodeURIComponent(id); link.hidden = revision === 0;
      status(keepDraft ? "已沿用後台登入，未儲存草稿已保留。" : revision ? "已載入儲存的報名欄位。" : "尚未設定報名欄位。");
    } catch (error) { if (seq === sequence) showError(error); }
    finally { if (seq === sequence) { lock(false); draw(); } }
  }
  select.onchange = () => {
    if (dirty && !confirm("放棄此活動尚未儲存的欄位草稿？")) { select.value = eventId; return; }
    loadForm(select.value);
  };
  $af("af-refresh").onclick = () => { if (!dirty || confirm("重新載入會放棄尚未儲存的草稿，是否繼續？")) loadForm(eventId); };
  $af("af-add").onclick = () => {
    if (schema.fields.length >= 30) { status("最多 30 個欄位。"); return; }
    schema.fields.push({ id: "field_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12), label: "新欄位", type: "text", required: false }); changed(); draw();
  };
  $af("af-add-rule").onclick = () => {
    if (schema.rules.length >= 30) return;
    schema.rules.push({ type: "sum", target: "", fields: [], constant: 1, message: "請確認填寫的人數。" }); changed(); draw();
  };
  $af("af-generate").onclick = async () => {
    if (busy) return;
    if (!eventId) { status("請先選取活動。"); return; }
    if (!$af("af-requirements").value.trim()) { status("請填寫欄位需求。"); return; }
    if (!ready) {
      await loadForm(eventId, { preserveDraft: true });
      if (!ready) { if (!$af("af-auth-notice").hidden) $af("af-auth-login").focus(); return; }
    }
    if (dirty && !confirm("使用新生成的欄位取代目前草稿？")) return;
    const id = eventId, seq = sequence;
    lock(true); status("AI 正在生成欄位...");
    try {
      const result = await api({ action: "generate", event_id: id, requirements: $af("af-requirements").value });
      if (seq !== sequence) return;
      schema = result.schema; changed();
      $af("af-warnings").replaceChildren(...result.warnings.map(w => node("li", w)));
      status("草稿已生成，請檢查欄位、分組與驗證規則。");
    } catch (error) {
      if (error.name === "TimeoutError") status("AI 生成逾時，目前草稿已保留。");
      else showError(error);
    }
    finally { lock(false); draw(); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (!ready || busy || !$af("af-confirm").checked) { status("請先預覽並勾選確認。"); return; }
    lock(true); status("正在儲存...");
    try {
      const result = await api({ action: "save", event_id: eventId, revision, schema, confirmed: true });
      schema = result.schema; revision = result.revision; dirty = false;
      savedRevisions.set(eventId, revision); registrationEntry();
      $af("af-link").href = "/activity-registration?event_id=" + encodeURIComponent(eventId); $af("af-link").hidden = false;
      $af("af-confirm").checked = false; status(result.message);
    } catch (error) { showError(error); }
    finally { lock(false); draw(); }
  };
  window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  function resumeActivity(){
    if(busy)return;
    window.load(state.selected).then(() => {
      if (eventId && dirty) loadForm(eventId, { preserveDraft: true });
    }).catch(() => {});
  }
  window.addEventListener("storage", event => {
    if (event.key !== "sakura_admin_session" || !event.newValue) return;
    resumeActivity();
  });
  window.addEventListener("message",event=>{if(event.origin===location.origin&&event.source===adminShell()&&event.data?.type==="sakura-admin-session-ready")resumeActivity();});
  function syncEvents() {
    const rows = state.events || [];
    select.replaceChildren(node("option", "選擇活動", { value: "" }), ...rows.map(e => node("option", e.title, { value: e.id })));
    if (eventId && !rows.some(e => e.id === eventId)) { ++sequence; eventId = ""; ready = false; dirty = false; schema = { fields: [], rules: [] }; draw(); }
    select.value = eventId;
    $af("af-registration-copy-status").textContent = "";
    registrationEntry();
    const displayedAttendance = (state.attendance || []).length;
    const attendanceCount = Number(rows.find(row => row.id === state.selected)?.checkin_count ?? displayedAttendance);
    $af("af-attendance-count").textContent = state.selected ? "（" + attendanceCount + " 筆" + (attendanceCount > displayedAttendance ? "；顯示最近 " + displayedAttendance + " 筆" : "") + "）" : "";
    loadRoster(state.selected);
    if (!busy && !dirty && state.selected && state.selected !== eventId) loadForm(state.selected);
  }
  const originalRender = window.render;
  window.render = function () { originalRender(); syncEvents(); };
  window.activityCover = installCover(headers);
  const originalApi = window.api, originalLoad = window.load;
  window.api = async (path, options = {}) => {
    const result = await originalApi(path, {
      ...options, signal: options.signal || AbortSignal.timeout(35000),
      headers: { ...options.headers, ...await headers() }
    });
    if ((options.method || 'GET').toUpperCase() === 'GET' && new URL(path,location.origin).pathname === '/admin-api/activity-checkin') editorSections.update(result);
    return result;
  };
  window.load = async id => {
    const notice = $af("af-dashboard-notice");
    resetRoster("正在載入報名名單...");
    notice.hidden = false;
    showLoginLinks(false);
    $af("af-dashboard-message").textContent = "正在載入活動...";
    $af("af-dashboard-retry").disabled = true;
    for (const key of ["stEvents", "stActive", "stCheckins"]) $af(key).textContent = "—";
    try {
      const result = await originalLoad(id);
      notice.hidden = true;
      return result;
    } catch (error) {
      const embedded=error.auth&&resumeInAdmin();
      showLoginLinks(!!error.auth);
      resetRoster("報名名單未載入，請重新載入活動。");
      $af("af-dashboard-message").textContent = "活動載入失敗：" + (embedded?embeddedAuthMessage():error.message + (error.auth ? " 請確認帳號的活動管理權限，或重新登入。" : " 請稍後重新載入，不必重複登入。"));
      throw error;
    } finally { $af("af-dashboard-retry").disabled = false; }
  };
  $af("af-dashboard-retry").onclick = () => window.load(state.selected).catch(() => {});
  installImport(headers, window.activityCover);
  installLottery?.(headers, () => (state.events || []).find(event => event.id === state.selected));
  section.hidden = false; draw(); syncEvents();
}`;

const installActivityRegistration = String.raw`function installActivityRegistration(widgets, locale, copy, helpers) {
  const { node, renderForm } = widgets();
  const { registrationUrl, offersUrl, timestamp, errorText } = helpers(locale, copy);
  const $r = id => document.getElementById(id);
  let eventId = new URLSearchParams(location.search).get("event_id") || "", idToken = "", revision = 0, collect;
  let translations = {}, dirty = false;
  let currentResult=null,editing=false,pendingEdit=null,submitting=false;
  const editButton=node('button',copy.editRegistration,{type:'button',id:'ar-edit'});
  const cancelButton=node('button',copy.cancelEdit,{type:'button',id:'ar-cancel-edit'});
  const reloadButton=node('button',copy.retry,{type:'button',id:'ar-reload'});reloadButton.hidden=true;
  editButton.hidden=true;cancelButton.hidden=true;
  $r('ar-submit').after(editButton,cancelButton,reloadButton);
  // Existing QR links have no locale. Prefer the preceding offer page, then device language.
  if (!new URLSearchParams(location.search).has("lang")) {
    let preferred = navigator.language;
    try { preferred = localStorage.getItem("sakura_activity_locale") || preferred; } catch { /* Optional storage. */ }
    const language = String(preferred || "").toLowerCase().split(/[-_]/)[0];
    if (["id", "th"].includes(language)) {
      const url = new URL(location.href); url.searchParams.set("lang", language); location.replace(url.href); return;
    }
  }
  try { localStorage.setItem("sakura_activity_locale", locale); } catch { /* Optional storage. */ }
  $r("ar-language").value = locale;
  $r("ar-language").onchange = () => {
    if (dirty && !confirm(copy.leave)) { $r("ar-language").value = locale; return; }
    const url = new URL(location.href); url.searchParams.set("lang", $r("ar-language").value); location.href = url.href;
  };
  $r("ar-form").addEventListener("input", () => { dirty = true; });
  const t = value => value === "請選擇" ? copy.select : Object.hasOwn(translations, value) ? translations[value] : value;
  const status = text => { $r("ar-status").textContent = text; };
  async function api(data) {
    const query = new URLSearchParams({ lang: locale });
    if (!data && eventId) query.set("event_id", eventId);
    const response = await fetch("/api/activity-registration?" + query, {
      method: data ? "POST" : "GET", headers: { Authorization: "Bearer " + idToken, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (!response.ok || !result.success){const error=new Error(errorText(result.message,translations,response.status));error.status=response.status;throw error;}
    return result;
  }
  function show(result) {
    currentResult=result;editing=false;pendingEdit=null;editButton.hidden=true;cancelButton.hidden=true;reloadButton.hidden=true;
    $r('ar-submit').textContent=copy.submit;
    translations = result.translations || translations;
    $r("ar-title").textContent = t(result.event.title);
    $r("ar-info").textContent = [timestamp(result.event.start_at), t(result.event.location),
      result.event.registration_start_at ? copy.registrationStarts + "：" + timestamp(result.event.registration_start_at) : "",
      result.event.registration_end_at ? copy.registrationEnds + "：" + timestamp(result.event.registration_end_at) : "",
      t(result.event.description)].filter(Boolean).join("\n");
    if (result.translationStatus) $r("ar-translation").textContent = result.translationStatus === "original" ? copy.original : "";
    const cover = $r("ar-cover");
    const coverLink = $r("ar-cover-link");
    cover.hidden = true;
    coverLink.hidden = true;
    try {
      const url = new URL(result.event.cover_image_url);
      if (url.protocol === "https:") {
        coverLink.href = url.href; coverLink.hidden = false;
        cover.onerror = () => { cover.hidden = true; $r("ar-cover-error").hidden = false; };
        cover.onload = () => { $r("ar-cover-error").hidden = true; };
        $r("ar-cover-error").hidden = true; cover.src = url.href; cover.hidden = false;
      }
    } catch { /* Optional cover. */ }
    $r("ar-form").hidden = false;
    if (result.registration) {
      renderForm($r("ar-fields"), result.registration.schema, result.registration.answers, true, true, t);
      collect = null; dirty = false;
      $r("ar-submit").hidden = true;
      editButton.hidden=!result.can_edit;
      status((result.updated?copy.registrationUpdated:copy.done) + " · " + timestamp(result.registration.created_at));
    } else {
      if (["not_started", "closed"].includes(result.registrationState)) {
        collect = null; dirty = false; $r("ar-form").hidden = true;
        status(result.registrationState === "not_started" ? copy.registrationNotStarted : copy.registrationClosed);
        return;
      }
      const prefill = result.prefill || {};
      revision = result.revision; collect = renderForm($r("ar-fields"), result.schema, prefill, false, true, t, Object.keys(prefill));
      $r("ar-submit").hidden = false; $r("ar-submit").disabled = false; status("");
    }
  }
  editButton.onclick=()=>{
    if(!currentResult?.registration || !currentResult.can_edit)return;
    editing=true;dirty=false;pendingEdit=null;
    collect=renderForm($r('ar-fields'),currentResult.registration.schema,currentResult.registration.answers,false,true,t);
    editButton.hidden=true;cancelButton.hidden=false;
    $r('ar-submit').hidden=false;$r('ar-submit').disabled=false;$r('ar-submit').textContent=copy.saveRegistration;
    status(copy.editRegistration);
  };
  cancelButton.onclick=()=>{if(dirty && !confirm(copy.leave))return;show(currentResult);};
  reloadButton.onclick=async()=>{if(dirty && !confirm(copy.leave))return;reloadButton.disabled=true;try{show(await api());}catch(error){status(error.message);}finally{reloadButton.disabled=false;}};
  $r("ar-submit").disabled = true;
  $r("ar-form").onsubmit = async event => {
    event.preventDefault(); if (!collect || submitting) return;
    submitting=true;cancelButton.disabled=true;
    $r("ar-submit").disabled = true; status(copy.sending);
    try {
      const answers=collect(),data={event_id:eventId,revision,answers};
      if(editing){
        const serialized=JSON.stringify(answers);
        if(!pendingEdit || pendingEdit.answers!==serialized)pendingEdit={id:crypto.randomUUID(),answers:serialized};
        Object.assign(data,{action:'update_registration',registration_id:currentResult.registration.id,
          edit_revision:currentResult.edit_revision,request_id:pendingEdit.id});
      }
      show(await api(data));
    }
    catch (error) { status(error.name === "TimeoutError" || error instanceof TypeError ? copy.failed : error.message); $r("ar-submit").disabled = false;reloadButton.hidden=error.status!==409; }
    finally{submitting=false;cancelButton.disabled=false;}
  };
  $r("ar-close").onclick = () => { if (window.liff?.isInClient?.()) liff.closeWindow(); else location.href = offersUrl + "?view=activities"; };
  (async () => {
    try {
      if (!window.liff) throw new Error(copy.sdk);
      await liff.init({ liffId: "__SAKURA_LIFF_ID__" });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      idToken = liff.getIDToken();
      if (!idToken) throw new Error(copy.identity);
      const result = await api();
      if (eventId) { show(result); return; }
      translations = result.translations || {};
      status(result.events.length ? "" : copy.empty);
      $r("ar-translation").textContent = result.translationStatus === "original" ? copy.original : "";
      for (const event of result.events) {
        const link = node("a", t(event.title), { href: registrationUrl(event.id), class: "ar-event" });
        link.append(node("small", [timestamp(event.start_at), t(event.location)].filter(Boolean).join(" · ")));
        const upcoming = event.registration_state === "not_started";
        link.append(node("small", upcoming ? copy.registrationUpcoming : copy.registrationOpen));
        if (upcoming && event.registration_start_at) {
          link.append(node("small", copy.registrationStarts + "：" + timestamp(event.registration_start_at)));
        }
        $r("ar-events").append(link);
      }
    } catch (error) { status(error.name === "TimeoutError" || error instanceof TypeError ? copy.failed : error.message); }
  })();
}`;

const styles = `<style>
.af-window{grid-column:1/-1;border-bottom:1px solid #dbe3ee;padding:12px 0;margin-bottom:12px;min-width:0}.af-window h3{font-size:16px;margin:0 0 12px}.af-window label{display:block;margin:12px 0 6px}.af-window input{display:block;width:100%;min-width:0;min-height:42px;padding:8px 10px;box-sizing:border-box;border:1px solid #cad5df;border-radius:6px;background:#fff;color:#17212b;font:inherit}
#af-dashboard-notice{margin:16px 0;padding:12px 16px;border:1px solid #e9b782;background:#fff8ed;color:#704114;line-height:1.6;display:flex;flex-wrap:wrap;gap:12px;align-items:center}#af-dashboard-notice a{color:#8e2343}
.af-event-list{border-top:1px solid #cbd9e8;border-bottom:1px solid #cbd9e8}.af-event-list>summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;min-height:64px;box-sizing:border-box;border-left:4px solid #c8103d;background:#f0f6fc;color:#172d43;line-height:1.5;list-style:none}.af-event-list>summary::-webkit-details-marker{display:none}.af-event-list>summary:hover{background:#e5eff9}.af-event-list>summary:focus-visible{outline:2px solid #1661ab;outline-offset:-3px}.af-list-title{font-size:18px;font-weight:700}.af-list-action{display:flex;align-items:center;gap:12px;flex-shrink:0;color:#155a91;font-size:14px;font-weight:600}.af-list-chevron{width:9px;height:9px;box-sizing:border-box;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-2px) rotate(45deg);margin-right:3px}.af-event-list[open] .af-list-chevron{transform:translateY(2px) rotate(225deg)}.af-event-list .af-list-close,.af-event-list[open] .af-list-open{display:none}.af-event-list[open] .af-list-close{display:inline}.af-event-list-scroll{max-height:420px;overflow:auto}.af-event-list-scroll table{margin:0}@media(max-width:480px){.af-event-list>summary{padding:14px 12px;gap:12px}.af-list-title{font-size:16px}}
.af-registration{border-bottom:1px solid #dbe3ee;margin-bottom:16px;padding-bottom:16px;min-width:0}.af-registration h3,.af-checkin-heading{font-size:18px;margin:0 0 12px}.af-checkin-heading{grid-column:1/-1}.af-registration-layout{display:grid;grid-template-columns:180px minmax(0,1fr);gap:14px;align-items:start}.af-registration img{width:180px;height:180px;padding:16px;display:block;background:#fff}.af-registration strong{display:block;overflow-wrap:anywhere}.af-registration input{display:block;width:100%;min-width:0;min-height:42px;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;margin:6px 0 10px}.af-registration p{line-height:1.6;overflow-wrap:anywhere}.af-registration-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.af-registration-actions a{color:#1661ab}.af-registration [role=status]{min-height:22px;margin:6px 0}.af-registration-label{display:block;margin-top:12px}.af-registration .btn{border-radius:6px}@media(max-width:600px){.af-registration-layout{grid-template-columns:1fr}}
.af-section{margin-top:24px;padding:20px 0;border-top:1px solid #dbe3ee;background:#fff;color:#17212b;letter-spacing:0}
.af-section h2{font-size:20px;margin:0 0 16px}.af-section h3{font-size:16px}.af-section *{box-sizing:border-box;min-width:0}
.af-top,.af-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.af-top{padding:0 18px 16px}.af-top select{flex:1;min-width:160px}
.af-section input:not([type=checkbox]),.af-section select,.af-section textarea,.ar-page input:not([type=checkbox]),.ar-page textarea,.ar-page select{width:100%;font:inherit;min-height:40px;border:1px solid #cad5df;border-radius:6px;padding:8px;background:#fff;color:#17212b}
.af-section textarea{min-height:90px;resize:vertical}.af-section label{display:block;font-size:13px;line-height:1.6}.af-section label>input[type=checkbox]{margin-left:8px}
.af-section button,.ar-page button{font:inherit;min-height:40px;border:1px solid #cad5df;border-radius:6px;padding:8px 14px;background:white;color:#17212b;cursor:pointer}.af-section button:disabled,.ar-page button:disabled{opacity:.5;cursor:wait}
.af-section .af-primary,.ar-page .af-primary{background:#c8103d;color:white;border-color:#c8103d}.af-section .af-icon{width:40px;height:40px;padding:0;font-size:20px}
.af-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.75fr);gap:24px}.af-section form{padding:0 18px}.af-section fieldset#af-controls{border:0;padding:0;margin:0}
.af-field-editor,.af-rule{border:0;border-bottom:1px solid #dbe3ee;padding:14px 0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}.af-field-editor legend,.af-rule legend{font-weight:700;padding-top:16px}
.af-field-editor .af-actions{grid-column:1/-1;justify-content:flex-end}.af-field{padding:10px 0}.af-field label{display:block;font-weight:600;margin-bottom:6px}.af-field small{display:block;color:#536575;margin-top:4px}.af-options label{display:flex;gap:8px;align-items:center}
.af-preview{border-left:1px solid #dbe3ee;padding-left:24px;align-self:start}.af-preview h3{margin-top:0}.af-preview input,.af-preview textarea{background:#fafcfd}
.af-warning,#af-warnings{color:#9a4800;line-height:1.6}#af-status,#ar-status{padding:12px 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
#af-auth-notice{margin:0 18px 16px;padding:12px;border:1px solid #e9b782;border-radius:6px;background:#fff8ed;color:#704114;line-height:1.6}#af-auth-notice a{display:inline-block;margin-left:8px;color:#8e2343;font-weight:700}
#af-roster{border-bottom:1px solid #dbe3ee;min-width:0}#af-roster-heading{margin:0;padding:0;border:0}#af-roster-open{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:88px;padding:16px 18px;text-align:left;border:0;background:#fff;color:#172d43;font:inherit;cursor:pointer}#af-roster-open:hover{background:#f0f6fc}#af-roster-open:disabled{cursor:default;color:#657383}#af-roster-open>span:first-child{min-width:0}.af-roster-label{font-size:18px;font-weight:700}#af-roster-preview{display:block;font-size:13px;font-weight:400;line-height:1.5;overflow-wrap:anywhere;margin-top:6px}.af-roster-open-action{display:flex;align-items:center;gap:10px;flex-shrink:0;color:#155a91;font-size:14px;font-weight:500}.af-roster-open-action>span{font-size:26px}
#af-roster-dialog{position:fixed;inset:0 0 0 auto;width:min(600px,100%);height:100dvh;max-width:100%;max-height:100dvh;margin:0;padding:0;border:0;border-left:1px solid #dbe3ee;border-radius:0;background:#fff;color:#172d43;box-sizing:border-box;overflow:hidden;font:14px/1.6 system-ui,sans-serif;letter-spacing:0}#af-roster-dialog[open]{display:flex;flex-direction:column}#af-roster-dialog::backdrop{background:#14233380}#af-roster-dialog *{box-sizing:border-box;min-width:0}.af-roster-heading{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:8px;padding:14px 18px;background:#f0f6fc;border-bottom:1px solid #dbe3ee}#af-roster-dialog-title{padding:0;margin:0;border:0;font-size:18px;overflow-wrap:anywhere}#af-roster-count,#af-roster-dialog-count,#af-attendance-count{font-size:14px;color:#536575;font-weight:400}.af-roster-tools{display:flex;gap:8px;flex-shrink:0}#af-roster-dialog button{font:inherit;min-height:40px;padding:8px 12px;border:1px solid #cbd9e8;border-radius:6px;background:#fff;color:#172d43;cursor:pointer}#af-roster-dialog .af-roster-tools button{width:40px;height:40px;flex:0 0 40px;padding:0;font-size:22px}#af-roster-dialog button:disabled{opacity:.5;cursor:wait}#af-roster-open:focus-visible,#af-roster-dialog button:focus-visible,#af-roster-dialog summary:focus-visible{outline:2px solid #1661ab;outline-offset:-2px}.af-roster-body{padding:18px;overflow:auto;overscroll-behavior:contain;min-height:0;flex:1}#af-roster-event{display:block;overflow-wrap:anywhere;margin-bottom:12px;font-size:16px}#af-roster-status:empty{display:none}#af-roster-status{line-height:1.6;overflow-wrap:anywhere}#af-responses{margin:0}#af-responses details{border-top:1px solid #dbe3ee;padding:12px 0}#af-responses summary{cursor:pointer;line-height:1.6;overflow-wrap:anywhere}#af-responses summary time{display:inline-block;margin-left:12px;color:#536575;font-size:13px}#af-responses dt{font-weight:600}#af-responses dd{margin:4px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}#af-responses .af-registration-actions{margin-bottom:12px}#af-responses [role=status]:empty{display:none}@media(max-width:600px){#af-roster-open{padding:14px 12px;gap:8px}.af-roster-heading,.af-roster-body{padding:12px}#af-responses summary time{display:block;margin-left:18px}#af-roster-dialog{border-left:0}.af-roster-label{font-size:16px}.af-roster-open-action{font-size:13px}}
.ar-page{margin:0;font:16px system-ui,sans-serif;letter-spacing:0;color:#17212b;background:#f5f7f9}.ar-page *{box-sizing:border-box}.ar-top{position:sticky;top:0;background:white;border-bottom:1px solid #dbe3ee;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;z-index:1}
.ar-main{max-width:700px;margin:auto;padding:24px 18px}.ar-main h1{font-size:24px;overflow-wrap:anywhere}.ar-main img{display:block;width:100%;height:auto;object-fit:contain}.ar-main #ar-cover-link{display:block;margin-bottom:20px}.ar-main p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.ar-event{display:block;padding:18px 0;border-bottom:1px solid #dbe3ee;color:#1661ab;text-decoration:none;font-weight:600;overflow-wrap:anywhere}.ar-event small{display:block;color:#536575;font-weight:400;margin-top:6px}
[hidden]{display:none!important}@media(max-width:700px){.af-columns{grid-template-columns:1fr}.af-preview{border-left:0;border-top:1px solid #dbe3ee;padding:18px 0 0}.af-field-editor,.af-rule{grid-template-columns:1fr}.af-top{align-items:stretch}.af-section{margin-top:16px}}
</style>`;

export function decorateActivityAdminHtml(html) {
  const registrationWindowPanel = `<style>.af-response-info{min-width:0}.af-registration-attendance{margin:6px 0;color:#475569;font-size:14px;overflow-wrap:anywhere}.af-registration-attendance[data-attendance=checked-in]{color:#16654a}.af-attendance-summary{padding:10px 12px;background:#edf7f1;border-radius:6px;line-height:1.6}.af-response-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;border-top:1px solid #dbe3ee;padding:12px 0}#af-responses .af-response-row details{border-top:0;padding:6px 0}#af-roster-dialog .af-cancel-button{color:#b91c1c;background:#fff1f2;border-color:#fda4af;font-weight:600}#af-roster-dialog .af-cancel-button:hover{background:#ffe4e6}#af-roster-status:not(:empty){padding:10px 12px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;color:#9a3412}#af-roster-dialog .af-cancel-button:disabled{cursor:default}@media(max-width:480px){.af-response-row{gap:6px}#af-roster-dialog .af-response-row .af-cancel-button{padding:8px;font-size:13px}}</style><section class="af-window" aria-labelledby="af-window-heading"><h3 id="af-window-heading">報名時間（台北時間）</h3><label for="registration_start_at">接受報名時間</label><input id="registration_start_at" name="registration_start_at" type="datetime-local"><label for="registration_end_at">報名截止時間</label><input id="registration_end_at" name="registration_end_at" type="datetime-local"></section>`;
  const rosterPanel = `<section id="af-roster" aria-labelledby="af-roster-heading"><h2 id="af-roster-heading"><button id="af-roster-open" type="button" aria-haspopup="dialog" aria-controls="af-roster-dialog" disabled><span><span class="af-roster-label">報名名單 <span id="af-roster-count"></span></span><small id="af-roster-preview">請先選取活動。</small></span><span class="af-roster-open-action">查看名單 <span aria-hidden="true">›</span></span></button></h2></section>`;
  const rosterDrawer = `<dialog id="af-roster-dialog" aria-labelledby="af-roster-dialog-title"><div class="af-roster-heading"><h2 id="af-roster-dialog-title">報名名單 <span id="af-roster-dialog-count"></span></h2><div class="af-roster-tools"><button id="af-roster-refresh" type="button" title="重新載入報名名單" aria-label="重新載入報名名單" disabled>↻</button><button id="af-roster-close" type="button" title="關閉報名名單" aria-label="關閉報名名單">×</button></div></div><div class="af-roster-body"><strong id="af-roster-event"></strong><p id="af-roster-status" role="status" aria-live="polite">請先選取活動。</p><div id="af-responses"></div></div></dialog>`;
  const registrationPanel = `<section id="af-registration" class="af-registration" aria-labelledby="af-registration-heading" hidden>
    <h3 id="af-registration-heading">活動報名 QR 與網址</h3><div class="af-registration-layout">
    <div><img id="af-registration-qr" alt="活動報名 QR" width="180" height="180"><p id="af-registration-qr-error" role="status" hidden>QR 暫時無法載入，報名網址仍可使用。</p></div>
    <div><strong id="af-registration-title"></strong><p id="af-registration-status" role="status"></p>
    <label class="af-registration-label" for="af-registration-url">報名網址</label><input id="af-registration-url" readonly>
    <div class="af-registration-actions"><button id="af-registration-copy" class="btn" type="button">複製報名網址</button><a id="af-registration-open" target="_blank" rel="noopener">開啟報名頁</a><button id="af-registration-settings" class="btn" type="button">設定報名欄位</button></div>
    <p id="af-registration-copy-status" role="status" aria-live="polite"></p></div></div></section>`;
  const panel = `<section id="af-section" class="af-section" hidden>
    <div class="af-top"><h2>報名自填欄位</h2><span id="af-revision"></span><select id="af-event" aria-label="報名欄位所屬活動"></select><button type="button" id="af-refresh" title="重新載入" aria-label="重新載入">↻</button><a href="/sakura-admin?reauth=1" target="_blank" rel="noopener">管理員登入</a><a id="af-link" target="_blank" rel="noopener" hidden>開啟報名頁</a></div>
    <div id="af-auth-notice" role="alert" hidden><span id="af-auth-message"></span><a id="af-auth-login" href="/sakura-admin?reauth=1" target="_blank" rel="noopener">重新登入</a></div>
    <form id="af-editor"><fieldset id="af-controls"><label for="af-requirements">AI 欄位需求</label><textarea id="af-requirements" maxlength="6000" placeholder="例如：部門、員工姓名、工號、手機、報名人數、攜眷年齡分組、交換禮物人數、才藝曲目。請勿貼上真實個資。"></textarea>
    <div class="af-actions"><button id="af-generate" type="button" class="af-primary">AI 生成欄位</button><button id="af-add" type="button">新增欄位</button></div><ul id="af-warnings"></ul>
    <div class="af-columns"><div><div id="af-fields"></div><h3>人數驗證</h3><div id="af-rules"></div><button id="af-add-rule" type="button">新增驗證規則</button></div><section class="af-preview"><h3>報名表預覽</h3><div id="af-preview"></div></section></div>
    <label><input id="af-confirm" type="checkbox">我已確認欄位、年齡分組及人數驗證</label><button id="af-save" type="submit" class="af-primary" disabled>確認儲存報名欄位</button></fieldset><div id="af-status" role="status" aria-live="polite"></div></form></section>`;
  return decorateActivityTutorialHtml(decorateActivityQrWorkspace(html.replace("</head>", styles + activityImportStyles + activityCoverStyles + activityEditorSectionStyles + activityLotteryStyles + '<script id="af-line-sdk" async src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script></head>')
    .replace('<section class="stats">', '<div id="af-dashboard-notice" role="status" aria-live="polite"><span id="af-dashboard-message">正在載入活動...</span><a href="/sakura-admin?reauth=1" target="_blank" rel="noopener">管理員登入</a><button id="af-dashboard-retry" class="btn" type="button">重新載入</button></div><section class="stats">')
    .replace('load().catch(e=>toast(e.message));', 'window.addEventListener("DOMContentLoaded",async()=>{try{const requested=new URLSearchParams(location.search).get("event_id");await load(requested);const target=requested&&state.events.find(event=>event.id===requested);if(target)fill(target);}catch(e){toast(e.message)}},{once:true});')
    .replace('if(!j.success)throw new Error(j.message||"讀取失敗");return j}', 'if(!r.ok||!j.success){const error=new Error(j.message||"讀取失敗");error.auth=[401,403].includes(r.status);throw error;}return j}')
    .replace('<form id="eventForm">', activityImportPanel + '<form id="eventForm">' + registrationWindowPanel + activityCoverPanel + activityKeywordPanel)
    .replace('function fill(e){', 'function fill(e){for(const key of ["registration_start_at","registration_end_at"]){document.getElementById(key).value=toLocalInput(e[key]);}')
    .replace('<div id="qrPanel"', registrationPanel + '<div id="qrPanel"')
    .replace(/<table><thead><tr><th>活動<\/th>[\s\S]*?<tbody id="eventRows"><\/tbody><\/table>/, table => '<details id="af-event-list" class="af-event-list"><summary><span class="af-list-title">活動清單</span><span class="af-list-action"><span class="af-list-open">展開清單</span><span class="af-list-close">收合清單</span><span class="af-list-chevron" aria-hidden="true"></span></span></summary><div class="af-event-list-scroll">' + table + '</div></details>')
    .replace('<img id="qrImg"', '<h3 class="af-checkin-heading">活動簽到 QR 與網址</h3><img id="qrImg"')
    .replace('<h2>出席名單</h2>', activityLotteryPanel + rosterPanel + '<h2 id="af-attendance-heading">已簽到名單 <span id="af-attendance-count"></span></h2>')
    .replace("<h1>活動簽到管理</h1>", '<h1>活動簽到管理</h1><a href="#af-section">報名自填欄位</a>')
    .replace("</main>", panel + "</main>")
    .replace("</body>", rosterDrawer + activityLotteryDialog + "<script>(" + installActivityFormEditor + ")(" + activityFormWidgets + "," + installActivityImport + "," + installActivityCover + "," + activityEditorSections + "," + installActivityLottery + ");</script></body>")))
    .replaceAll('<a href="/sakura-admin?reauth=1"', '<a data-activity-login hidden href="/sakura-admin?reauth=1"');
}

export function buildActivityRegistrationHtml(language) {
  const locale = normalizeActivityLocale(language), copy = ACTIVITY_COPY[locale];
  return `<!doctype html><html lang="${copy.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.title} | SAKURA Welfare</title>${styles}<style>.ar-top{flex-wrap:wrap}.ar-top a{color:#1661ab}.ar-top select{width:auto;max-width:100%;flex:0 1 150px}#ar-translation{color:#805200;font-size:14px}.ar-page button{white-space:normal;overflow-wrap:anywhere}</style><script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script></head>
  <body class="ar-page"><header class="ar-top"><a href="/activity-registration?lang=${locale}">${copy.title}</a><select id="ar-language" aria-label="Language"><option value="zh">繁體中文</option><option value="id">Bahasa Indonesia</option><option value="th">ภาษาไทย</option></select><button id="ar-close" type="button">${copy.close}</button></header><main class="ar-main"><a id="ar-cover-link" target="_blank" rel="noopener" hidden><img id="ar-cover" alt="${copy.cover}" hidden><span id="ar-cover-error" hidden>${copy.imageUnavailable}</span></a><h1 id="ar-title">${copy.title}</h1><p id="ar-info"></p><p id="ar-translation" role="status"></p><div id="ar-events"></div><form id="ar-form" hidden><div id="ar-fields"></div><button id="ar-submit" class="af-primary" type="submit">${copy.submit}</button></form><div id="ar-status" role="status" aria-live="polite">${copy.checking}</div></main>
  <script>(${installActivityRegistration})(${activityFormWidgets},${JSON.stringify(locale)},${JSON.stringify(copy)},${activityLocaleBrowser});</script></body></html>`;
}
