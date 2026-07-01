// Clawd Limits popup — i18n, live metric, custom controls, content-fit window.

const DEF = { intervalSec: 60, viewMode: "popup", orgId: "", lang: "", compact: false, showSonnet: false, showExtra: false, theme: "light" };
const IS_WIN = new URLSearchParams(location.search).get("win") === "1";
let settings = { ...DEF };
let latest = null;
let pollTimer = null;

const $ = (id) => document.getElementById(id);
const content = $("content");

const I18N = {
  en: {
    limits: "LIMITS", language: "LANGUAGE", view: "VIEW", refresh: "REFRESH EVERY",
    org: "ORGANIZATION", choose: "choose", auto: "auto-pick", window: "Window", popup: "Popup",
    session: "SESSION · 5H", weekly: "WEEKLY · 7D", resetsIn: "resets in", now: "now",
    capSonnet: "WEEKLY · SONNET", capExtra: "EXTRA USAGE", extras: "OPTIONAL LIMITS",
    ckSonnet: "Sonnet weekly", ckExtra: "Extra usage", spent: "spent",
    theme: "THEME", thLight: "Light", thDark: "Dark",
    connected: "connected", notSignedIn: "not signed in on claude.ai", loading: "loading…",
    notConnTitle: "Not signed in.", notConnBody: "Open <b>claude.ai</b> in this browser and sign in.",
    noOrgs: "no orgs — sign in?", errOrgs: "error loading orgs",
    updated: (v) => `updated ${v} ago`,
  },
  ru: {
    limits: "ЛИМИТЫ", language: "ЯЗЫК", view: "ВИД", refresh: "ОБНОВЛЕНИЕ",
    org: "ОРГАНИЗАЦИЯ", choose: "выбрать", auto: "авто", window: "Окно", popup: "Попап",
    session: "СЕССИЯ · 5Ч", weekly: "НЕДЕЛЯ · 7Д", resetsIn: "сброс через", now: "сейчас",
    capSonnet: "НЕДЕЛЯ · SONNET", capExtra: "ДОП. РАСХОД", extras: "ДОП. ЛИМИТЫ",
    ckSonnet: "Sonnet (неделя)", ckExtra: "Доп. расход", spent: "потрачено",
    theme: "ТЕМА", thLight: "Светлая", thDark: "Тёмная",
    connected: "подключено", notSignedIn: "вход в claude.ai не выполнен", loading: "загрузка…",
    notConnTitle: "Вход не выполнен.", notConnBody: "Откройте <b>claude.ai</b> в этом браузере и войдите.",
    noOrgs: "нет организаций — войдите?", errOrgs: "ошибка загрузки",
    updated: (v) => `обновлено ${v} назад`,
  },
};
const t = (k) => I18N[settings.lang][k];

function levelColor(p) {
  if (p < 50) return ["var(--green)", "var(--green-d)"];
  if (p < 75) return ["var(--yellow)", "var(--yellow-d)"];
  if (p < 90) return ["var(--amber)", "var(--amber-d)"];
  return ["var(--red)", "var(--red-d)"];
}
function setFill(id, p) {
  const e = $(id); if (!e) return;
  const c = levelColor(p);
  e.style.width = Math.min(Math.max(p, 0), 100) + "%";
  e.style.background = `linear-gradient(180deg, ${c[0]}, ${c[1]})`;
}

function fmtRemain(iso) {
  if (!iso) return "--";
  let s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return t("now");
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const u = settings.lang === "ru" ? ["ч", "м", "с"] : ["h", "m", "s"];
  return h ? `${h}${u[0]} ${m}${u[1]}` : `${m}${u[1]} ${String(s).padStart(2, "0")}${u[2]}`;
}
function fmtAgo(ts) {
  if (!ts) return "";
  const sec = Math.floor((Date.now() - ts) / 1000);
  const ru = settings.lang === "ru";
  let v;
  if (sec < 60) v = ru ? `${sec} с` : `${sec}s`;
  else { const m = Math.floor(sec / 60); v = m < 60 ? (ru ? `${m} мин` : `${m}m`) : (ru ? `${Math.floor(m / 60)} ч` : `${Math.floor(m / 60)}h`); }
  return I18N[settings.lang].updated(v);
}

// ── window sizing (separate-window mode only) ─────────────────────
let resizeT;
function resizeWindow() {
  if (!IS_WIN) return;
  clearTimeout(resizeT);
  resizeT = setTimeout(async () => {
    try {
      const win = await chrome.windows.getCurrent();
      const h = Math.ceil(document.body.scrollHeight) + (win.height - window.innerHeight);
      const w = Math.ceil(document.body.offsetWidth) + (win.width - window.innerWidth);
      chrome.windows.update(win.id, { height: h, width: w });
    } catch (e) {}
  }, 30);
}

