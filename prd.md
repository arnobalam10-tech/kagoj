# Kagoj — Product Requirements Document

**Kagoj** (কাগজ, "paper") is a personal, browser-based handwriting notebook for an old iPad, with notes synced to the cloud and readable from a PC and an iPhone.

| | |
|---|---|
| Version | 1.1 (detailed spec) |
| Owner / only user | Me |
| Primary device | iPad 2 (model MC770LL/A, Wi-Fi, 2011), iOS 9.3.5, Safari 9 |
| Secondary devices | Windows/Mac PC browser, iPhone Safari |
| Backend | Supabase (Postgres + Auth), called directly over REST |
| Hosting | Vercel (static files only) |
| Status | Ready for Phase 0 (device spike) |

---

## 0. Decisions already made

These are settled and should not be re-debated during development.

1. **Single user.** One account, created manually in the Supabase dashboard. No sign-up screen, no forgot-password flow, public sign-ups disabled.
2. **Local-first.** Every stroke is saved on the device first. The cloud is a sync target and backup, never a requirement for writing.
3. **No backend server of my own.** The frontend talks to Supabase's REST endpoints (`/auth/v1` and `/rest/v1`) with plain `XMLHttpRequest`. The official `supabase-js` client is not used anywhere, because it will not run on Safari 9.
4. **Hand-written ES5.** No transpiler, no framework, no npm runtime dependencies in the frontend. A tiny Node script concatenates files for deployment.
5. **Same web app everywhere.** The iPad, PC, and iPhone all load the same URL. Modern browsers get small enhancements (mouse support, Pointer Events) through feature detection.
6. **Strokes are data, not pixels.** Pages are stored as lists of vector strokes so erasing, undo, zoom, sync, and later PDF export all work from one source of truth.
7. **v2 features are out of scope** (handwriting smoothing/correction, PDF import/export, palm rejection), but the data model must not block them. See section 22.

---

## 1. Goals and non-goals

### 1.1 Goals

- Write with my finger on the iPad 2 and have it feel responsive, like a real notebook rather than a website.
- Organise notes into multiple notebooks, each with multiple pages and paper styles.
- Never lose a stroke, even with Wi-Fi drops, Safari being killed, or the iPad running out of battery.
- Open the same notebooks on my PC and iPhone to read them, and write on them when convenient.
- Run as a home-screen app on the iPad with no Safari address bar.

### 1.2 Non-goals for v1

- Multiple users, sharing, or collaboration.
- Apple Pencil, pressure sensitivity (the iPad 2 has neither).
- Text typing, images, shapes, audio, OCR, AI features.
- App Store distribution or a native wrapper.
- Pixel-perfect design. Function and speed come first.

---

## 2. Target device profile

Knowing the hardware explains most of the technical decisions in this document.

| Spec | iPad 2 (MC770LL/A) | What it means for Kagoj |
|---|---|---|
| CPU | Apple A5, dual-core 1 GHz | Rendering must be incremental. Never redraw the whole page per touch event. |
| RAM | 512 MB (shared with OS and Safari) | Keep only the open page's strokes in memory. Small canvases. |
| Screen | 1024 × 768, 132 ppi, `devicePixelRatio = 1` | Good news: canvases are small and cheap. No retina scaling needed. |
| OS / browser | iOS 9.3.5, Safari 9 (WebKit ~601) | ES5 only, `XMLHttpRequest` only, older flexbox, no Service Workers. |
| Input | Capacitive touch, finger only | Wide strokes, no pressure. Basic two-finger gestures. |
| Network | Wi-Fi only | Offline is normal, not an edge case. |

**Safari canvas memory limit:** iOS caps total canvas memory and the size of a single canvas (roughly 5 megapixels per canvas on 512 MB devices; verify in Phase 0). Kagoj must never create a canvas the size of a zoomed-in page. Canvases are always the size of the visible viewport (1024 × ~700), and zoom is applied as a transform when drawing.

---

## 3. Legacy browser rules (the coding contract)

Anyone, human or AI agent, writing frontend code for Kagoj must follow these rules. When in doubt, do not use the feature.

### 3.1 JavaScript

**Allowed:** `var`, `function`, prototypes, IIFE modules, `XMLHttpRequest`, `JSON`, `requestAnimationFrame`, `localStorage`, `indexedDB` (behind feature detection), `Array.prototype.forEach/map/filter/reduce/indexOf`, `Object.keys`, `Date.now`, `addEventListener`, `classList`, `querySelector`.

**Forbidden in frontend code:**

- `let`, `const`, arrow functions, classes, template literals, destructuring, spread/rest, default parameters, `for...of`, `async`/`await`, generators, ES modules (`import`/`export`).
- `fetch`, `Promise`-based code paths (use callbacks; `Promise` exists in Safari 9 but keeping one async style avoids subtle bugs), `Map`/`Set`/`WeakMap`, `Array.from`, `Array.prototype.includes/find`, `Object.assign`, `Object.entries/values`, `String.prototype.padStart`, `Symbol`.
- Service Workers, Web Workers with modules, WebAssembly, `CompressionStream`, `ResizeObserver`, `IntersectionObserver`, Fullscreen API.

**Enforcement:** ESLint with `"parserOptions": { "ecmaVersion": 5 }` and `eslint-plugin-es5`, run before every deploy. A build that fails lint is not deployed.

**Module pattern:** every file is an IIFE that attaches to a single global namespace:

```js
(function (K) {
  'use strict';
  function Engine(opts) { /* ... */ }
  Engine.prototype.start = function () { /* ... */ };
  K.Engine = Engine;
})(window.Kagoj = window.Kagoj || {});
```

### 3.2 CSS

**Allowed:** flexbox (with `-webkit-` prefixes alongside unprefixed), `-webkit-transform`, `transition` on `opacity`/`transform` only, `box-sizing`, `rgba()`, `border-radius`, media queries for orientation.

