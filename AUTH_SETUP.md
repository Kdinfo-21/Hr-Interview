# Recruiter Auth — Setup Guide

This adds a login/registration screen that gates the recruiter side of the
app (Dashboard, Schedule Interview, Report). The candidate interview flow
(`/interview/:token`) is untouched and stays link-based, no login needed.

```
login/registration
        |
        v
 rest of application  (Dashboard, Schedule Interview, Reports)
```

## 1. Update the database (Neon)

Run this once against your existing Neon database — it only **adds** a new
`recruiters` table, nothing else is touched:

```bash
psql "$DATABASE_URL" -f backend_python/migrations/001_add_recruiters.sql
```

(Or paste the contents of that file into the Neon SQL editor.) This is also
folded into `backend_python/schema.sql` if you ever run `init_db.py` fresh.

## 2. Backend

```bash
cd backend_python
pip install -r requirements.txt --break-system-packages   # adds bcrypt, PyJWT, email-validator
```

Add to `backend_python/.env` (see `.env.example`):

```
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_hex(32))">
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080
```

If you skip `JWT_SECRET`, the server still runs (it generates a random one
at startup and logs a warning) — but every restart will log everyone out,
so set it for anything beyond quick local testing.

Start the API as usual:
```bash
uvicorn app.main:app --reload
```

New endpoints:
- `POST /api/auth/register` — `{ name, email, password }` → `{ token, recruiter }`
- `POST /api/auth/login` — `{ email, password }` → `{ token, recruiter }`
- `GET /api/auth/me` — `Authorization: Bearer <token>` → recruiter profile

Now-protected endpoints (require `Authorization: Bearer <token>`):
`/api/candidates/*`, `/api/dashboard/*`, `/api/resume/*`, `/api/question-sets/*`,
plus the recruiter-only parts of `/api/interviews` (schedule/list/cancel),
`/api/responses/interview/{id}`, and `/api/proctoring/interview/{id}`.

Still public (candidate-facing, unchanged): every `/token/{token}` route.

## 3. Frontend

No new env vars needed. Just install/build as usual:
```bash
cd frontend
npm install
npm run dev
```

Visiting `/admin` (or anything under it) now redirects to `/login` if you're
signed out. After logging in or registering you land back on the page you
were headed to (defaults to `/admin`). There's a "Log out" button in the
top nav.

## 4. Quick test

1. Go to `/login`, switch to "Create account", register with a name/email/
   8+ char password.
2. You should land on `/admin`.
3. Refresh the page — you should stay logged in (session is restored from
   the stored token).
4. Click "Log out" — you should be bounced to `/login`, and hitting `/admin`
   directly should redirect to `/login` too.
5. `/interview/<any existing token>` should still work with no login.

## Notes / things worth knowing

- Passwords are hashed with bcrypt before being stored — the raw password is
  never saved anywhere.
- Sessions are stateless JWTs stored in the browser's `localStorage`
  (`hr_recruiter_token`). Logging out just deletes it client-side; there's
  no server-side session table to clean up.
- This intentionally does **not** add roles/permissions or email
  verification/password reset — say the word if you want either added next.
  (Per-account data isolation *is* in place — see below.)

## Data isolation (each recruiter sees only their own data)

Every recruiter account is its own tenant. `candidates`, `interviews` and
`question_sets` carry an `owner_id` (the recruiter who created the row);
questions, responses, scores, challenges and proctoring events hang off an
interview, so they inherit its owner.

- The owner always comes from the signed-in session token, never from the
  request body, and every recruiter endpoint filters on it. Asking for
  another recruiter's interview/candidate/question set by id returns **404**.
- The same candidate email can exist under different recruiters without one
  overwriting the other (`UNIQUE (owner_id, email)` replaces the old
  global `UNIQUE (email)`).
- The database schema is updated **automatically on API startup**
  (`migrations/002_add_owner_scoping.sql`, idempotent). You can also run it
  by hand: `psql "$DATABASE_URL" -f backend_python/migrations/002_add_owner_scoping.sql`.
- Rows that existed before this change are assigned to the earliest-registered
  recruiter account. To give them to someone else:
  `UPDATE candidates SET owner_id=<new> WHERE owner_id=<old>;` (same for
  `interviews` and `question_sets`).
- This is logical isolation inside one Postgres database (one physical
  database per user is not needed for this and would make migrations and
  connection pooling much harder).

## Candidate interview links

Whoever opens an interview link is treated as the interviewee, even in a
browser where a recruiter was logged in (a recruiter previewing a link, or an
on-site interview on a recruiter's computer):

- Opening an interview link **signs out any recruiter session saved in that
  browser**, so typing `/admin` afterwards shows the login page, never the
  dashboard. Recruiters just log in again from a fresh tab.
- That tab is also **pinned to the interview until it is closed** (including
  after it completes): typing `/login`, `/admin` or any other URL sends the
  candidate back to the interview instead of the recruiter login page.
- Cancelled interviews' links stop working (HTTP 410), and the candidate page
  never receives recruiter-only fields.

The tab pin is client-side; the real protection is server-side: every
recruiter API needs a valid login and only returns that recruiter's own rows.
