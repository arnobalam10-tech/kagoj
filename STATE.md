# Kagoj — Current State

_Last updated: 2026-10-03_

## Status
**v1.1 (Uploads + image placement + palm rejection) is built, tested and pushed; v1 is live at https://kagoj-three.vercel.app.**
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

## Tests (run inside `npm run build`; a failure blocks deploy)
- `scripts/test.js`: 22 unit tests (geometry, codec incl. page size + images, eraser, history incl. image ops, viewport incl. landscape pages, palm rejection input logic)
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
- iOS 9 does not apply photo EXIF rotation when drawing to canvas; a sideways photo taken on an iPhone may upload rotated when uploaded from the iPad 2 (PC/phone uploads are fine).
- pdf.js 3.11 is the last version that runs in older desktop/phone browsers via a plain script tag; the font-eval CVE is mitigated with `isEvalSupported:false`.