**Forbidden or must have fallbacks:** CSS Grid, CSS custom properties (`var(--x)`), `gap` on flex containers (not supported in Safari 9, use margins), `position: sticky` without `-webkit-`, `100vh` (buggy on iOS 9; size the app shell from `window.innerHeight` in JS instead), `backdrop-filter`, `:focus-visible`, `aspect-ratio`.

### 3.3 HTML head (required)

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Kagoj">
<link rel="apple-touch-icon" href="/icons/icon-152.png">
<link rel="apple-touch-startup-image" href="/icons/launch-1024x748.png">
```

iOS 9 respects `user-scalable=no`, which stops Safari's own pinch-zoom and double-tap-zoom from fighting the canvas. (iOS 10+ ignores it; on modern devices, use `touch-action: none` on the canvas as well.)

---

## 4. Architecture

```
┌────────────────────────── Browser (iPad / PC / iPhone) ──────────────────────────┐
│                                                                                  │
│  UI (router, login, dashboard, workspace, toolbar)                               │
│        │                                                                         │
│  Drawing engine (input → live render → commit → history)                         │
│        │                                                                         │
│  Local store (IndexedDB, localStorage fallback)  ◄──── source of truth on device │
│        │                                                                         │
│  Sync manager (queue, retry, conflict handling)                                  │
│        │                                                                         │
│  Net layer (XHR wrapper, Supabase auth + REST client, token refresh)             │
└────────┼─────────────────────────────────────────────────────────────────────────┘
         │ HTTPS (JSON)
┌────────▼─────────────── Supabase ───────────────┐      ┌──── Vercel ────┐
│  Auth (GoTrue)   /auth/v1/token                 │      │ static files:   │
│  PostgREST       /rest/v1/notebooks, /pages     │      │ index.html,     │
│  Postgres + Row Level Security                  │      │ app.js, app.css │
└─────────────────────────────────────────────────┘      └────────────────┘
```

### 4.1 Why talk to Supabase directly

Supabase exposes plain HTTP endpoints. With Row Level Security (RLS), the public "anon" key can safely be in frontend code: the database only returns rows whose `user_id` matches the logged-in user's token. That removes the need for any custom API server. The anon key is a publishable key, not a secret. The `service_role` key must never appear in the frontend or the repo.

---

## 5. Hosting and HTTPS (critical risk, test first)

iOS 9's built-in list of trusted root certificates dates from 2016. Many sites today use certificates that chain to roots iOS 9 does not trust:

- **Let's Encrypt** certificates (used by Vercel by default) now chain only to *ISRG Root X1*. The older cross-signed chain that iOS 9 trusted expired in 2021. Result: Safari on the iPad may show "Cannot Verify Server Identity" for the Vercel site, and XHR calls may fail silently.
- **Supabase** (served via Cloudflare) may use Let's Encrypt or Google Trust Services certificates. Its chain must be tested too.

### 5.1 Plan

1. In Phase 0, open both the Vercel URL and `https://<project>.supabase.co/rest/v1/` on the iPad and note which fail.
2. **Fix for a personal device:** install the missing root certificate(s) (*ISRG Root X1*, and *GTS Root R1* if Supabase needs it) on the iPad as a configuration profile. Download the `.der`/`.pem` file on the PC, email it to yourself or serve it from any plain-HTTP location, open it on the iPad, and install the profile. On iOS versions before 10.3, a root installed through a profile is trusted for HTTPS straight away. Verify this in Phase 0.
3. Fallback if certificates cannot be fixed: put the app behind a host or proxy whose certificate chain iOS 9 trusts (for example, a custom domain on a CDN that lets you choose the certificate authority).

iOS 9 supports TLS 1.2 with modern ECDHE/AES-GCM ciphers, so the connection protocol itself is not expected to be a problem; only the certificate chain is.

### 5.2 Vercel setup

- Static project, no framework preset, output directory `dist/`.
- `index.html` served with `Cache-Control: no-cache`. `app.js` and `app.css` get a content hash in the file name and long cache lifetimes.
- No server functions needed for v1.

---

## 6. Authentication (single user)

### 6.1 Supabase setup (one time, in the dashboard)

- Create the project. Disable "Allow new users to sign up".
- Create my user manually (email + password). Confirm the email from the dashboard.
- Optional: extend the refresh token lifetime so the iPad stays logged in for months.

### 6.2 Login screen

- Kagoj logo, email field, password field, "Log in" button. Nothing else.
- Inputs: `autocapitalize="off"`, `autocorrect="off"`, `type="email"`, large text (18px+) so iOS does not zoom.
- Errors shown inline in plain language: "Wrong email or password", "No internet connection", "Can't reach server (certificate or network problem)".
- No forgot-password flow. If I forget the password, I reset it from the Supabase dashboard on the PC.

### 6.3 Session handling

- Login: `POST /auth/v1/token?grant_type=password` with the `apikey` header. Returns `access_token` (about 1 hour) and `refresh_token`.
- Store both tokens and `expires_at` in `localStorage` (key `kagoj.session`). This is a personal device, and this is what "stay logged in" requires.
- Before each API call, if the access token expires within 60 seconds, refresh first with `POST /auth/v1/token?grant_type=refresh_token`. Queue concurrent calls behind a single refresh so two refreshes never race.
- If refresh fails with 400/401: keep all local data, mark sync as "Logged out", and show the login screen when online. Local notebooks remain readable and writable offline.
- Logout (in settings): `POST /auth/v1/logout`, clear tokens. Local data stays unless I tap "Also clear this device".
- Tokens are never placed in URLs, never logged to the debug console (mask them), and only sent over HTTPS.

