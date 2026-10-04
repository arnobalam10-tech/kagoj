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
- [x] `spike/index.html`: single canvas, midpoint-smoothed finger drawing, Clear, FPS readout
- [x] XHR test button (`/auth/v1/settings`, `/rest/v1/`), storage test button (IDB write/read/delete)
- [x] Deployed at `/spike/` alongside the app so it can be opened on the iPad
- [ ] **Manual (owner):** test on iPad in Safari + home screen; install ISRG Root X1 / GTS Root R1 profile if certs fail

## Phase 1 — Drawing engine (single page)
- [x] `core/util.js`, `core/dom.js`, `core/log.js`
- [x] `draw/geometry.js` (RDP 0.35, resample ≤4, bbox, seg distance)
- [x] `draw/codec.js` (v1 format, ×10 ints, delta encoding)
- [x] `draw/viewport.js` (scale/offset, fit width/page, 0.5×fit..4×, pan limits, CSS-transform pinch)
- [x] `draw/render.js` (paper styles, batched stroke render by colour+width, dirty rect, DPR scaling)
- [x] `draw/input.js` (touch w/ 100ms pending, 3px activate, 2nd finger → gesture; Pointer Events; mouse wheel)
- [x] `draw/eraser.js` (bbox prefilter, partial split / whole-stroke)
- [x] `draw/history.js` (add / erase / clear, depth 100, per page)
- [x] `draw/engine.js` (4 layers: paper, highlight @0.4 opacity, ink, live)
- [x] `store/store.js`, `store/idb.js`, `store/ls.js` (self-test + fallback, eviction at 80%)

## Phase 2 — Notebooks & pages (local)
- [x] `ui/router.js` hash routes `#/login`, `#/`, `#/nb/<id>/<idx>`, `#/settings`
- [x] `ui/sheets.js` modal/action sheet/confirm/toast
- [x] `ui/dashboard.js`: top bar, search, Recent row, grid (4/3/2 cols), new-notebook sheet (8 colours, 4 papers), long-press / ⋯ actions: rename, recolour, duplicate, delete (soft)
- [x] `ui/workspace.js` + `ui/toolbar.js`: tools, swatches, sizes, zoom, page nav, add page, page list, ⋯ menu (paper, delete page, clear page, hide toolbars, view mode), title rename
- [x] Remember last notebook/page; next-page preload; gapped positions
- [x] Icons (152 apple-touch, launch image), SVG sprite, Add-to-Home-Screen tip

