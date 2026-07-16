# Lennar Vendor Assignments Portal — Setup & Deployment (v4)

Static site (free on **GitHub Pages**) + free backend (**Supabase**). Login is a
**6-digit email code** — no passwords, no Azure/IT access needed. You only add a
free email provider so codes reach real inboxes. Runs in **DEMO mode** out of the
box so you can preview before wiring anything.

---

## Part A — Preview now (no setup)

Open `index.html` (or run `python -m http.server`). Sign in with any `@lennar.com`
email and code **`123456`**. `stephen.svedman@lennar.com` is **admin**; everyone
else is a **viewer**. Orange **DEMO** badge = no backend connected.

---

## Part B — Create the Supabase project

1. Free project at **supabase.com** (region East US; save the DB password).
2. **SQL Editor → New query** → paste all of **`supabase_setup.sql`** → **Run**
   (safe to re-run; creates tables + security rules + seeds you as admin).
3. **Project Settings → API** → copy **Project URL** + **anon public** key.
4. Edit **`config.js`** → replace the two `YOUR_..._HERE` values → save.
   (The anon key is public/safe; security is the RLS rules. Never paste service_role.)

---

## Part C — Make login codes reach real inboxes (free email provider)

Supabase's built-in email only sends to your own project team and is capped at 2/hr,
so you add a free provider. No server, no Azure — just an account and 5 settings.

### 1. Pick a free provider and get SMTP credentials
- **Brevo** (brevo.com) — 300 emails/day free. After signing up, go to
  **SMTP & API → SMTP** and copy: host `smtp-relay.brevo.com`, port `587`, your
  login, and the SMTP key.
- or **Resend** (resend.com) — 3,000/mo free; **API Keys / SMTP** gives host
  `smtp.resend.com`, port `587`, user `resend`, and the key as the password.

### 2. Verify a sender address
In the provider, verify the "from" address you'll send as (they email you a link to
click). If you can add DNS records for a domain you control, do it — deliverability
to `@lennar.com` inboxes is best that way. If not, a verified single sender still
works; just tell testers to check spam the first time.

### 3. Put SMTP into Supabase
**Authentication → Emails → SMTP Settings** → enable **Custom SMTP** → paste host,
port, username, password, and set the sender email/name to the address you verified.

### 4. Switch the emails to send a CODE (not a link)
**Authentication → Emails → Templates**. Edit **Magic Link** *and* **Confirm signup**
so the body contains `{{ .Token }}` (the 6-digit code) instead of
`{{ .ConfirmationURL }}`. Example body:

```
<h2>Your Vendor Portal sign-in code</h2>
<p>Enter this code to sign in:</p>
<h1>{{ .Token }}</h1>
<p>This code expires in 1 hour. If you didn't request it, ignore this email.</p>
```

(Template editing unlocks once custom SMTP is on.) Also under **Authentication →
Providers → Email**, keep Email enabled. Now `signInWithOtp` emails a code, and the
site's verify screen accepts it.

---

## Part D — Deploy on GitHub Pages (free)

1. Create a repo; upload this folder's contents (keep `index.html` at the root).
2. **Settings → Pages** → Deploy from branch → `main` / root. Live in ~1 min at
   `https://<user>.github.io/<repo>/`.
3. **Supabase → Authentication → URL Configuration** → set **Site URL** to that
   address and add it under **Redirect URLs** (add your local URL too for testing).

---

## Part E — Roles

Everyone at `@lennar.com` is a **viewer** by default. Grant more in `config.js`
`ROLES` and/or the `app_roles` table (**Table Editor → app_roles → Insert row**):
`role` = `editor` (with `divisions` like `{tampa}`) or `admin`. You're seeded as admin.

---

## Part F — Load / update data

Sign in as admin → **Admin** → pick a division → upload its **RE2 export** (Book1)
and its **starts file** → review preview → **Publish** (full replace, logged to
change history). Auto-detected formats:
- **Orlando** starts: `START SCHEDULE` tab (`Comm`, `Start (Prj)/(Act)`, `Job`).
- **Tampa** starts: `Start Log` tab (community = text after " - " in `Project`).
- Assignments: RE2 `Trade Desc.`, `Supplier Desc`, `Community`, `Division`
  (filtered OLH/TPU), expired rows skipped.
Communities shown = starts-in-range ∪ any active assignment.

---

## Features
- 6-digit email-code login restricted to @lennar.com; roles admin/editor/viewer
- Lennar logo doubles as a home button (returns to first view)
- Division dropdown + date-range filter (default current year)
- By Community, By Vendor, Full Matrix, Coverage Gaps, Starts
- Coverage Gaps: single-source trades + communities missing a trade
- Global search; Print/PDF; CSV export on every table
- Last-updated banner; change history of uploads; mobile-responsive

## Files
- `index.html` `styles.css` `app.js` — the site
- `config.js` — keys, roles, divisions, default range
- `data/*.json` — parsed division data (demo + reference)
- `supabase_setup.sql` — tables, roles, change log, security rules
- `lennar-logo.png` — brand logo / home button