**Note:** a home-screen web app on iOS has storage separate from Safari. Log in once inside the home-screen app itself; a login done in the Safari tab does not carry over.

---

## 7. App structure and navigation

Single page app with hash routing (no page reloads, no links that would open Safari when running from the home screen).

| Route | Screen |
|---|---|
| `#/login` | Login |
| `#/` | Dashboard (notebook list) |
| `#/nb/<notebookId>/<pageIndex>` | Notebook workspace on a given page |
| `#/settings` | Settings |

- On launch: load session and local data first, show the dashboard immediately from local data, then sync in the background.
- The app remembers the last open notebook and page and reopens it on launch (setting, default on). Notebook apps usually do this, and it hides any slowness of the dashboard.

---

## 8. Dashboard

### 8.1 Layout (landscape, 1024 × 768)

- **Top bar (56px):** "Kagoj" wordmark on the left, sync status pill, settings button on the right.
- **Search field** under the top bar: filters notebooks by title as you type (client-side, no server call).
- **"Recent" row:** the 3–4 most recently opened notebooks.
- **"All notebooks" grid:** cards in rows of 4 (landscape) or 3 (portrait). The first card is always "+ New notebook".

### 8.2 Notebook card

- Cover: a solid colour block in portrait 3:4 ratio, with the title written on it. (Page thumbnails are a later enhancement; cover colours keep the dashboard fast.)
- Below: title, page count, "Edited 2 days ago" relative date.
- Tap opens the notebook. Long-press (600ms) or a "⋯" button opens the action sheet: Rename, Change colour, Duplicate, Delete.

### 8.3 Create notebook

Modal sheet with:

- Title (default "Untitled notebook"; keyboard opens automatically).
- Cover colour: 8 swatches (charcoal, navy, forest green, maroon, mustard, teal, purple, sand).
- Default paper: Blank, Ruled, Grid, Dotted, shown as small preview tiles.
- "Create" opens the new notebook straight to page 1.

### 8.4 Delete

- Confirmation dialog naming the notebook.
- Soft delete: set `deleted_at`. Deleted notebooks appear under Settings → "Recently deleted" for 30 days with a Restore button, then are purged. Soft delete is also what lets deletes sync correctly across devices.

---

## 9. Notebook workspace

### 9.1 Layout (landscape)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ Back   Notebook title           ↶  ↷        Saved ✓        ⋯          │  top bar 52px
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                         page canvas (paper)                              │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ ✎ Pen  ▌Highlighter  ⌫ Eraser │ ● ● ● ● │ ─ ═ ▬ │ − 100% + │ ‹ 3/12 › ＋│  tool bar 60px
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** Back to dashboard, notebook title (tap to rename), Undo, Redo, sync status, "⋯" menu (page paper style, delete page, clear page, view mode).
- **Tool bar (bottom):** tool buttons, colour swatches for the current tool, thickness picker, zoom controls, page navigation, add page.
- Only the 4 colours for the current tool are shown; switching tool switches the swatches.
- **Hide toolbars** option in the "⋯" menu: toolbars collapse to a small floating button in a corner for maximum writing space.
- All touch targets are at least 44 × 44 px with 8px spacing. No hover-only interactions.
- Portrait: same layout; the tool bar wraps colours and thickness into a popover if needed.

### 9.2 Tool behaviour summary

| Tool | Colours | Sizes (page units) | Notes |
|---|---|---|---|
| Pen | Black `#1F1F1F`, Blue `#1E4FD8`, Red `#D0312D`, Green `#1E8A44` | Thin 2, Medium 3.5, Thick 6 | Default tool on open |
| Highlighter | Yellow `#FFE34D`, Green `#8CE68C`, Pink `#FF8FC7`, Blue `#7FC8FF` | Thin 12, Medium 20, Thick 30 | Drawn under ink, translucent |
| Eraser | — | Small 8, Medium 18, Large 36 (radius) | Mode: partial (default) or whole-stroke |

Each tool remembers its own last colour and size (saved in `localStorage`).

Custom colour picker: deferred. Not needed for v1.

### 9.3 Home-screen / fullscreen

- Running from the home screen gives a fullscreen standalone window with no Safari chrome.
- In a normal Safari tab, show a one-time dismissible tip: "Tap Share → Add to Home Screen for fullscreen."
- Body uses `position: fixed; overflow: hidden` in the workspace, and all `touchmove` events on the document are `preventDefault()`-ed so the page never rubber-bands or scrolls.

---

## 10. Drawing engine (the core)

### 10.1 Coordinate system

- Each page has a fixed **logical size of 1000 × 1414 units** (A4 ratio, which keeps v2 PDF export simple).
- All stroke points are stored in page units, independent of screen size, zoom, or device. The same page looks identical on the iPad, PC, and iPhone.
- The view has a transform: `scale` and `offsetX/offsetY`. Screen ↔ page conversion:

```
pageX = (screenX - canvasLeft - offsetX) / scale
screenX = pageX * scale + offsetX + canvasLeft
```

### 10.2 Canvas layers

Four stacked `<canvas>` elements, each exactly the size of the visible workspace area (never larger):

| Layer (bottom → top) | Contents | Redrawn when |
|---|---|---|
| 1. Paper | Page background colour, edge shadow, ruled/grid/dot pattern | Zoom/pan ends, paper style changes |
| 2. Highlight | Committed highlighter strokes, drawn at full opacity; the canvas element has CSS `opacity: 0.4` | Highlight stroke added/erased, zoom/pan ends |
| 3. Ink | Committed pen strokes | Pen stroke added (incrementally) or erased (dirty rect), zoom/pan ends |
| 4. Live | The stroke currently being drawn, eraser cursor | Every animation frame during a gesture |

Drawing highlights on their own layer with CSS opacity means overlapping highlighter strokes do not get darker, and highlights always sit underneath ink, like a real highlighter that does not smudge pen.

