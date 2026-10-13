# Kagoj (কাগজ)

Personal notebook (pages, databases, calendar, Apple Pencil handwriting) for an iPad mini 6, PC and phone, synced through Supabase,
also usable on PC and iPhone. See [prd.md](prd.md), [PLAN.md](PLAN.md), [STATE.md](STATE.md).

- Frontend: hand-written plain JS (var/function IIFEs on `window.Kagoj`), no runtime dependencies (`js/`, `css/`, `index.html`). Landing page: `landing.html` at `/landing`.
- Backend: Supabase REST (`/auth/v1`, `/rest/v1`) via `XMLHttpRequest`. Schema: `supabase/schema.sql`.
- Hosting: Vercel, static `dist/` built by `scripts/build.js`.

## Commands

```bash
npm install          # dev tools only (eslint, terser)
npm run lint         # ESLint
npm test             # unit tests for the drawing core
npm run build        # lint + bundle + hash -> dist/
node scripts/serve.js . 5173   # run unminified sources locally
```

`/spike/` is the Phase 0 device test page (drawing feel, HTTPS/XHR, storage).
