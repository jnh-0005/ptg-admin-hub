# Deploying on GitHub + Supabase + Vercel

This app originally ran on folk's hosted platform, talking to a managed
SQLite database through an unauthenticated `__folkdata/query` endpoint. This
deployment target replaces that with:

- **GitHub** — source of truth, connected to Vercel for auto-deploy on push.
- **Supabase** — Postgres database, plus Supabase Auth for admin login.
- **Vercel** — hosts the static Vite build and the `/api/query` serverless
  function that runs SQL against Supabase on the app's behalf.

## Why the database layer changed

Vercel serverless functions have no persistent disk, so a SQLite file
wouldn't survive between requests — a real external database is required.
Supabase's hosted Postgres fills that role.

The app's SQL was written for SQLite (`AUTOINCREMENT`, `PRAGMA table_info`,
`INSERT OR IGNORE/REPLACE`, SQLite's `COLLATE NOCASE`, etc). Rather than
hand-editing `src/lib/schema.js` / `src/lib/data.js` / `src/pages/PublicCatalog.jsx`
into Postgres dialect, `api/_db.js` translates the small, fully-enumerated
set of SQLite-only constructs this specific app actually uses before running
each statement against Postgres. That list was produced by auditing the
whole source tree, not guessed — see the comments in `api/_db.js` for exactly
what it rewrites and why. This means the app's own source files are
untouched and a future source drop from folk can be applied without
re-porting SQL by hand.

## The one access-control change from the original design

`src/lib/folkdb.js`'s own comment says the original endpoint had "no API
keys, no CORS" — it relied entirely on folk's platform to keep it obscure.
Reproducing that on a public Vercel URL would let anyone who finds the URL
read or write the entire orders/payments/customer ledger. `/api/query` (in
`api/query.js` and `api/_auth.js`) requires a valid Supabase Auth session on
every request instead. The admin app now shows a login screen
(`src/components/AuthGate.jsx`) before it renders anything, mirroring how
the public catalog was already isolated from admin data in `App.jsx`.

## Setup checklist

1. **Supabase project**: create one at supabase.com if you don't already
   have one for this app. No manual schema setup is needed — `initDb()` in
   `src/lib/schema.js` creates and migrates every table on first
   authenticated load, exactly as it did against folk's database.
2. **Create at least one admin user**: Supabase dashboard → Authentication →
   Users → Add user (email + password). That's the login for the admin app.
3. **Collect four values** from the Supabase dashboard:
   - Project Settings → Database → Connection string → **Transaction
     pooler** (port 6543) → `DATABASE_URL`
   - Project Settings → API → Project URL → `SUPABASE_URL` /
     `VITE_SUPABASE_URL` (same value, two names)
   - Project Settings → API → `anon` `public` key → `SUPABASE_ANON_KEY` /
     `VITE_SUPABASE_ANON_KEY` (same value, two names)
4. **Vercel**: import the GitHub repo as a new project (Vercel auto-detects
   Vite). In Project Settings → Environment Variables, set all four values
   above. Never paste them into chat or commit them — `.env.example`
   documents the shape only.
5. **Deploy**. Vercel builds with `npm run build` and serves `dist/`, and
   picks up `api/*.js` as serverless functions automatically. `vercel.json`
   adds the SPA-fallback rewrite the nested `/public/paddles-7x4k` route
   needs on a hard reload.
6. **Sign in** at the deployed URL with the admin user created in step 2.

## Local development

Copy `.env.example` to `.env.local`, fill in the same four values (a
separate Supabase project for dev is a good idea so testing never touches
real order data), then `npm run dev`. Vite dev serves the SPA; `vercel dev`
is the easiest way to also run `/api/query` locally if you want the admin
app to actually load data outside of a deployed preview.