### 10.3 Input pipeline

**Touch events (iPad, iPhone):** `touchstart`, `touchmove`, `touchend`, `touchcancel` on the live canvas, all with `preventDefault()`.

1. **touchstart with 1 finger:** begin a *pending* stroke. Record the first point and the touch identifier. Do not draw yet.
2. **Second finger within 100ms:** cancel the pending stroke (it was the start of a pinch/pan) and switch to gesture mode.
3. **After 100ms with one finger, or once the finger moves more than 3px:** the stroke becomes *active*; render what was buffered.
4. **touchmove:** convert each `changedTouches` point for the tracked identifier to page units. Discard a point if it is less than `0.8 / scale` page units from the previous one (removes jitter, reduces data). Push to the stroke's point buffer and mark "needs frame".
5. **requestAnimationFrame loop:** only runs while a gesture is active. Draws only the *new* segments since the last frame onto the live layer.
6. **touchend / touchcancel:** commit the stroke (10.5).

A stroke that never became active (tap under 100ms with no movement) is committed as a dot so tapping a full stop works.

**Mouse and Pointer Events (PC, modern browsers):** if `window.PointerEvent` exists, use `pointerdown/move/up` instead, with `setPointerCapture`. Left button draws. Ignore Pointer Events entirely on iOS 9 (it does not have them).

### 10.4 Live rendering and basic smoothing

- Line style: `lineCap = 'round'`, `lineJoin = 'round'`.
- Draw with quadratic curves through midpoints: for points p0, p1, p2, draw from mid(p0,p1) to mid(p1,p2) with p1 as control point. This turns jagged finger input into smooth curves at almost no CPU cost.
- Pen: append new segments to the live canvas each frame (no clearing).
- Highlighter: each frame, clear the live canvas and re-stroke the whole highlighter path at 40% alpha, so the preview matches the final look without overlap darkening. Highlighter strokes are short, so this stays cheap.

This basic midpoint smoothing is part of v1. Advanced beautification is v2 (section 22).

### 10.5 Committing a stroke

On finger lift:

1. Simplify points with Ramer–Douglas–Peucker (tolerance 0.35 page units). Typically cuts point count by 40–60% with no visible change.
2. Resample so no two consecutive points are more than 4 units apart (inserts interpolated points where needed). This makes partial erasing clean.
3. Compute and cache the bounding box (`minX, minY, maxX, maxY`, padded by width/2).
4. Assign an id (`s_` + 8 random base-36 characters).
5. Draw the final stroke onto the Ink or Highlight layer. Clear the Live layer.
6. Push an `add` operation onto the undo stack; clear the redo stack.
7. Mark the page dirty and schedule a local save (section 13).

Target: commit takes under 16ms on the iPad 2.

### 10.6 Eraser

- **Cursor:** a thin grey circle showing the eraser radius follows the finger on the Live layer.
- **Hit testing:** for each eraser position, first check stroke bounding boxes (cheap), then for candidates check distance from the eraser centre to each segment: hit if distance < `eraserRadius + strokeWidth / 2`.
- **Partial mode (default):** remove the points inside the eraser circle and split the stroke into separate fragments at the gaps. Fragments with fewer than 2 points are dropped. Each fragment gets a new id.
- **Whole-stroke mode:** any stroke touched is removed completely.
- Erases both pen and highlighter strokes.
- **Rendering during erasing:** compute the union of affected bounding boxes (dirty rect), clip to it, clear it, and redraw only the strokes that intersect it. Do not redraw the whole page per move event.
- One full eraser gesture (finger down → up) is a single undo step.

### 10.7 Undo and redo

Operation-based history, per page, held in memory:

| Operation | Stored data | Undo does |
|---|---|---|
| `add` | the new stroke | remove it |
| `erase` | strokes removed + fragments added | remove fragments, restore originals |
| `clear` | all strokes on the page | restore them |

- Stack depth: 100 operations per page.
- History survives switching pages within the open notebook, and is discarded when the notebook is closed.
- Undo/redo trigger a dirty-rect redraw of the affected area, mark the page dirty, and save.
- On PC: `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`.

### 10.8 Rendering committed strokes from data

`renderStrokes(ctx, strokes, transform, clipRect)`:

- Skip strokes whose bounding box does not intersect the visible area or clip rect.
- Batch strokes by colour + width: one `beginPath()`, many subpaths, one `stroke()` call per batch. This is the biggest single speed-up on old devices.
- Use the same midpoint-quadratic curve method as live rendering so committed strokes look identical to what was drawn.

---

## 11. Zoom and pan

- **Zoom range:** 0.5× of fit-width ("whole page") up to 4×.
- **Default view on open:** fit page width (setting can change to fit whole page).
- **Gestures:** two-finger pinch zooms around the midpoint of the fingers; two-finger drag pans. One finger always writes.
- **Fast pinch:** during the gesture, do not re-render. Apply a CSS `-webkit-transform: translate3d(...) scale(...)` to the layer container (GPU-accelerated and smooth). On gesture end, compute the new transform, reset the CSS transform, and re-render all layers once at the new scale. A brief blur during the pinch is acceptable.
- **Toolbar controls:** `−`, current percentage (tap to reset to fit width), `+`. Steps: 50%, 75%, 100%, 150%, 200%, 300%, 400%.
- **Pan limits:** the page can't be dragged further than 100px past its edge.
- **Optional hand tool** in the tool bar: when selected, one-finger drag pans instead of drawing. Useful for scrolling down a page in landscape.
- Zoom never changes stored stroke data, only the view transform. Stroke widths scale with zoom (a thin line looks thicker when zoomed in, like real paper).

---

## 12. Pages and paper

### 12.1 Page operations

