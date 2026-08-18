# HRMS Pro

Internal HR management system (staff directory, attendance, recruitment/ATS, KPI
reporting) built to replace a manual weekly "Monir KPI" report. SvelteKit + Supabase.

Full design/roadmap: see the plan file this repo was built from (not tracked in git —
kept locally at `docs/superpowers/plans/2026-08-18-phase1-mvp.md`, or ask whoever built
this for a copy).

## Stack

- **Frontend/server:** SvelteKit 2 (Svelte 5, runes mode) + TypeScript
- **Backend:** Supabase — Postgres, Auth, Storage
- **Charts:** Chart.js
- **Export:** `html-to-image` + `jspdf` + Clipboard API (screenshot/PDF/copy on the
  Weekly Report dashboard)

## Setup

### 1. Install dependencies

```bash
npm install
```

Node **>=22** is required (`@supabase/*` packages enforce this via `engines` +
`engine-strict=true` in `.npmrc`).

### 2. Environment variables

```bash
cp .env.example .env
```

Fill in `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` from your Supabase
project's dashboard (Settings → API).

### 3. Database schema

This project shares its Supabase project with another, unrelated app — every table this
project owns is prefixed `hrms_` so there's no collision. Because of that, and because
the shared project's migration history already belongs partly to the other app, schema
changes here are **not** applied via `supabase db push`. Instead:

1. Open the Supabase dashboard → SQL Editor for your project.
2. Run `supabase/manual-apply/0001_phase1_schema.sql` (creates all 12 `hrms_*` tables +
   RLS policies).
3. Run `supabase/manual-apply/0002_storage_policy.sql` (grants authenticated access to
   the `hrms-employee-documents` Storage bucket — create that bucket first via
   Dashboard → Storage → New bucket, named exactly `hrms-employee-documents`, **not
   public**).

Both scripts are idempotent — safe to re-run.

`supabase/migrations/0001_phase1_schema.sql` holds the same schema as source-of-truth
documentation; it is intentionally never pushed via the CLI for the reason above.

### 4. Create a login user

This is an admin/HR-only tool — there's no self-service signup. Create your first user
via Supabase Dashboard → Authentication → Users → Add user (email + password), or via
the Admin API. Every authenticated user has full access (single-role app, no RBAC in
Phase 1).

Forgot your password later? Use the "Forgot password?" link on the login page — it
sends a real reset email through Supabase's configured email provider.

### 5. Run it

```bash
npm run dev
```

Visit `http://localhost:5173` — you'll be redirected to `/login`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run check` | Type-check (svelte-check) |
| `npm run test` | Run Vitest unit tests (pure calculation logic only — attendance summary, recruitment funnel, work-plan rollover, URL filters) |

## What's built (Phase 1 MVP)

- Departments / Positions (org setup)
- Employee directory + document upload
- Attendance entry (present/late/absent/MC/leave) + weekly summary
- Recruitment/ATS: job openings with per-opening configurable pipeline stages,
  candidates, funnel chart, new-hire conversion
- Operational issues log
- Weekly work plan with rollover to next week
- Weekly Report dashboard — filterable, charted, exportable (screenshot/PDF/clipboard)
- Auth: login, logout, forgot/reset password

Phases 2-4 (leave management, notifications, KPI/performance reviews, org chart, audit
log, payroll) are scoped in the design doc but not yet built.

## Notes

- This Supabase project is shared with an unrelated app — never remove the `hrms_`
  prefix from table/bucket names, and never run `supabase migration repair` or
  `supabase db pull` against it (see `supabase/manual-apply/` comments for why).
- `@sveltejs/adapter-auto` is still the scaffold default — swap it for a concrete
  adapter before deploying anywhere.
