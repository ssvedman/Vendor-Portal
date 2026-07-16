# Lennar Vendor Assignments Portal

Internal web app for viewing division vendor/community trade assignments and start
schedules. Static site (GitHub Pages) backed by Supabase for login, roles, and data.

## Live features
- 6-digit email-code login, restricted to `@lennar.com`; roles: admin / editor / viewer
- Division selector (Tampa, Orlando) with a date-range filter (default current year)
- Views: By Community, By Vendor (starts-by-community grid), Full Matrix,
  Coverage Gaps (by trade / by community, adjustable core threshold), Starts
- Global search, CSV export on every view, Print/PDF, change history, mobile layout

## Structure
- `index.html`, `styles.css`, `app.js` — the site
- `config.js` — Supabase URL/keys, roles, divisions, default range
- `data/*.json` — bundled division data (used in demo mode / as reference)
- `supabase_setup.sql` — database schema + row-level-security policies
- `lennar-logo.png` — brand logo / home button
- `SETUP.md` — full setup & deployment guide

## Deploy
Push these files to a GitHub repo (with `index.html` at the root) and enable
**Settings → Pages → Deploy from branch → main / root**. See `SETUP.md` for the
Supabase and email steps.