- **Add page:** "＋" in the tool bar adds a page *after the current one*, using the notebook's default paper style, and navigates to it.
- **Navigate:** "‹" and "›" buttons, plus the "3 / 12" label opens a simple page list (numbered rows, tap to jump). Swiping is not used for page turns because it conflicts with writing.
- **Delete page:** from the "⋯" menu, with confirmation. Soft delete, restorable from "Recently deleted".
- **Clear page:** from the "⋯" menu, with confirmation; undoable.
- **Paper style per page:** "⋯" → Paper style → Blank / Ruled / Grid / Dotted. Changing it affects only the current page.

### 12.2 Paper styles (in page units, drawn on the Paper layer)

| Style | Specification |
|---|---|
| Blank | Warm white `#FDFCF8` |
| Ruled | Lines every 36 units, colour `#C9D6E8`, first line at 110 units, red margin line at x = 90 (`#E8B4B4`) |
| Grid | Squares of 36 units, colour `#DCE3EC` |
| Dotted | Dots every 36 units, radius 1.6, colour `#B8C2CE` |

Line widths stay 1 screen pixel regardless of zoom so paper never looks heavy.

### 12.3 Loading pages

- Only the current page's strokes are loaded into memory.
- When the current page opens, the next page's data is pre-loaded in the background from local storage so "›" feels instant.
- Page order uses a `position` number with gaps (1000, 2000, 3000...) so inserting a page between two others only changes one row. Reordering pages later (v1.x) uses the same field.

---

## 13. Data model

### 13.1 Stroke format (version 1)

Stored as JSON. Coordinates are page units multiplied by 10 and rounded to integers, then delta-encoded (each point after the first is stored as the difference from the previous one). This roughly halves the size compared with plain floats.

```json
{
  "v": 1,
  "w": 1000,
  "h": 1414,
  "strokes": [
    {
      "id": "s_k3j9x0aa",
      "t": "p",
      "c": "#1F1F1F",
      "w": 3.5,
      "pts": [1000, 1200, 50, 48, 47, 52, 51, 49]
    },
    {
      "id": "s_p1m7q2bc",
      "t": "h",
      "c": "#FFE34D",
      "w": 20,
      "pts": [900, 3000, 120, 0, 118, 2]
    }
  ]
}
```

- `t`: `"p"` pen, `"h"` highlighter.
- `pts`: `[x0, y0, dx1, dy1, dx2, dy2, ...]` in tenths of a unit.
- Bounding boxes are computed on load and not stored.
- `v` lets future versions (v2 pressure, smoothing metadata) be read alongside old pages.

Size estimate: a full handwritten page is about 300 strokes × ~40 points → roughly 60–100 KB of JSON. Thousands of pages fit comfortably within Supabase's free database size.

### 13.2 Supabase schema

```sql
-- notebooks
create table public.notebooks (
  id uuid primary key,                      -- generated on the client
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null default 'Untitled notebook',
  cover_color text not null default '#2F3640',
  default_paper text not null default 'ruled'
    check (default_paper in ('blank','ruled','grid','dotted')),
  page_count int not null default 0,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- pages
create table public.pages (
  id uuid primary key,                      -- generated on the client
  user_id uuid not null default auth.uid() references auth.users(id),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  position int not null,                    -- gapped ordering: 1000, 2000, ...
  paper text not null default 'ruled'
    check (paper in ('blank','ruled','grid','dotted')),
  drawing jsonb not null default '{"v":1,"w":1000,"h":1414,"strokes":[]}',
  revision int not null default 1,          -- incremented on every saved change
  background_asset text,                    -- reserved for v2 PDF import
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index pages_notebook_idx on public.pages (notebook_id, position);
create index notebooks_updated_idx on public.notebooks (user_id, updated_at);
create index pages_updated_idx on public.pages (user_id, updated_at);

-- keep updated_at honest
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create trigger notebooks_touch before update on public.notebooks
  for each row execute function public.touch_updated_at();
create trigger pages_touch before update on public.pages
  for each row execute function public.touch_updated_at();

-- Row Level Security: only my rows, ever
alter table public.notebooks enable row level security;
alter table public.pages enable row level security;

create policy "own notebooks" on public.notebooks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own pages" on public.pages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Optional table for remote debugging (section 17.2):

```sql
create table public.client_logs (
  id bigserial primary key,
  user_id uuid default auth.uid(),
  device text, level text, message text, created_at timestamptz default now()
);
alter table public.client_logs enable row level security;
create policy "own logs" on public.client_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 13.3 Local storage (on each device)

IndexedDB database `kagoj`, version 1, with object stores:

| Store | Key | Contents |
|---|---|---|
| `notebooks` | `id` | Notebook metadata (same fields as the table) + `dirty` flag |
| `pages` | `id` | Page metadata without drawing + `dirty` flag + `revision` + `baseRevision` |
| `drawings` | page `id` | The drawing JSON (kept separate so listing pages never loads stroke data) |
| `meta` | key | `lastSyncAt`, last open notebook/page, tool preferences |

- **Feature detection:** on startup, open IndexedDB and run a write → read → delete test transaction. If it fails (IndexedDB on older iOS versions has known bugs, and support in home-screen mode must be verified in Phase 0), fall back to the `localStorage` adapter.
- **localStorage fallback:** same API via an adapter. Shows a persistent warning in Settings: "Using limited storage (about 5 MB). Cloud sync is your backup." When usage passes 80%, older synced pages' drawings are evicted locally and re-downloaded from the cloud when opened.
- All storage access goes through one `K.Store` interface so the rest of the app does not care which backend is in use.

### 13.4 IDs

UUID v4 generated on the client, using `crypto.getRandomValues` when available and `Math.random` otherwise. Client-generated IDs let notebooks and pages be created offline and synced later without renumbering.

---

## 14. Saving and synchronisation

### 14.1 Local save

