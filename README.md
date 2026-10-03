# Kagoj (কাগজ)

Personal handwriting notebook for an iPad 2 (iOS 9.3.5, Safari 9), synced through Supabase,
also usable on PC and iPhone. See [prd.md](prd.md), [PLAN.md](PLAN.md), [STATE.md](STATE.md).

- Frontend: hand-written ES5, no runtime dependencies (`js/`, `css/`, `index.html`).
- Backend: Supabase REST (`/auth/v1`, `/rest/v1`) via `XMLHttpRequest`. Schema: `supabase/schema.sql`.
- Hosting: Vercel, static `dist/` built by `scripts/build.js`.

## Commands

```bash
npm install          # dev tools only (eslint, terser)
npm run lint         # ES5 contract check
npm test             # unit tests for the drawing core
npm run build        # lint + bundle + hash -> dist/
node scripts/serve.js . 5173   # run unminified sources locally
```

`/spike/` is the Phase 0 device test page (drawing feel, HTTPS/XHR, storage).
