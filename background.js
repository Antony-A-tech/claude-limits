// Clawd Mochi Limits — background service worker.
// Polls your Claude usage (browser session), caches it for the popup, and
// forwards "session%,weekly%,reset" to the local helper (-> crab).
// Settings: poll interval + view mode (toolbar popup vs separate window).

const HELPER = "http://127.0.0.1:7654/limits";
const DEFAULTS = { intervalSec: 60, viewMode: "popup", orgId: "" };

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return Object.assign({}, DEFAULTS, settings || {});
}

async function applySettings() {
  const s = await getSettings();
  const minutes = Math.max(0.5, (s.intervalSec || 60) / 60); // alarms: ~30s floor (unpacked)
  chrome.alarms.create("poll", { periodInMinutes: minutes });
  // window mode = clear the toolbar popup so the icon click opens a window instead
  try { await chrome.action.setPopup({ popup: s.viewMode === "window" ? "" : "popup.html" }); } catch (e) {}
}

function openWindow() {
  // popup.js resizes the window to fit its content (?win=1)
  chrome.windows.create({ url: "popup.html?win=1", type: "popup", width: 312, height: 240 });
}

async function getJSON(url) {
  const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}

// Pick the org that actually has the subscription usage (NOT necessarily the
// first one): prefer an active 5h window, then highest session + weekly usage.
async function bestUsage() {
  const orgs = await getJSON("https://claude.ai/api/organizations");
  if (!Array.isArray(orgs) || !orgs.length) throw new Error("no organizations");
  let best = null, bestScore = -1;
  for (const o of orgs) {
    try {
      const u = await getJSON(`https://claude.ai/api/organizations/${o.uuid}/usage`);
      const fhU = (u.five_hour && typeof u.five_hour.utilization === "number") ? u.five_hour.utilization : 0;
      const sdU = (u.seven_day && typeof u.seven_day.utilization === "number") ? u.seven_day.utilization : 0;
      const active = (u.five_hour && u.five_hour.resets_at) ? 1000 : 0;
      const score = active + fhU + sdU;
      console.log("[clawd] org", o.name, "5h", fhU, "7d", sdU, "active", !!active, "score", score);
      if (score > bestScore) { bestScore = score; best = u; }
    } catch (e) { console.log("[clawd] org usage error", o.uuid, String(e)); }
  }
  if (!best) throw new Error("no usable org usage");
  return best;
}

function fmtReset(iso) {
  if (!iso) return "--";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

function fmtMoney(minor, exp, cur) {
  const v = (minor || 0) / Math.pow(10, exp == null ? 2 : exp);
  const sym = { USD: "$", EUR: "€", GBP: "£" }[cur] || "";
  const n = v.toFixed(exp == null ? 2 : exp);
  return sym ? `${sym}${n}` : `${n} ${cur || ""}`.trim();
}

async function poll() {
  try {
    const st = await getSettings();
    const u = (st.orgId && st.orgId.trim())
      ? await getJSON(`https://claude.ai/api/organizations/${st.orgId.trim()}/usage`)
      : await bestUsage();
    const s = Math.round((u.five_hour && u.five_hour.utilization) || 0);
    const w = Math.round((u.seven_day && u.seven_day.utilization) || 0);
    const resetAt = (u.five_hour && u.five_hour.resets_at) || null;
    const reset = fmtReset(resetAt);
    const payload = `${s},${w},${reset}`;

    // optional extras (shown only if enabled in settings)
    const sd = u.seven_day_sonnet;
    const sonnet = (sd && typeof sd.utilization === "number")
      ? { pct: Math.round(sd.utilization), resetAt: sd.resets_at || null } : null;
    const su = u.spend && u.spend.used;
    const extra = {
      spent: fmtMoney(su ? su.amount_minor : 0, su ? su.exponent : 2, su ? su.currency : "USD"),
      percent: Math.round((u.spend && u.spend.percent) || 0),
      enabled: !!(u.spend && u.spend.enabled),
    };

    await chrome.storage.local.set({ latest: { s, w, reset, resetAt, sonnet, extra, ts: Date.now(), ok: true } });

    try {
      await fetch(HELPER, { method: "POST", headers: { "Content-Type": "text/plain" }, body: payload });
    } catch (e) { /* helper offline — popup still shows the value */ }
    return { s, w, reset };
  } catch (e) {
    await chrome.storage.local.set({ latest: { ok: false, error: String(e), ts: Date.now() } });
    throw e;
  }
}

chrome.runtime.onInstalled.addListener(() => { applySettings(); poll().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { applySettings(); poll().catch(() => {}); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "poll") poll().catch(() => {}); });

// Only fires in "window" mode (when the toolbar popup is cleared)
chrome.action.onClicked.addListener(() => openWindow());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "poll") {
    poll().then((r) => sendResponse({ ok: true, data: r }))
          .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === "applySettings") { applySettings().then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === "popout") { openWindow(); sendResponse({ ok: true }); return true; }
});
