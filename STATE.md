# Kagoj — Current State

_Last updated: 2026-10-03_

## Status
**V2 in progress (local commits, NOT pushed/deployed). Production is still v1.4.** P0 done; P1 (typed pages) code written, builds and passes tests; first browser test found a bug: Markdown block shortcuts (# , - , [] , > ) do not convert while typing (onInput shortcut check in js/editor/editor.js). Next: fix that, finish browser checks of P1 (slash menu, selection toolbar, sidebar drag, mentions, columns, tables), then deploy P1, then P2 databases, P3 calendar, P4 extras (see PLAN.md V2).

### Previous status
**v1.4 (handwriting to text), v1.3 (floating tool palette) and v1.2 (writing band) on top of v1.1 (Uploads + image placement + palm rejection) is built, tested and pushed; v1 is live at https://kagoj-three.vercel.app.**
Not yet verified: a real login and sync against Supabase (needs the owner's password), and anything on the physical iPad 2.

## Infrastructure
| Item | State |
|---|---|
| GitHub | `arnobalam10-tech/kagoj`, branch `main` |
| Vercel | project `kagoj` (team arnobs-projects-51146261), auto-deploys `main`. Production: **https://kagoj-three.vercel.app**. Headers verified: `index.html` no-cache, `/assets/*` immutable. The Vercel connector can read but not create projects (403); the owner imported the repo by hand. |
| Supabase | project `djkvzmeziimnabxcezde`, ap-southeast-1. Migrations: `kagoj_schema_v1`, `kagoj_revoke_anon`, `kagoj_uploads_v1_1`. RLS on every table; anon gets `permission denied`. Private Storage bucket `uploads` (50 MB/file, JPEG/PNG/PDF), per-user folder policies. |
| Account | `arnob@ami.com` (confirmed). Login with `arnob` works (maps to `@ami.com`). |
| TLS | Supabase chain: GTS Root R4 cross-signed by **GlobalSign Root CA** (in iOS 9, should be fine). Vercel chain ends at **GTS Root R1**, which iOS 9 lacks, so the iPad will likely need GTS Root R1 installed as a profile. |

## Done — v1
- Everything in PLAN.md phases 0–5 (drawing engine, notebooks/pages, local-first store, Supabase auth + sync with conflict copies, PC/iPhone support, settings, debug console, icons, spike page)
- Browser-verified at iPad landscape, iPad portrait and phone sizes; production bundle verified

## Done — v1.1
- **Uploads tab** (Notebooks | Uploads switch in the top bar): named folders → documents. Upload button with per-file progress; multiple files at once.
- **PDF upload** on PC/phone: pdf.js 3.11 (legacy build, vendored from npm, loaded only when uploading, `isEvalSupported:false` for CVE-2024-4367) renders each page to a 1400 px JPEG plus a 240 px thumbnail, uploaded to Storage. Originals are not stored (saves the 1 GB free quota).
- **Photo upload** on every device, iPad 2 included (scaled to ≤1400 px).
- **Documents open like notebooks** (write, highlight, erase, undo, zoom, sync) and never appear in the Notebooks tab. Each page keeps its real shape: slides are landscape pages, A4 stays A4.
- **Import into notebooks**: ⋯ → "Import from Uploads…" → folder → document → tick pages (thumbnails, Select all) → **Add as new pages** (after the current page) or **Place on this page**. Also from a document: "Add pages to a notebook…" (existing or new notebook).
- **Select tool**: tap an image, drag to move, drag the corner to resize (keeps aspect), Delete/Done bar; undo/redo for add/move/resize/delete. Images sit under highlighter and ink; the eraser never touches them.
- Document actions: open, add to notebook, rename, move to folder, delete. Folder actions: rename, delete (takes its documents; restorable together).
- **Image cache** on the device (IndexedDB, data URLs because iOS 9 cannot store Blobs), least-recently-used eviction (40 MB on iOS 9, 250 MB elsewhere). Settings shows usage and has a Clear button.
- **Purge**: 30 days after deletion, a document's Storage files are deleted only if no live page elsewhere still uses them (`kagoj_asset_in_use()` SQL function).
- **Palm rejection**: Wrist guard (shaded strip at the bottom, drag its edge to resize; touches starting there are ignored and never count as a second finger). Pencil-only mode (newer iPads: Pencil writes, fingers pan/zoom, palms ignored; offered automatically the first time a Pencil is seen). Settings → Palm rejection.
- **Offline start on iOS 9**: Application Cache manifest (`/kagoj.appcache`), so the home-screen app opens without Wi-Fi. Updates download in the background and apply when leaving the workspace.
- **Two bundles**: startup `app.js` 108.8 KB (budget 120), `extra.js` 30.7 KB loaded right after start (Uploads, picker, importer, Settings, debug, plus their CSS), CSS 15.3 KB (budget 20).
- Fixed along the way: tapping overlays inside the page (selection bar, page messages, wrist-guard handle) no longer reaches the drawing surface; narrow desktop windows use the phone layout; `/spike` script path.

## Done — v1.2 (writing band)
- **Writing band** (palm rejection): a strip 3/4/5 ruled lines tall across the page; only touches that *start* inside it write (strokes may run outside). Everything else is dimmed and ignored, so a resting palm never writes and never turns writing into a pinch. Toggle in the notebook top bar (band icon) and in Settings → Palm rejection, with the height setting.
- Controls above the band (below it near the top of the screen): ▲ / ▼ move it one band height, the grip drags it; it snaps to ruled rows. Moving it past the screen scrolls the page to keep it in view. Position is remembered per page while the notebook is open.
- Band does not filter the Hand and Select tools; pinch-zoom works with fingers inside the band; toolbar zoom always works.
- Verified at iPad portrait size: stroke inside the band with a palm resting below → written; stroke outside → ignored; ▼ moves exactly 4 lines. Unit tests for band geometry and input filtering.
- Bundles: startup 112.6 KB / 120, extra 31.0 KB, CSS 16.0 KB / 20.

## Done — v1.3 (floating tool palette)
- The bottom tool bar is gone; the page uses the full height.
- A small round button floats over the page (shows the current tool + colour). Tap: opens a panel with tools, colours/sizes (eraser sizes + mode), zoom (− % +) and pages (‹ n/N › ＋). Tap again: closes. Open/closed state is remembered.
- Drag the button anywhere (8 px threshold so taps still toggle); position saved as a fraction of the page area so it survives rotation; default bottom-left. The panel opens toward the side with more room and wraps its rows on narrow screens.
- Palette touches never reach the drawing surface. "Hide toolbars" became "Hide top bar"; the restore button sits top-right.
- Verified in the browser: open/close, drag to top-right (panel flips to below-left), tool change, drawing, position and tool persist after reload. Bundles: startup 114.5 KB / 120, CSS 17.2 KB / 20.

## Done — v1.4 (handwriting to text)
- **Lasso tool** (palette, last tool): draw a loop; pen strokes with ≥60% of their points inside are picked (dashed box). Bar: "Convert N strokes to text" / Cancel. ⋯ → "Convert page handwriting to text…" picks every pen stroke on the page.
- Recognition: strokes grouped into lines (overlap clustering; dots/commas join their line), one request per line to Google's handwriting-input service (`inputtools.google.com`, free, unofficial, CORS `*`, certificate chain ends at GlobalSign Root CA so iOS 9 should trust it). English. Needs internet; only stroke coordinates are sent.
- Preview dialog with editable text → **Replace**: the strokes are removed and a typed text box is placed at the same spot (size ≈ ⅔ of the handwriting line height, same ink colour). One undo step restores the handwriting.
- Typed text is a page object (drawing JSON `texts`, synced like everything else), drawn under the ink. Select tool: move, resize (font scales), **Edit text** (multi-line dialog), Delete; all undoable.
- Verified against the real Google service in the browser: synthetic "hello" → "hello"; "hi"×2 → "hihi"; replace, undo/redo, lasso of part of a page, select + edit text, saved to the page.
- Login screen moved into the background bundle to keep startup JS at 119.7 KB / 120 (**the startup budget is now full**; further features should go in the extra bundle). Extra bundle 36.6 KB / 60, CSS 17.4 KB / 20.

## Tests (run inside `npm run build`; a failure blocks deploy)
- `scripts/test.js`: 29 unit tests (incl. writing band, handwriting line grouping, request/response format, typed-text codec, convert undo) (geometry, codec incl. page size + images, eraser, history incl. image ops, viewport incl. landscape pages, palm rejection input logic)
- `scripts/sync-test.js`: 18 integration tests, two simulated devices against a mock Supabase (REST, RPC, Storage): push/pull, lazy download, revision guard, conflict copy, folders + documents, document writing sync, import into notebook, folder delete/restore, purge keeps shared files, soft delete, offline retry, 401 refresh, masked logs
- Browser (dev build + in-page Storage stand-in): 3-page PDF upload (portrait/landscape/portrait), photo upload, document opens with background, writing on it saves, slide page is landscape, import picker, place image, move, resize, undo, delete, add as new pages, wrist guard with synthetic multi-touch

## Next
1. Owner: log in on the PC at https://kagoj-three.vercel.app, upload a real PDF, open it on the phone → confirms Storage + sync for real
2. Owner: iPad 2 checks (see actions below)

## Decisions log
- Supabase project: reuse "arnobalam10-tech's Project" (owner's choice). It also holds an unrelated, empty exam-app schema with 3 old auth users; RLS keeps Kagoj rows private per user.
- Login accepts a plain username: `arnob` → `arnob@ami.com` (`config.usernameDomain`).
- Writing: right-handed, both orientations, mostly portrait → default zoom "Auto" (fit page in portrait, fit width in landscape), changeable in Settings. Phones default to fit width.
- iPhone: mostly reading → opens in View mode, with a pencil toggle.
- Schema additions: `pages.label` (conflict copy names), v1.1: `folders` table, `notebooks.kind/folder_id/source_name`, Storage bucket `uploads`, `kagoj_asset_in_use()`.
- Uploaded material = notebooks with `kind='document'`, so every notebook feature works on them unchanged.
- Free Supabase plan (1 GB storage, 50 MB/file). Slides are exported to PDF by the owner. Only page images are stored, not originals.
- Placed images sit under highlighter and ink (like paper); no rotation.
- PDF rendering happens on the uploading PC/phone; the iPad 2 never runs pdf.js.
- ESLint 9 flat config replaces `.eslintrc.json` + `eslint-plugin-es5`.
- Local page `revision` is a local edit counter; `baseRevision` is the server revision. PATCH guard uses `baseRevision`.
- Page drawings and images download lazily on a new device (on open, plus background prefetch).
- Application Cache added for offline start on iOS 9 (it is the only offline mechanism Safari 9 has; modern browsers ignore it).

## Owner actions pending
1. **Supabase → Authentication → Sign In / Providers → turn OFF "Allow new users to sign up"** (still ON as of the last check).
2. Optional: Authentication → Sessions → longer refresh-token / inactivity limits so the iPad stays logged in for months.
3. **iPad 2:** open https://kagoj-three.vercel.app/spike/ in Safari. If it says "Cannot Verify Server Identity", install the **GTS Root R1** certificate (from pki.goog) as a profile: Settings → General → Profiles. Then run both test buttons, Add to Home Screen, log in inside the home-screen app.

## Known issues / limits
- Handwriting recognition uses an unofficial Google endpoint: free and accurate for English, but it could change or stop without notice. If it breaks, the fallback plan is Claude via a Supabase Edge Function (needs an API key).
- iOS 9 does not apply photo EXIF rotation when drawing to canvas; a sideways photo taken on an iPhone may upload rotated when uploaded from the iPad 2 (PC/phone uploads are fine).
- pdf.js 3.11 is the last version that runs in older desktop/phone browsers via a plain script tag; the font-eval CVE is mitigated with `isEvalSupported:false`.