- After any change (stroke commit, erase, undo, rename...), write to IndexedDB with a 400ms debounce, and immediately when the app is hidden (`pagehide` / `visibilitychange`) or the notebook is closed.
- Each local save of a page increments its local `revision` and sets `dirty = true`.
- The sync pill shows **"Saving…"** during the write and **"Saved"** after.

### 14.2 Cloud sync

The sync manager runs:

- 3 seconds after the last local save,
- on app launch and when returning to the foreground,
- every 60 seconds while the app is open,
- when connectivity seems to return (`online` event, or the next successful request).

**Push (local → cloud):**

1. For each dirty notebook: upsert via `POST /rest/v1/notebooks` with `Prefer: resolution=merge-duplicates`.
2. For each dirty page: 
   - New page (never synced): `POST /rest/v1/pages`.
   - Existing page: `PATCH /rest/v1/pages?id=eq.<id>&revision=eq.<baseRevision>` with `Prefer: return=representation`, sending the new drawing and `revision = baseRevision + 1`.
   - If the PATCH returns a row: success. Set `baseRevision`, clear `dirty`.
   - If it returns zero rows: the page changed on another device. Go to conflict handling (14.3).
3. Pages are pushed one at a time, smallest first, so a slow connection still makes progress.

**Pull (cloud → local):**