## Phase 3 — Supabase auth & sync
- [x] Schema + RLS + triggers + size/title checks + `client_logs` (migration)
- [x] Owner user created, sign-ups disabled (dashboard — owner action if connector can't)
- [x] `net/xhr.js` (timeouts 15s/45s), `net/supabase.js` (login, refresh queue, logout, REST helpers, token masking)
- [x] `ui/login.js` with plain-language errors
- [x] `sync/sync.js`: push (upsert notebooks; POST new pages; PATCH w/ revision guard), pull (server timestamps), conflict copies, backoff 5/15/30/60/120s, status pill states, triggers (3s after save, launch, foreground, 60s, online)
- [x] RLS verification: anon key without token returns nothing

## Phase 4 — PC & iPhone
- [x] Pointer/mouse, Ctrl+wheel zoom, wheel pan, Space-drag pan, keys P/H/E, Ctrl+Z/Shift+Z, ←/→
- [x] High-DPI canvases
- [x] iPhone: View mode default, pencil toggle, compact toolbar popover, 2-col dashboard

## Phase 5 — Polish & hardening
- [x] `ui/settings.js`: recently deleted (restore, 30-day purge), storage info + warning, logout (+ clear device), reopen-last toggle, default zoom setting, debug toggle (tap version 5×)
- [x] Debug overlay: logs, errors, backend, counts, frame time, FPS, device info; remote error logs
- [x] Empty states, visual polish per §16
- [x] Budgets check: JS < 120 KB min, CSS < 20 KB

## Build & deploy
- [x] `scripts/build.js`: run ESLint (ES5), concat JS/CSS in order, minify (light, dependency-free), content-hash names, write `dist/index.html`
- [x] `vercel.json`: `no-cache` for index.html, immutable for hashed assets
- [x] Push to GitHub → Vercel auto-deploy; verify production URL

## Out of my reach (owner must do on the iPad)
- Acceptance criterion 15 (verification on the real iPad 2), certificate profile install, Add to Home Screen.

---

# v1.1 — Uploads (course materials) + image placement + palm guard

Owner decisions (2026-10-03): free Supabase plan is fine; slides are exported to PDF; uploads are organised in
named **folders**; uploaded material opens like a notebook (write/draw freely) but never appears in the
Notebooks tab; any notebook can import pages from Uploads.

## Design
- **Documents are notebooks with `kind = 'document'`** and a `folder_id`. Reusing the notebook/page model
  means the workspace, undo, eraser, sync, conflict copies and soft delete all work for documents unchanged.
- **Folders**: new `folders` table (name, position, soft delete), synced like notebooks.
- **Storage**: private Supabase Storage bucket `uploads`, path `<user_id>/<doc_id>/p001.jpg` (page image,
  ≤1400 px wide, JPEG ~0.78) and `t001.jpg` (240 px thumbnail). RLS: first path segment must be `auth.uid()`.
  Originals are not stored (saves the 1 GB free quota; the PDF stays on the PC).
- **PDF rendering happens on the uploading device** (PC/phone, modern browser) with pdf.js 3.x legacy build,
  vendored from npm into `dist/vendor/pdfjs/` and loaded only when uploading. The iPad 2 never runs pdf.js;
  it only downloads page JPEGs. Photos (JPEG/PNG) can be uploaded from every device, iPad 2 included.
- **Page size per page**: a page's drawing already stores `w`/`h`. Documents use `w = 1000`,
  `h = 1000 × imageH / imageW`, so slides become landscape pages and A4 PDFs stay A4.
- **Backgrounds**: `pages.background_asset` (already in the schema) points to the page JPEG; drawn on the
  paper layer, under highlight and ink.
- **Placed images**: drawing JSON gets an additive `imgs` array `{id, a: assetPath, x, y, w, h}` (page units),
  drawn on the paper layer above the pattern, under highlight and ink. New **Select** tool: tap an image to
  select it, drag to move, drag the corner handle to resize (keeps aspect), Delete from a floating bar.
  Undoable (`img-add`, `img-set`, `img-del`). The eraser never touches images.
- **Asset cache** (`K.Assets`): memory LRU of decoded images (current and next page) → IndexedDB `assets`
  store (data URL strings, since iOS 9 IndexedDB cannot store Blobs) → download from Storage. Size-capped LRU
  (~40 MB on iOS 9, 250 MB elsewhere). Not cached on the localStorage fallback (fetched when online).
- **Import into a notebook**: workspace ⋯ → "Import from Uploads…" → folder → document → page picker
  (thumbnails, multi-select, Select all) → **Add as new pages** (after the current page) or
  **Place on this page** (then move/resize with Select). Also from a document's ⋯ → "Add pages to notebook…".
- **Delete**: folders/documents soft-delete into Recently deleted (30 days). Purge deletes Storage files only
  when no other live page still references them (`kagoj_asset_in_use()` SQL function).
- **Palm guard**: (a) "Pencil only" mode (auto-offered when a stylus touch is seen; `touchType === 'stylus'`
  on modern iPads), (b) optional wrist guard: a draggable shaded strip where touches are ignored,
  (c) while a stroke is active, other touches are ignored (already in v1).

## Tasks
- [x] Migration: `folders`, `notebooks.kind/folder_id/source_name`, `pages.background_asset` in sync,
      storage bucket + policies, `kagoj_asset_in_use()`
- [x] Local store v2 (`folders`, `assets` stores); Repo: folders, documents, kind filter
- [x] Supabase Storage client (upload Blob, authenticated download, delete) in `net/supabase.js`
- [x] `K.Assets` cache + eviction
- [x] Upload pipeline: PDF (pdf.js) and photos → JPEG pages + thumbs → upload → create document
- [x] Uploads screens: folders grid, folder view, upload progress, document actions (rename, move, add to
      notebook, delete), folder actions (rename, delete)
- [x] Engine: per-page size, background image, `imgs`, Select tool, history ops
- [x] Workspace: import flow, selection bar, back to the right place, document title
- [x] Sync: folders, new columns, purge with Storage cleanup
- [x] Settings: Recently deleted for folders/documents, asset cache size + clear, palm options
- [x] Palm guard (Pencil only, wrist guard)
- [x] Tests (unit + sync with folders/documents), build copies pdf.js, deploy, verify

---

# v1.2 — Writing band (owner request: palm detection "not that good")
- [x] Band of 3–5 ruled lines; only touches starting inside write; outside dimmed and ignored
- [x] ▲/▼ step, drag grip, snap to rows, auto-scroll to keep it in view, per-page position
- [x] Toggle in top bar + Settings (on/off, height)
- [x] Unit tests (geometry, input filtering); browser check at iPad portrait
- [ ] Owner: try it on the iPad 2 and report what feels off

---

# v1.3 — Floating tool palette (owner request: bottom bar takes too much space)
- [x] Replace the bottom tool bar with a draggable round button that opens/closes a panel
- [x] Panel: tools, colours/sizes, zoom, page navigation, add page; opens toward the free side
- [x] Position + open state remembered; survives rotation
- [ ] Owner: try it on the iPad 2

---

# v1.4 — Handwriting to text (owner: Google free service, English, replace with typed text, lasso or whole page)
- [x] Lasso tool + "Convert page handwriting to text"
- [x] Line grouping + Google handwriting-input request (verified live)
- [x] Preview/edit dialog, replace strokes with a typed text object (one undo step)
- [x] Typed text: render under ink, select/move/resize/edit/delete, synced in drawing JSON
- [x] Unit tests; browser test against the real service
- [ ] Owner: try with real handwriting on the iPad 2

---

# V2 — Kagoj becomes a personal Notion (typed first, handwriting optional)

Owner decision (2026-10-04): build everything realistic from `notionfeatures.md` for one user, on PC, phone and
the iPad 2. Collaboration features (sharing, permissions, teamspaces, people, comments, inbox for others,
publish to web) are dropped. Phone reminders come from a private calendar feed (.ics) the phone subscribes to.

## Architecture
- **Docs** (new table `docs`): one row per typed page, database, or database row. `parent_id` builds the
  page tree (no depth limit); `kind` = page | database | row | canvas (a handwritten notebook in the tree);
  `content` = list of blocks (JSON); `props` = database row values; `schema` = database properties + views;
  `settings` = fonts, size, width, lock; `revision` guard like pages. Soft delete → Trash.
- **Blocks**: flat list with indentation depth (`d`), so Tab/Shift+Tab, toggles and nested lists work without a
  tree; columns hold their own block lists. Rich text = sanitised HTML subset (b, i, u, s, code, a, colour
  classes, page and date mentions).
- **Sync**: docs pushed with the revision guard; on conflict a **block-level 3-way merge** (base = last synced
  content): blocks changed on one side win; blocks changed on both keep both versions.
- **Bundles loaded on demand** so the iPad 2 starts fast: core (shell, sidebar, store, sync, router), editor,
  database, calendar, canvas (the existing pen engine), extra (uploads, settings, importer, login, handwriting).
  All listed in the offline cache manifest.
- **Fonts**: system fonts + bundled web fonts (woff, loaded only when used).

## Phases
- [x] **P0 Restructure**: multi-bundle build + loader; pen engine moved to its own bundle; palm options moved
      into the floating tool button
- [ ] **P1 Pages**: `docs` table + sync + merge; sidebar tree (favorites, expand, +, •••, drag to move/nest,
      trash); top bar (breadcrumbs, star, •••); page icon + cover; block editor (text, H1–H3, bullets,
      numbers, to-do, toggle + toggle headings, quote, callout, divider, sub-page, simple table, columns,
      code with highlighting, TOC, breadcrumb, image, file, bookmark, sketch → handwritten page); `/` menu,
      Markdown shortcuts, selection toolbar (B I U S code link colours), Turn into, block menu, drag to
      reorder, Tab indent; `@` page/date mentions, `[[` links, backlinks; fonts per page/block, heading/body
      fonts, size, line spacing, default font; dark mode; search (Ctrl+P); Home (recent, tasks, upcoming)
- [ ] **P2 Databases**: properties (title, text, number, select, multi-select, status, date, checkbox, URL,
      email, phone, created/edited time, unique ID, relation, rollup, formula); views Table / Board / List /
      Gallery / Calendar / Timeline / Chart; filters (AND/OR), sorts, group by, hide properties, column
      calculations; rows open as side peek / full page; inline + full-page databases; row templates
- [ ] **P3 Calendar**: Calendar screen (month / week / day) across all dated items, drag to reschedule,
      ranges, create on tap; reminders (`@remind`, date-property reminders, in-app alerts); private .ics feed
      for the phone's calendar app (native alerts); read-only Google / iCloud / Outlook calendars via their
      private iCal links
- [ ] **P4 Extras**: version history, page templates + template buttons + repeating templates, import
      (Markdown, CSV) / export (Markdown, HTML, CSV, print to PDF), math (KaTeX), Mermaid (rendered on
      PC/phone, saved for the iPad), keyboard shortcuts, small text / full width / lock page
