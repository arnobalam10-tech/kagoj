# Kagoj — Current State

_Last updated: 2026-10-05_

## Status
**V2 complete (2.4.0): P0-P4 done.**

### 2.5.2
- Text highlights (span.bg-*) are marker-strength; block backgrounds stay soft. Coloured callouts get a matching tint and a 4px accent edge (gray = navy edge for statute / case boxes).
- Fixed: diagrams with line breaks in labels never saved their picture (Mermaid emits HTML-style <br>, the XML parser rejected it). cleanSvg now parses with an inert HTML document and keeps only the <svg>.
- Owner content: LAW200 › "Introduction to Contract Law & Offer and Acceptance" (227 blocks) rebuilt by hand from the 17-page PDF: colour code, 14 numbered sections, statute/definition/formula/analogy/memory/case-law callouts, tickable core takeaways, columns, tables, 2 diagrams, cheat sheet, quick revision. Inserted via SQL through a temporary staging table (md5-verified, then dropped); link block added under LAW200 › Notes.

### 2.5.1
- Launch opens Home. reopenLast now defaults to off (Settings: "Open the last page or notebook on launch"); the iOS home-screen app (navigator.standalone) also ignores the address it was left on unless that setting is on.

### 2.5.0 personal setup (owner request)
- Home rebuilt: date + random quirky greeting by time/day; Next up card (earliest timed, not-done item in the next 12 h: "You have INB372 at 11:20 AM next", or "free for the next 12 hours"); after-class attendance card (class days, once the day's last class has started: Present/Absent per class, Save); quick task (title, date, time; goes to the database with schema.tasks, reminder at the time); every section's top pages as cover tiles. Cards live in js/cal/homecards.js (bundle plan).
- Class databases: schema.classes = {course}; props Date (with end + 10-min reminder), Day (formula), Attendance (select Present/Absent), Week, Notes. Attendance summary block (attsum, ref = class db): held / present / absent / % with colour grade (>=80 green, >=60 amber, else red), bar, next class.
- Owner data written directly via SQL (not by logging in): University section with FIN245, INB372, LAW200 pages (Attendance page = summary + inline class db; My marks page = inline marks db: Type, Date, Weight, Marks, Out of, Score formula, Status; rows Quiz 1, Quiz 2, Mid, Assignment, Presentation, Final). Classes every Thu + Sat 2026-09-24 .. 2026-12-31 (FIN245 9:40-11:10, INB372 11:20-12:50, LAW200 16:20-17:50; end times assumed 90 min). Past attendance filled (24/26 Sep absent all; 1 Oct present all; 3 Oct present INB + LAW, absent FIN). Tasks database (schema.tasks) in Personal.
- Date ranges on one day show as "Sep 24, 2026 9:40 AM – 11:10 AM"; class databases are never shown as overdue.
- Fixed: attsum class token with a space.

### 2.4.0 sidebar sections
- The sidebar "Pages" list is replaced by sections like Notion (Personal, University, Life ...). A section is a top-level doc of kind 'section' (migration kagoj_v2_sections widens docs_kind_check); pages live inside it as children, so sync/trash/move work unchanged. Docs.all() and search leave sections out; Docs.sections(), Docs.sectionOf().
- First run makes "Personal" (id derived from the user id, so every device makes the same one) and moves all top-level pages into the first section; this also catches pages made at the top level later.
- Section header: tap to collapse, + adds a page, ••• = add page / database / handwritten page / from template, rename, emoji icon, move up/down, delete (not the last one). "Add a section" under the list. Pages can be dragged onto a section header; Move to lists sections. New pages go to the section of the open page, else the last one used. Breadcrumbs start with the section; tapping it reveals the section in the sidebar.

### 2.3.1 fixes (owner feedback)
- iPad (iOS 9.3.5): editor bundle failed with "Strict mode does not allow function declarations in a lexically nested statement" (a function declared inside an if in blocks.js). Fixed; ESLint no-inner-declarations added and the build now walks every minified bundle and fails on block-level function declarations.
- KaTeX/Mermaid need modern JS: equations and diagrams are rendered on PC/phone and the cleaned result is saved in the block (b.out / b.svg); the iPad shows the saved result.
- Nesting guides: thin lines show which list item / toggle a block sits under (stronger line for toggles); open empty toggles show a tap-to-write hint.
- Columns: faint divider and "Column" placeholders always; dashed outline around each column on hover / while editing; phone shows columns stacked with a left rule.
- Table + buttons and touch-device block handles only show on hover or for the block being edited (.blk.cur class, since iOS 9 has no :focus-within; the old :focus-within selector also broke the hover rule on iOS 9). Waiting on the owner to log in on each device and try it; bugs reported go into the next round.

### V2 P4 — extras (bundle `more`, loaded with pages)
- Version history: page menu › Version history lists doc_versions (needs login + network), preview, restore (undoable).
- Page templates: page menu › Use as a template; sidebar › New page from a template; /Page from template. Template button block (/Template button): copies the blocks indented under it, unchecks to-dos, @dates become today.
- Repeating database templates (js/cal/repeat.js, bundle `plan`): Templates › Manage › Repeat (daily / weekdays / monthly). Rows get ids hashed from template + date so devices never duplicate; runs after each sync and hourly; catches up at most 7 days.
- Import (page menu): Markdown files become sub-pages (headings, lists, to-dos, quotes, code fences, mermaid fences, $ math, tables, inline bold/italic/strike/code/links); CSV becomes a database with guessed column types (number/date/checkbox/select/text).
- Export (page menu): Markdown, HTML, CSV (full-page or inline databases), PDF via print (print CSS hides the app chrome). Old iOS opens the text in a new tab instead of downloading.
- Math block (KaTeX 0.16, vendored at /vendor/katex, works on iOS 9). Diagram block (Mermaid 11, vendored at /vendor/mermaid, strict security); the drawn SVG is cleaned and saved so the iPad shows it without running Mermaid.
- Keyboard shortcuts sheet: Ctrl+/ .


### V2 P3 — calendar, reminders, phone feed
- Calendar screen #/calendar/<month|week|day|agenda>/<date> (bundle `cal`): month grid, week/day hour grid with all-day row and overlap lanes, List (agenda). Tap a day/slot to add (quick-add sheet: title, date, all-day, times, calendar, reminder), drag to another day or time, swipe to change period, current-time line.
- Sources (js/cal/items.js, bundle `plan`, loaded in the background 2.5 s after start together with editor + db): every database with a Date property, @date mentions in pages, subscribed iCal calendars. Show/hide per calendar. New events go into the last-used database, else one named Calendar/Events, else a new "Calendar" database.
- Reminders: date-property reminder offset or @remind mentions; in-app banner (and a system notification when allowed and the tab is hidden) while Kagoj is open; checked every 30 s.
- Phone: private feed link (Edge Function kagoj-ics, verify_jwt off, key = 48-hex user_settings.feed_token; read-only; VALARM alerts; all-day reminders at 9:00). Create/copy/reset in Calendar settings. Verified end to end with temporary data (removed).
- External calendars: Edge Function kagoj-ical (JWT + authenticated) fetches an iCal URL; parser handles folding, escapes, UTC/floating times, all-day, EXDATE, RRULE DAILY/WEEKLY(BYDAY)/MONTHLY/YEARLY with COUNT/UNTIL/INTERVAL. Cached in localStorage, refreshed every 3 h. Subscriptions are stored in user_settings.data.cals (follow the user).
- Home shows Upcoming (next 7 days).


### V2 P2 — databases
- Files: js/db/formula.js (formula language), model.js (K.DB: schema, values, filters, sorts, groups, calculations, dated items), editors.js (value pickers, property settings, filters, sorts, view settings), views.js (K.DbView), peek.js (row properties, side peek, inline block + slash items), css/db.css. Bundle `db` (101 KB of 110), loaded with `editor` for the page screen.
- Property types: title, text, number (plain/commas/%/$/€/£/৳/₹/progress bar/ring), select, multi-select, status (to-do/in progress/complete groups), date (range, time, reminder offset), checkbox, URL, email, phone, relation, rollup (count/sum/avg/min/max/checked/%/earliest/latest), formula, created time, last edited, unique ID (with prefix).
- Views: table (column resize, reorder, hide, calculations footer, grouping, collapsible groups), board (drag cards between groups; long-press on touch), list, gallery (cover = row cover or first image), calendar (month; drag to another day; tap a day to add), timeline (days/weeks/months; drag to move, drag the right edge to resize), chart (bar/donut/line; count or sum).
- Filters (AND/OR, relative dates), multi-sort, search inside a view, per-view settings. New rows inherit filter and group values. Row templates (default template, manage/edit/delete).
- Rows open in a side peek at >=900px wide, otherwise as a full page; row pages show their properties under the title.
- Inline databases and views via / menu (Database inline/full page, Board/Calendar/List/Gallery/Timeline view, Chart, Linked view). Home "New database".
- Tests: 41 unit tests (formula + database model added).
- Schema: kagoj_v2_docs migration now recorded in supabase/schema.sql.


### V2 P1 — what exists
- Sidebar (pinned at >=1000px wide, slide-out below): Search, Home, Calendar, Handwritten notebooks, Uploads, Settings, Favorites, nested Pages tree (expand, +, ••• menu, press-and-hold / mouse drag to move or nest), Trash, sync pill, New page.
- Pages (#/p/<id>): cover (gradients/colours/uploaded image), emoji icon, title, block editor, backlinks, breadcrumbs, last edited, undo/redo (page history), star, ••• page menu (body/heading font, size, line spacing, full width, lock, default style, favorite, duplicate, move, sub-page, delete).
- Blocks: text, H1-3, toggle headings, bullets, numbers (1/a/i by depth), to-dos, toggles, quote, callout (emoji), divider, sub-page, link to page, simple table, 2-4 columns (nested editors), code (20 languages, own highlighter), table of contents, breadcrumb, image (upload, resize, align, caption), file (any type, 50 MB, opens via signed link), web bookmark (kagoj-link Edge Function), sketch (handwritten canvas inside a page, live preview).
- Editing: / menu (spaces allowed), Markdown shortcuts (also when several characters arrive at once), inline **bold** *italic* ~strike~ , @ dates/reminders/pages/new page, [[ links, selection toolbar (B I U S code link, 10 text + 10 highlight colours, clear), block menu (turn into, colour, font, indent/outdent, duplicate, move to page, delete, table/column/image extras), drag handle reorder, Tab indent, Enter/Backspace/Delete/arrow behaviour, paste of multi-line Markdown.
- Fonts: 25 (system + 8 bundled OFL web fonts as woff); per page, per block, heading font, size, line spacing, default for new pages.
- Dark mode (Settings -> Appearance, Ctrl+Shift+L). Search (Ctrl+P), Ctrl+N new page, Ctrl+ sidebar, Ctrl+[ ] back/forward.
- Sync: docs table with revision guard; conflict = block-level 3-way merge (both versions kept only when the same block changed on both). Versions table gets a snapshot at most every 10 minutes per page.
- Bundles: core 81.8 KB, editor 89.9, canvas 76.3, extra 41.7; CSS 18.2 KB.
- Fixed during testing: shell class collided with the modal .overlay style (app went invisible when the sidebar slid out).

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