- `GET /rest/v1/notebooks?updated_at=gt.<lastSyncAt>` and the same for pages, selecting metadata columns only (`select=id,notebook_id,position,paper,revision,updated_at,deleted_at`).
- For changed pages that are *not* dirty locally: download the drawing (`select=drawing`) and replace the local copy.
- Rows with `deleted_at` set are hidden locally.
- `lastSyncAt` is taken from the server timestamps returned, never from the device clock (the iPad's clock can be wrong).

### 14.3 Conflicts (rare, but never lose data)

When a page was edited on two devices before syncing:

- The cloud version stays as the main page.
- The local version is saved as a **new page directly after it**, titled in the page list as "Page N — conflict copy (iPad, 3 Oct 14:20)".
- A notice appears: "A page was edited on two devices. Both versions were kept."

No automatic merging of strokes in v1. With a single user, conflicts should almost never happen.

### 14.4 Status indicator

| State | Shown as |
|---|---|
| Writing to device | "Saving…" |
| On device, synced | "Saved ✓" |
| On device, waiting to sync | "Saved on iPad · syncing…" |
| No connection | "Offline · saved on iPad" |
| Sync error | "Sync failed · tap to retry" (tap shows the error text) |
| Session expired | "Logged out · tap to log in" |

### 14.5 Retry policy

- Failed requests retry with backoff: 5s, 15s, 30s, 60s, then every 2 minutes.
- Timeouts: 15s for metadata, 45s for page drawings.
- 401 → refresh token once, then retry. 4xx other than 401/409 → mark that item failed, log it, continue with others. 5xx/network errors → retry later.

### 14.6 Supabase free tier note

Free Supabase projects are paused after a period of inactivity (about a week). If that happens, sync shows "Sync failed", writing continues locally, and the project can be resumed from the dashboard. Nothing is lost because the device holds everything.

---

## 15. Using Kagoj on PC and iPhone

Same URL, same login, same data.

### 15.1 PC (Chrome/Edge/Firefox/Safari)

- Full workspace. Mouse draws with left button.
- Zoom: `Ctrl + scroll` or toolbar. Pan: scroll wheel, or hold `Space` and drag.
- Keyboard: `P` pen, `H` highlighter, `E` eraser, `Ctrl+Z` / `Ctrl+Shift+Z`, `←` / `→` pages.
- Page displayed centred with grey surroundings; the canvas uses `devicePixelRatio` scaling on high-DPI screens so strokes are crisp.

### 15.2 iPhone

- Opens in **View mode** by default: one finger pans, pinch zooms, no accidental strokes. A pencil button in the top bar switches to Write mode.
- Compact toolbar: tools collapse into a single popover button.
- Dashboard shows notebooks in a 2-column grid.

### 15.3 Storage on other devices

Each browser keeps its own local copy. Notebooks are downloaded on first open and cached. Writing offline on PC or iPhone works the same way as on the iPad.

---

## 16. Visual design

- **Feel:** quiet, paper-like, out of the way. The page is the hero; chrome is light grey.
- **Colours:** app background `#ECEAE4` (warm grey desk), paper `#FDFCF8`, toolbar background `#F7F6F2`, borders `#DAD7CF`, text `#2B2B2B`, secondary text `#7A766D`, accent (selected tool) `#2F5DA8`.
- **Typography:** system font stack (`-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`). No web font downloads, which saves bandwidth and memory. Title 20px, body 16px, toolbar labels 12px.
- **Icons:** inline SVG sprite, simple 2px outlined line icons, 24px drawn inside 44px buttons. Selected tool gets a filled rounded background in the accent colour.
- **Page:** subtle drop shadow (`0 1px 3px rgba(0,0,0,0.15)`) so it reads as a sheet on a desk.
- **Motion:** only short (150ms) opacity/transform transitions for sheets and popovers. No other animation.
- **Logo:** the word "Kagoj" in a simple serif or handwritten style, optionally with "কাগজ" beneath. Home-screen icon: a cream sheet with a single ink line on a charcoal background.

---

## 17. Performance budgets, debugging, and testing

### 17.1 Performance budgets (measured on the iPad 2)

| Metric | Target |
|---|---|
| Ink appears under finger | No visible gap at normal writing speed; live layer ≥ 40 fps |
| Stroke commit | < 16 ms |
| Open a page with 500 strokes | < 500 ms |
| Full redraw of 1000 strokes after zoom | < 300 ms |
| Eraser move (dirty-rect redraw) | < 16 ms per frame typical |
| App launch to dashboard (warm, from local data) | < 1.5 s |
| Total JS shipped | < 120 KB minified |
| Total CSS | < 20 KB |
| Third-party runtime libraries | 0 |

If a budget is missed, simplify the engine before building more features (see section 19, Phase 0 gate).

### 17.2 Debugging on the iPad

Modern desktop Safari cannot easily inspect an iOS 9 device, and development happens on a PC. So Kagoj includes its own tools:

- **On-screen debug console:** tap the version number in Settings 5 times to toggle an overlay that shows recent `K.log()` messages, `window.onerror` errors (with file and line), storage backend in use, memory-relevant counts (strokes on page, points total), and the last frame time.
- **FPS meter** option in the debug overlay.
- **Remote logs (optional):** errors are also sent to the `client_logs` table when online, so I can read iPad errors from the PC in the Supabase dashboard.
- **Device info line:** user agent, screen size, `devicePixelRatio`, standalone mode yes/no, IndexedDB yes/no.

### 17.3 Testing rules

- A feature is not done until it works **on the actual iPad 2**, from the home-screen app. Working in Chrome on the PC proves nothing about iOS 9.
- Use desktop browsers for quick iteration only.
- Before each deploy: lint (ES5 rules), build, then a manual smoke test on the iPad: log in, open notebook, write, erase, undo, zoom, switch page, go offline (turn off Wi-Fi), write, kill the app, reopen, turn Wi-Fi on, confirm sync.
- Keep a small "stress" notebook with a page of ~1000 strokes to check performance after engine changes.

---

## 18. Security

- HTTPS everywhere (Vercel and Supabase both enforce it).
- RLS enabled on every table; policies restrict every row to `auth.uid()`. Test this by calling the REST API with the anon key and no user token: it must return nothing.
- Only the anon (publishable) key is in frontend code. The `service_role` key is never in the repo or frontend.
- Public sign-ups disabled in Supabase.
- Tokens stored in `localStorage` on my own devices; never in URLs or logs.
- Notebook titles are inserted into the DOM with `textContent`, never `innerHTML`, to avoid script injection.
- Sanity limits on the client and in Postgres: title ≤ 120 characters, drawing ≤ 2 MB per page (a `check (pg_column_size(drawing) < 2000000)` constraint).

---

## 19. Project structure

```
kagoj/
├── index.html
├── css/
│   └── app.css
├── js/
│   ├── config.js            # Supabase URL + anon key, app version
│   ├── core/
│   │   ├── util.js          # uuid, debounce, throttle, extend, time formatting
│   │   ├── dom.js           # tiny DOM helpers, event binding
│   │   └── log.js           # K.log, error capture, debug overlay
│   ├── net/
│   │   ├── xhr.js           # request(method, url, headers, body, cb) with timeout
│   │   └── supabase.js      # auth (login/refresh/logout) + REST helpers
│   ├── store/
│   │   ├── store.js         # common interface
│   │   ├── idb.js           # IndexedDB adapter
│   │   └── ls.js            # localStorage adapter
│   ├── sync/
│   │   └── sync.js          # queue, push, pull, conflicts, retry, status events
│   ├── draw/
│   │   ├── geometry.js      # simplify (RDP), resample, bbox, distance
│   │   ├── codec.js         # encode/decode stroke format v1
│   │   ├── input.js         # touch / pointer / mouse → engine events
│   │   ├── render.js        # paper patterns, stroke batching, dirty rects
│   │   ├── eraser.js        # hit testing + stroke splitting
│   │   ├── history.js       # undo/redo operations
│   │   ├── viewport.js      # zoom, pan, pinch, transforms
│   │   └── engine.js        # ties it all together for one page
│   └── ui/
│       ├── router.js
│       ├── login.js
│       ├── dashboard.js
│       ├── workspace.js
│       ├── toolbar.js
│       ├── sheets.js        # modals, action sheets, confirms
│       └── settings.js
├── icons/                   # apple-touch-icon, launch images, SVG sprite
├── supabase/
│   └── schema.sql
├── scripts/
│   └── build.js             # lint check, concat js/css in order, hash names → dist/
├── .eslintrc.json
└── vercel.json
```

---

## 20. Development phases

Each phase ends with a test on the iPad. Do not start the next phase until the current one passes.

### Phase 0 — Device spike (do this first)

Goal: prove the iPad can do the hard parts before building anything else.

- Single HTML file deployed to Vercel: one canvas, one-finger drawing with midpoint smoothing, a "clear" button, an FPS readout.
- Load it on the iPad in Safari and from the home screen.
- Check: HTTPS certificate works (section 5), drawing is responsive, no page scrolling or zooming while drawing, rotation works.
- Add an XHR test button: call Supabase `/auth/v1/token` and `/rest/v1/` and show the result.
- Add a storage test button: IndexedDB write/read in both Safari and home-screen mode.

**Exit gate:** writing feels responsive, HTTPS and Supabase calls succeed (with certificate profile if needed), and the storage backend is decided. If drawing feels laggy, fix the engine here.

### Phase 1 — Drawing engine, single page, local only

- Layered canvases, pen (colours + sizes), highlighter, eraser (both modes), undo/redo.
- Zoom and pan (pinch + toolbar), paper styles.
- Stroke format v1 with save/load to IndexedDB (one hard-coded page).

**Exit gate:** acceptance criteria 5–10 pass on the iPad, performance budgets met with the 1000-stroke stress page.

### Phase 2 — Notebooks and pages, local only

- Dashboard, create/rename/recolour/duplicate/delete notebooks, search.
- Multiple pages, add/delete/clear, page navigation and page list, per-page paper.
- Router, remember last open notebook, home-screen setup and icons.

**Exit gate:** a full notebook workflow works offline with nothing but the iPad.

### Phase 3 — Supabase: auth and sync

- Schema + RLS in Supabase, my user created, sign-ups disabled.
- Login screen, token storage and refresh, logout.
- Sync manager: push, pull, conflict copies, retry, status pill.

**Exit gate:** write on the iPad, see it appear on the PC; edit offline, reconnect, everything syncs; killing Safari mid-sync loses nothing.

### Phase 4 — PC and iPhone polish

- Pointer/mouse input, keyboard shortcuts, high-DPI canvas on PC.
- iPhone view mode and compact toolbar.

### Phase 5 — Polish and hardening

- Settings screen (recently deleted, storage info, logout, debug toggle).
- UI refinements, icons, launch images, empty states.
- Performance pass on the iPad, remote error log review.

---

## 21. Acceptance criteria (v1 done)

1. I can log in from the Kagoj home-screen app on the iPad 2.
2. I stay logged in after closing and reopening the app days later.
3. I can create, rename, recolour, and delete notebooks; deleted ones can be restored.
4. I can add, delete, and move between pages, and each page can have its own paper style.
5. I can write with my finger and the ink keeps up with normal handwriting speed.
6. I can switch between pen and highlighter, choose colours and sizes; highlights sit under ink.
7. I can erase parts of strokes and whole strokes.
8. Undo and redo work for writing, highlighting, erasing, and clearing.
9. Pinch-to-zoom, two-finger pan, and toolbar zoom work and stay smooth.
10. The page never scrolls, bounces, or zooms the browser itself while I write.
11. Everything is saved on the iPad within a second of lifting my finger.
12. With Wi-Fi off, I can keep writing; when Wi-Fi returns, everything syncs without me doing anything.
13. Notes written on the iPad appear on my PC and iPhone, and edits there appear on the iPad.
14. No change is ever lost; simultaneous edits produce a conflict copy instead.
15. All of the above is verified on the real iPad 2 running iOS 9.3.5.

---

## 22. v2 roadmap (not in v1, but planned for)

### 22.1 Handwriting smoothing and correction

- **Stronger smoothing:** Catmull-Rom or Chaikin smoothing applied on commit, with a user setting (Off / Light / Strong).
- **Stroke beautification:** optional straightening of near-straight lines, closing near-closed shapes, and evening out wobble in long strokes.
- **"Tidy page" action:** re-process all strokes on a page. Because the original points are kept, this is reversible.
- Heavy processing (e.g. machine-learning-based cleanup or handwriting recognition) would run on the PC or in a Supabase Edge Function, not on the iPad 2, with results synced back as new stroke data.
- Data prep in v1: stroke format is versioned (`v`), and raw points are preserved.

### 22.2 PDF export

- Export a page or a whole notebook as an A4 PDF with vector strokes (sharp at any zoom).
- Generated on the PC in a modern browser, or by a Supabase Edge Function that the iPad calls and then opens the resulting file link. Running a PDF library on the iPad 2 is likely too slow.
- Data prep in v1: A4 page ratio (1000 × 1414) maps directly onto PDF pages.

### 22.3 PDF import (annotate PDFs)

- Upload a PDF from the PC; each page is rendered to an image (on the PC with pdf.js or in an Edge Function), stored in Supabase Storage, and referenced by `pages.background_asset`.
- The iPad draws the image on the Paper layer and the handwriting on top, as usual.
- Images sized for the iPad (around 1000–1500 px wide, JPEG) to respect its memory limits.
- Data prep in v1: the `background_asset` column already exists.

### 22.4 Palm detection

The iPad 2 has no Pencil, so rejection has to rely on heuristics:

- Check in Phase 0 whether iOS 9 exposes touch contact size (`radiusX`/`force` on Touch objects). If it does, ignore touches with a large contact area.
- Otherwise, use heuristics: ignore touches that stay still for a long time, ignore new touches in the area below/beside the active writing finger (based on a left- or right-handed setting), and offer a **wrist guard**: a shaded area at the bottom of the screen where touches are ignored and that can be moved up as I write.
- Data prep in v1: all input goes through one `input.js` module, so filtering can be added there without touching the engine.

### 22.5 Smaller v1.x ideas

Page thumbnails on the dashboard and in the page list, reorder pages by drag, custom pen colours, a lasso tool to move strokes, notebook folders, and a page template with date heading.

---

## 23. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| HTTPS certificates rejected by iOS 9 | High | Blocks everything online | Phase 0 test; install root certificate profile; proxy fallback (section 5) |
| Drawing too slow on the A5 chip | Medium | Core experience fails | Phase 0 spike; layered canvases, incremental drawing, batching, RDP simplification |
| IndexedDB broken in home-screen mode | Medium | Weaker offline storage | Startup self-test, localStorage fallback with eviction, cloud as backup |
| Safari kills the tab under memory pressure | Medium | Possible loss of the last strokes | Viewport-sized canvases, one page in memory, save on every commit and on `pagehide` |
| Supabase free project paused | Medium | Sync stops | Local-first design; resume from dashboard |
| Supabase REST/auth changes in the future | Low | Sync breaks | All Supabase calls isolated in `net/supabase.js` |
| Device clock wrong on the iPad | Medium | Sync ordering errors | Use server timestamps and revision numbers, never device time, for sync |

---

## 24. Open questions

These do not block Phase 0, but should be answered before the relevant phase.

1. Left- or right-handed? (Affects default toolbar side and v2 palm rejection.)
2. Mostly landscape or portrait while writing? (Affects default zoom: fit width vs. fit page.)
3. Is the iPhone mainly for reading, or will real writing happen there? (Decides how much Phase 4 polish the iPhone gets.)
4. Custom domain for Kagoj, or the default `*.vercel.app` address?
5. Should notebooks have a page size other than A4 (e.g. a wider "infinite whiteboard" notebook) in a later version?
