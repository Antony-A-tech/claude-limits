# Clawd Mochi — Claude Limits

A tiny, polished Chrome/Edge extension that shows your **Claude usage limits** at a glance:

- **Session (5h)** utilization with a live "resets in …" countdown
- **Weekly (7d)** utilization
- Optional: forwards the numbers to a physical **Clawd Mochi** desk crab (ESP32 + display) over a small local USB helper

It reads usage from your **existing claude.ai browser session** — no passwords, no tokens, nothing stored remotely.

## How it works

```
claude.ai (your session)  ──▶  extension  ──▶  popup UI
                                   │
                                   └──▶  http://127.0.0.1:7654  ──▶  USB ──▶  🦀 crab
```

The background service worker polls `https://claude.ai/api/organizations/{org}/usage` using your
logged-in cookies, caches the result for the popup, and (optionally) POSTs
`session%,weekly%,reset` to a localhost helper that relays it to the crab over serial.

## Features

- Clean, content-fit popup — or pop it out into a small always-visible **window**
- **EN / RU** interface (auto-detected from the browser)
- Custom segmented controls (no clunky native dropdowns)
- Pick your **organization** explicitly, or let it auto-detect the one with the active subscription
- Adjustable refresh interval (background polling floor is ~30 s, a Chrome limit)

## Install (unpacked, for development)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open **claude.ai** and sign in, then click the toolbar icon

## Privacy

- Uses only your current claude.ai session cookies (same as the website).
- No credentials are read or stored. Cached usage lives in `chrome.storage.local` on your machine.
- The only network calls are to `claude.ai` (usage) and, if you run it, `127.0.0.1` (the local crab helper).

## The crab (optional)

The desk-crab firmware + local helper live in a separate repository. The extension works fully on
its own — the crab is just a fun physical readout.

## License

MIT — see [LICENSE](LICENSE).
