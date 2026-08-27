# PTG Admin Hub

Mobile-first operations console for Paddle To Go — inventory, batches,
orders, payments, invoices, and a storefront photo approval desk.

## Stack

Vite + React + Tailwind, deployed on GitHub → Vercel, backed by Supabase
(Postgres + Auth). Originally built against folk's hosted SQLite transport;
see [`docs/deployment-supabase-vercel.md`](docs/deployment-supabase-vercel.md)
for what changed and why, and for the full setup checklist.

## Local development

1. Install a supported Node.js version.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in your Supabase project's
   values (see the deployment doc).
4. Run `npm run dev` for local development.
5. Run `npm run build` for a production build.
6. Run `npm test` for automated tests.

Runtime secrets (`DATABASE_URL`, `SUPABASE_ANON_KEY`, etc.) must be supplied
through `.env.local` locally or the Vercel project's environment variable
settings in production — never committed to this repository.

## Safety notes

The archive intentionally excludes dependency directories, build output, browser and QA artifacts, Git metadata, logs, local database files, environment files, credentials, live customer/order/payment data, raw payment QR assets and user-uploaded proof files.