// ── rendering ─────────────────────────────────────────────────────
const REFRESH_SVG = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';

function metricShell() {
  optSig = "";
  content.innerHTML =
    '<div class="metric">' +
    `<div class="cap">${t("session")}</div>` +
    '<div class="pct"><span id="pv">--</span><small>%</small></div>' +
    '<div class="bar"><div class="fill" id="bf"></div></div>' +
    `<div class="reset">${t("resetsIn")} <b id="rst">--</b></div>` +
    '<div class="divider"></div>' +
    `<div class="wkhead"><div class="cap">${t("weekly")}</div><div class="v" id="wv">--%</div></div>` +
    '<div class="barmini"><div class="fill" id="bw"></div></div>' +
    '<div id="opt"></div>' +
    `<div class="foot"><span class="ago" id="ago"></span><button id="refresh" class="ico">${REFRESH_SVG}</button></div>` +
    '</div>';
  $("refresh").addEventListener("click", pollNow);
}

// Optional extra rows (Sonnet weekly / Extra usage) — toggled in settings.
// Rebuild structure only when the visible set changes; otherwise just update values.
let optSig = "";
function renderOptional(l) {
  const opt = $("opt"); if (!opt) return;
  const showSn = settings.showSonnet;                 // show the row whenever the toggle is on...
  const showEx = settings.showExtra;
  const sig = `${showSn ? 1 : 0}${showEx ? 1 : 0}|${settings.lang}`;
  if (sig !== optSig) {
    let html = "";
    if (showSn) html +=
      '<div class="divider"></div>' +
      `<div class="wkhead"><div class="cap">${t("capSonnet")}</div><div class="v" id="snv">--%</div></div>` +
      '<div class="barmini"><div class="fill" id="snbar"></div></div>';
    if (showEx) html +=
      '<div class="divider"></div>' +
      `<div class="wkhead"><div class="cap">${t("capExtra")}</div><div class="v" id="exv">--</div></div>` +
      '<div class="barmini"><div class="fill" id="exbar"></div></div>';
    opt.innerHTML = html;
    optSig = sig;
  }
  const sn = l && l.sonnet, ex = l && l.extra;        // ...with "—" if the API returns no data for it
  if (showSn) { $("snv").textContent = sn ? sn.pct + "%" : "—"; setFill("snbar", sn ? sn.pct : 0); }
  if (showEx) { $("exv").textContent = ex ? `${ex.spent} · ${ex.percent}%` : "—"; setFill("exbar", ex ? ex.percent : 0); }
}

function setStatus(state) {
  $("dot").className = "dot " + (state || "");
  $("statusTxt").textContent = state === "ok" ? t("connected") : state === "err" ? t("notSignedIn") : "—";
}

function showMetric(l) {
  if (!l) { setStatus(""); content.innerHTML = `<div class="msg">${t("loading")}</div>`; resizeWindow(); return; }
  if (l.ok === false) {
    setStatus("err");
    content.innerHTML = `<div class="msg"><b>${t("notConnTitle")}</b><br>${t("notConnBody")}</div>`;
    resizeWindow(); return;
  }
  setStatus("ok");
  if (!$("pv")) metricShell();
  $("pv").textContent = l.s;
  setFill("bf", l.s);
  $("wv").textContent = l.w + "%";
  setFill("bw", l.w);
  if ($("cpv")) { $("cpv").textContent = l.s; setFill("cbf", l.s); }   // compact chip
  renderOptional(l);
  tick();
  resizeWindow();
}

function tick() {
  if (!latest || latest.ok === false) return;
  if ($("rst")) $("rst").textContent = fmtRemain(latest.resetAt);
  if ($("crst")) $("crst").textContent = fmtRemain(latest.resetAt);   // compact chip
  if ($("ago")) $("ago").textContent = fmtAgo(latest.ts);
}

// ── data ──────────────────────────────────────────────────────────
async function loadLatest() {
  const { latest: l } = await chrome.storage.local.get("latest");
  latest = l; showMetric(l);
}
async function pollNow() {
  try { await chrome.runtime.sendMessage({ type: "poll" }); } catch (e) {}
  await loadLatest();
}
function restartPollTimer() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollNow, Math.max(30, settings.intervalSec || 60) * 1000);
}

