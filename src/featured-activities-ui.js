import { ACTIVITY_COPY, normalizeActivityLocale, activityLocaleBrowser } from "./activity-locale.js";
import { CLUB_COPY, clubPanel, clubCss, clubScript } from "./club-ui.js";
import { storyPanel, storyScript } from "./activity-stories-ui.js";
import { LIFE_INFO_STATION_LABELS } from "./life-info-station.js";
import {MY_REGISTRATION_COPY,myRegistrationsPanel,myRegistrationsCss,installMyRegistrations} from './activity-self-service-ui.js';

const install = String.raw`function installFeaturedActivities(locale, copy, helpers, titles, installMine, mineCopy) {
  const { registrationUrl, timestamp, errorText } = helpers(locale, copy);
  const root = document.getElementById("fa-section"), list = document.getElementById("fa-list");
  const status = document.getElementById("fa-status"), login = document.getElementById("fa-login");
  const refresh = document.getElementById("fa-refresh");
  let busy = false, loaded = false, initialized = false, initializing = null;
  try { localStorage.setItem("sakura_activity_locale", locale); } catch { /* Storage is optional. */ }
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text || ""; return element; };
  async function initialize() {
    if (!window.liff) throw new Error(copy.sdk);
    if (!initialized) {
      if (!initializing) initializing = Promise.resolve(liff.init({ liffId: "__SAKURA_LIFF_ID__" })).then(() => { initialized = true; }).catch(error => { initializing = null; throw error; });
      await initializing;
    }
  }
  login.onclick = async () => {
    if (busy) return;
    busy = true; login.disabled = true; refresh.disabled = true;
    try {
      await initialize();
      // Keep only the destination, never replay OAuth callbacks or tokens.
      const url = new URL(location.pathname, location.origin); url.searchParams.set("view", "activities");
      if (liff.isInClient()) {
        location.href = "https://liff.line.me/__SAKURA_LIFF_ID__" + url.pathname + url.search;
        return;
      }
      if (liff.isLoggedIn()) liff.logout();
      liff.login({ redirectUri: url.href });
    } catch { status.textContent = copy.identity; }
    finally { busy = false; login.disabled = false; refresh.disabled = false; }
  };
  async function load() {
    if (busy) return;
    busy = true; loaded = false; refresh.disabled = true; login.hidden = true; status.textContent = copy.checking;
    list.replaceChildren();
    try {
      await initialize();
      if (!liff.isLoggedIn()) { status.textContent = copy.loginRequired; login.hidden = false; return; }
      const token = liff.getIDToken();
      if (!token) { login.hidden = false; throw new Error(copy.identity); }
      status.textContent = copy.loading;
      const response = await fetch("/api/activity-registration?lang=" + locale, {
        headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        // The list endpoint rejects failed LINE verification before querying activities.
        if (response.status === 401 || response.status === 403) {
          login.hidden = false;
          throw new Error(copy.identity);
        }
        throw new Error(errorText(result.message, {}, response.status));
      }
      const translations = result.translations || {};
      const t = value => Object.hasOwn(translations, value) ? translations[value] : value;
      for (const event of result.events || []) {
        const link = node("a"); link.className = "fa-event"; link.href = registrationUrl(event.id);
        try {
          const url = new URL(event.cover_image_url);
          if (url.protocol === "https:") {
            const image = document.createElement("img"); image.src = url.href; image.alt = ""; image.loading = "lazy";
            image.onerror = () => image.remove(); link.append(image);
          }
        } catch { /* Events without a poster use a text-only card. */ }
        const content = node("div");
        content.append(node("h3", t(event.title)), node("p", timestamp(event.start_at)), node("p", t(event.location)));
        const upcoming = event.registration_state === "not_started";
        const badge = node("span", upcoming ? copy.registrationUpcoming : copy.registrationOpen);
        badge.className = "fa-registration-status"; badge.dataset.state = upcoming ? "not_started" : "open";
        content.append(badge);
        if (upcoming && event.registration_start_at) {
          content.append(node("p", copy.registrationStarts + "：" + timestamp(event.registration_start_at)));
        }
        link.append(content); list.append(link);
      }
      status.textContent = !list.children.length ? copy.empty : result.translationStatus === "original" ? copy.original : "";
      loaded = true;
    } catch (error) { status.textContent = error.name === "TimeoutError" || error instanceof TypeError ? copy.failed : error.message; }
    finally { busy = false; refresh.disabled = false; }
  }
  let selectedView = "stores";
  function select(view) {
    const activities = view === "activities", clubs = view === "clubs";
    selectedView = view;
    document.title = titles[["stores", "directory", "activities", "clubs"].indexOf(view)];
    root.hidden = !activities;
    document.getElementById("club-section").hidden = !clubs;
    document.querySelector(".app")?.classList.toggle("club-wide", clubs);
    for (const selector of [".app > .filters", ".app > .content", ".app > .hero", ".app > .hero .search", ".app > .hero p"]) {
      const element = document.querySelector(selector); if (element) element.hidden = activities || clubs;
    }
    for (const name of ["stores", "directory", "activities", "clubs"]) {
      const tab = document.getElementById("fa-tab-" + name);
      tab.setAttribute("aria-selected", String(name === view)); tab.tabIndex = name === view ? 0 : -1;
    }
    const url = new URL(location.href);
    if (view !== "stores") url.searchParams.set("view", view); else url.searchParams.delete("view");
    history.replaceState(null, "", url);
    if (view === "stores" || view === "directory") {
      if (storePanel) storePanel.setAttribute("aria-labelledby", "fa-tab-" + view);
      window.sakuraPartnerDirectoryMode?.(view === "stores");
    }
    const heading = document.querySelector(".app > .hero h1");
    if (heading) heading.textContent = document.title;
    if (activities && !loaded) load();
    window.dispatchEvent(new Event(clubs ? "sakura-club-show" : "sakura-club-hide"));
    window.dispatchEvent(new Event(activities ? "sakura-stories-show" : "sakura-stories-hide"));
  }
  for (const view of ["stores", "directory", "activities", "clubs"]) document.getElementById("fa-tab-" + view).onclick = () => select(view);
  const storePanel = document.querySelector(".app > .content");
  if (storePanel) { storePanel.id = "fa-store-panel"; storePanel.setAttribute("role", "tabpanel"); storePanel.setAttribute("aria-labelledby", "fa-tab-stores"); }
  document.querySelector(".fa-tabs").onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const views = ["stores", "directory", "activities", "clubs"], index = views.indexOf(selectedView);
    const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (index + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length;
    select(views[next]); document.getElementById("fa-tab-" + views[next]).focus();
  };
  refresh.onclick = load;
  installMine(locale, mineCopy, { initialize, token: () => liff.isLoggedIn() ? liff.getIDToken() : "", login: () => { if (busy) return false; login.click(); return true; } });
  const view = new URLSearchParams(location.search).get("view");
  select(["directory", "activities", "clubs"].includes(view) ? view : "stores");
}`;

