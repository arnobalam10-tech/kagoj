# Kagoj v1 — Build Plan

Source of truth: [prd.md](prd.md). This plan maps the PRD phases into concrete, checkable tasks.
Progress is tracked in [STATE.md](STATE.md).

## Ground rules (from PRD §0, §3)
- Frontend is hand-written **ES5** IIFE modules on `window.Kagoj`. No `let/const`, arrows, classes, template literals, `fetch`, Promises, Map/Set, etc.
- No runtime dependencies. Dev-only: ESLint (ecmaVersion 5) + a Node build script.
- Supabase via raw `XMLHttpRequest` to `/auth/v1` and `/rest/v1` only. No `supabase-js`.
- CSS: no grid, no custom properties, no flex `gap`, `-webkit-` prefixes, no `100vh`.
- Local-first: IndexedDB (localStorage fallback) is the device source of truth.

## Infrastructure
| Item | Plan |
|---|---|
| Repo | `github.com/arnobalam10-tech/kagoj`, branch `main` |
| Hosting | Vercel project linked to the GitHub repo; build `node scripts/build.js`, output `dist/` |
| Backend | Supabase project (Postgres + Auth), schema in `supabase/schema.sql`, applied via migration |
| Config | `js/config.js` holds Supabase URL + anon (publishable) key. Never the service_role key. |

## Phase 0 — Device spike
- [ ] `spike/index.html`: single canvas, midpoint-smoothed finger drawing, Clear, FPS readout
- [ ] XHR test button (`/auth/v1/settings`, `/rest/v1/`), storage test button (IDB write/read/delete)
- [ ] Deployed at `/spike/` alongside the app so it can be opened on the iPad
- [ ] **Manual (owner):** test on iPad in Safari + home screen; install ISRG Root X1 / GTS Root R1 profile if certs fail

## Phase 1 — Drawing engine (single page)
- [ ] `core/util.js`, `core/dom.js`, `core/log.js`
- [ ] `draw/geometry.js` (RDP 0.35, resample ≤4, bbox, seg distance)
- [ ] `draw/codec.js` (v1 format, ×10 ints, delta encoding)
- [ ] `draw/viewport.js` (scale/offset, fit width/page, 0.5×fit..4×, pan limits, CSS-transform pinch)
- [ ] `draw/render.js` (paper styles, batched stroke render by colour+width, dirty rect, DPR scaling)
- [ ] `draw/input.js` (touch w/ 100ms pending, 3px activate, 2nd finger → gesture; Pointer Events; mouse wheel)
- [ ] `draw/eraser.js` (bbox prefilter, partial split / whole-stroke)
- [ ] `draw/history.js` (add / erase / clear, depth 100, per page)
- [ ] `draw/engine.js` (4 layers: paper, highlight @0.4 opacity, ink, live)
- [ ] `store/store.js`, `store/idb.js`, `store/ls.js` (self-test + fallback, eviction at 80%)

## Phase 2 — Notebooks & pages (local)
- [ ] `ui/router.js` hash routes `#/login`, `#/`, `#/nb/<id>/<idx>`, `#/settings`
- [ ] `ui/sheets.js` modal/action sheet/confirm/toast
- [ ] `ui/dashboard.js`: top bar, search, Recent row, grid (4/3/2 cols), new-notebook sheet (8 colours, 4 papers), long-press / ⋯ actions: rename, recolour, duplicate, delete (soft)
- [ ] `ui/workspace.js` + `ui/toolbar.js`: tools, swatches, sizes, zoom, page nav, add page, page list, ⋯ menu (paper, delete page, clear page, hide toolbars, view mode), title rename
- [ ] Remember last notebook/page; next-page preload; gapped positions
- [ ] Icons (152 apple-touch, launch image), SVG sprite, Add-to-Home-Screen tip

## Phase 3 — Supabase auth & sync
- [ ] Schema + RLS + triggers + size/title checks + `client_logs` (migration)
- [ ] Owner user created, sign-ups disabled (dashboard — owner action if connector can't)
- [ ] `net/xhr.js` (timeouts 15s/45s), `net/supabase.js` (login, refresh queue, logout, REST helpers, token masking)
- [ ] `ui/login.js` with plain-language errors
- [ ] `sync/sync.js`: push (upsert notebooks; POST new pages; PATCH w/ revision guard), pull (server timestamps), conflict copies, backoff 5/15/30/60/120s, status pill states, triggers (3s after save, launch, foreground, 60s, online)
- [ ] RLS verification: anon key without token returns nothing

## Phase 4 — PC & iPhone
- [ ] Pointer/mouse, Ctrl+wheel zoom, wheel pan, Space-drag pan, keys P/H/E, Ctrl+Z/Shift+Z, ←/→
- [ ] High-DPI canvases
- [ ] iPhone: View mode default, pencil toggle, compact toolbar popover, 2-col dashboard

## Phase 5 — Polish & hardening
- [ ] `ui/settings.js`: recently deleted (restore, 30-day purge), storage info + warning, logout (+ clear device), reopen-last toggle, default zoom setting, debug toggle (tap version 5×)
- [ ] Debug overlay: logs, errors, backend, counts, frame time, FPS, device info; remote error logs
- [ ] Empty states, visual polish per §16
- [ ] Budgets check: JS < 120 KB min, CSS < 20 KB

## Build & deploy
- [ ] `scripts/build.js`: run ESLint (ES5), concat JS/CSS in order, minify (light, dependency-free), content-hash names, write `dist/index.html`
- [ ] `vercel.json`: `no-cache` for index.html, immutable for hashed assets
- [ ] Push to GitHub → Vercel auto-deploy; verify production URL

## Out of my reach (owner must do on the iPad)
- Acceptance criterion 15 (verification on the real iPad 2), certificate profile install, Add to Home Screen.