// ── settings ──────────────────────────────────────────────────────
async function saveSettings() {
  await chrome.storage.local.set({ settings });
  try { await chrome.runtime.sendMessage({ type: "applySettings" }); } catch (e) {}
}
function markSeg(seg, attr, val) {
  seg.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset[attr] === String(val)));
}
function syncControls() {
  markSeg($("segLang"), "l", settings.lang);
  markSeg($("segTheme"), "th", settings.theme);
  markSeg($("segView"), "v", settings.viewMode);
  markSeg($("segInt"), "s", settings.intervalSec);
  $("ckSonnet").checked = !!settings.showSonnet;
  $("ckExtra").checked = !!settings.showExtra;
  $("orgId").value = settings.orgId || "";
}
function applyLang() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll("[data-i18n]").forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  content.innerHTML = "";        // force metric shell rebuild in new language
  showMetric(latest);
  syncControls();
}
function applyTheme() {
  document.documentElement.classList.toggle("dark", settings.theme === "dark");
}

$("gear").addEventListener("click", () => {
  const open = $("panel").classList.toggle("open");
  $("gear").classList.toggle("on", open);
  setTimeout(resizeWindow, IS_WIN ? 0 : 0);
});
$("compact").addEventListener("click", () => setCompact(true));
$("cexpand").addEventListener("click", () => setCompact(false));
function setCompact(on) {
  document.body.classList.toggle("compact", on);
  settings.compact = on;
  saveSettings();
  showMetric(latest);
  resizeWindow();
}
$("popout").addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "popout" }); window.close(); } catch (e) {}
});
$("segLang").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  settings.lang = b.dataset.l; applyLang(); saveSettings();
});
$("segTheme").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  settings.theme = b.dataset.th; applyTheme(); markSeg($("segTheme"), "th", settings.theme); saveSettings();
});
$("segView").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  settings.viewMode = b.dataset.v; markSeg($("segView"), "v", settings.viewMode); saveSettings();
});
$("segInt").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  settings.intervalSec = parseInt(b.dataset.s, 10);
  markSeg($("segInt"), "s", settings.intervalSec); saveSettings(); restartPollTimer();
});
$("ckSonnet").addEventListener("change", () => {
  settings.showSonnet = $("ckSonnet").checked; saveSettings(); showMetric(latest); resizeWindow();
});
$("ckExtra").addEventListener("change", () => {
  settings.showExtra = $("ckExtra").checked; saveSettings(); showMetric(latest); resizeWindow();
});
$("orgId").addEventListener("change", () => {
  settings.orgId = $("orgId").value.trim(); saveSettings(); pollNow();
});
$("pick").addEventListener("click", async () => {
  const list = $("orglist");
  if (list.classList.contains("open")) { list.classList.remove("open"); resizeWindow(); return; }
  list.innerHTML = `<div class="org"><div class="nm">${t("loading")}</div></div>`;
  list.classList.add("open"); resizeWindow();
  try {
    const r = await fetch("https://claude.ai/api/organizations", { credentials: "include", headers: { Accept: "application/json" } });
    const orgs = await r.json();
    list.innerHTML = "";
    for (const o of (orgs || [])) {
      const el = document.createElement("button");
      el.className = "org";
      el.innerHTML = `<div class="nm">${o.name || "Organization"}</div><div class="id">${o.uuid}</div>`;
      el.addEventListener("click", () => {
        settings.orgId = o.uuid; $("orgId").value = o.uuid;
        list.classList.remove("open"); resizeWindow();   // collapse after choosing
        saveSettings(); pollNow();
      });
      list.appendChild(el);
    }
    if (!list.children.length) list.innerHTML = `<div class="org"><div class="nm">${t("noOrgs")}</div></div>`;
  } catch (e) {
    list.innerHTML = `<div class="org"><div class="nm">${t("errOrgs")}</div></div>`;
  }
  resizeWindow();
  setTimeout(() => $("orglist").scrollIntoView({ block: "nearest" }), 120);
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.latest) { latest = ch.latest.newValue; showMetric(latest); }
});

// ── init ──────────────────────────────────────────────────────────
(async () => {
  if (IS_WIN) document.body.classList.add("win");
  const { settings: s } = await chrome.storage.local.get("settings");
  settings = { ...DEF, ...(s || {}) };
  if (!settings.lang) settings.lang = (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  if (settings.compact) document.body.classList.add("compact");
  applyTheme();
  applyLang();          // sets labels + renders cached state
  await loadLatest();
  pollNow();
  restartPollTimer();
  setInterval(tick, 1000);
})();