export function decorateFeaturedActivitiesHtml(html, language, searchParams = new URLSearchParams()) {
  const locale = normalizeActivityLocale(language), copy = ACTIVITY_COPY[locale];
  const tabLabels = [locale === "zh" ? "本期優惠" : copy.offers,
    ({zh:"特約店家",id:"Toko Mitra",th:"ร้านค้าสวัสดิการ"})[locale], copy.activities, CLUB_COPY[locale].title];
  const selectedView = ["directory", "activities", "clubs"].includes(searchParams.get("view")) ? searchParams.get("view") : "stores";
  const titleLabels = LIFE_INFO_STATION_LABELS[locale];
  const title = titleLabels[selectedView === "activities" && searchParams.get("stories") === "1" ? 4 : ["stores", "directory", "activities", "clubs"].indexOf(selectedView)];
  const tabText = (label) => locale === "zh" ? `<span aria-hidden="true">${label.slice(0, 2)}<br>${label.slice(2)}</span>` : label;
  const panel = `<nav class="fa-tabs" role="tablist" aria-label="${tabLabels[0]} / ${tabLabels[2]}">
    <button type="button" id="fa-tab-stores" role="tab" aria-selected="true" aria-controls="fa-store-panel" aria-label="${tabLabels[0]}">${tabText(tabLabels[0])}</button>
    <button type="button" id="fa-tab-directory" role="tab" aria-selected="false" tabindex="-1" aria-controls="fa-store-panel" aria-label="${tabLabels[1]}">${tabText(tabLabels[1])}</button>
    <button type="button" id="fa-tab-activities" role="tab" aria-selected="false" tabindex="-1" aria-controls="fa-section" aria-label="${tabLabels[2]}">${tabText(tabLabels[2])}</button>
    <button type="button" id="fa-tab-clubs" role="tab" aria-selected="false" tabindex="-1" aria-controls="club-section" aria-label="${tabLabels[3]}">${tabText(tabLabels[3])}</button></nav>
    <section id="fa-section" role="tabpanel" hidden aria-labelledby="fa-tab-activities">${storyPanel(locale)}${myRegistrationsPanel(locale)}<div class="fa-heading"><h2 id="fa-heading">${copy.activities}</h2>
    <button type="button" id="fa-refresh" title="${copy.retry}" aria-label="${copy.retry}">↻</button></div>
    <p id="fa-status" role="status" aria-live="polite"></p><button type="button" id="fa-login" hidden>${copy.login}</button><div id="fa-list"></div></section>`
    + clubPanel(locale).replace('id="club-section"', 'id="club-section" hidden role="tabpanel" aria-labelledby="fa-tab-clubs"');
  const css = `<style>
    .app [hidden],.app>.fa-tabs,.app>#fa-section>.story-switch{display:none!important}.fa-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:12px 12px;background:#fff;border-bottom:1px solid #dbe3ee}
    .fa-tabs button,#fa-section button{font:inherit;min-height:44px;cursor:pointer;color:#17212b;background:#fff;border:1px solid #cad5df;border-radius:6px;padding:8px 14px}
    .fa-tabs button{min-width:0;padding:8px 3px;line-height:1.3;white-space:normal;overflow-wrap:anywhere}
    .fa-tabs button[aria-selected=true],#fa-login{background:#c8103d!important;color:#fff!important;border-color:#c8103d!important}
    #fa-section{padding:18px;letter-spacing:0}#fa-section *{box-sizing:border-box;min-width:0}#fa-section h2{font-size:22px;margin:0;overflow-wrap:anywhere}
    .fa-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}#fa-refresh{width:44px;height:44px;padding:0!important;flex:none}#fa-refresh:disabled{opacity:.5}
    .app>.hero>h1,.app #fa-section>.fa-heading>h2,.app #club-section>.club-toolbar>h2{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}.app #fa-refresh,.app #club-refresh{margin-left:auto}
    #fa-status{line-height:1.6;overflow-wrap:anywhere}#fa-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px}
    .fa-event{display:flex;flex-direction:column;background:#fff;border:1px solid #dbe3ee;border-radius:8px;overflow:hidden;color:#17212b;text-decoration:none}
    .fa-event img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#f7f8fa}.fa-event>div{padding:16px}.fa-event h3{font-size:18px;line-height:1.6;margin:0 0 8px;overflow-wrap:anywhere}.fa-event p{font-size:14px;line-height:1.6;margin:4px 0;overflow-wrap:anywhere;color:#536575}
    .fa-event:focus-visible,.fa-tabs button:focus-visible{outline:3px solid #1661ab;outline-offset:2px}
    .fa-registration-status{display:inline-block;max-width:100%;margin:8px 0 4px;padding:4px 8px;border-radius:4px;background:#e8f8ee;color:#146c43;font-size:14px;font-weight:600;line-height:1.6;overflow-wrap:anywhere}
    .fa-registration-status[data-state=not_started]{background:#fff3cd;color:#805500}
    @media(max-width:540px){#fa-list{grid-template-columns:1fr}}
    </style>`;
  return html.replace(/<title>[^<]*<\/title>/, "<title>" + title + "</title>")
    .replace(/(<section class="hero"><h1>)[^<]*(<\/h1>)/, "$1" + title + "$2")
    .replace('<section class="hero">', selectedView === "activities" || selectedView === "clubs" ? '<section class="hero" hidden>' : '<section class="hero">')
    .replace('document.querySelector(".hero h1").textContent=DIRECTORY_COPY.title;', "")
    .replace("document.title=DIRECTORY_COPY.title;", "")
    .replace("</head>", css + clubCss + myRegistrationsCss + '<script defer src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script></head>')
    .replace('<section class="filters">', panel + '<section class="filters">')
    .replace("</body>", '<script>document.addEventListener("DOMContentLoaded",()=>(' + install + ")(" + JSON.stringify(locale)
      + "," + JSON.stringify(copy) + "," + activityLocaleBrowser + "," + JSON.stringify(titleLabels) + "," + installMyRegistrations + "," + JSON.stringify(MY_REGISTRATION_COPY[locale]) + "));</script>" + clubScript(locale) + storyScript(locale, titleLabels) + "</body>");
}
