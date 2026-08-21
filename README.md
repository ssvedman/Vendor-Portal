# Vendor Assignments Portal

Internal web app for viewing division vendor/community trade assignments and start
schedules. Static site (GitHub Pages) backed by Supabase for login, roles, and data.

## Live features
- Email + password sign-in, restricted to company accounts; roles: admin / editor / viewer.
  There is no self-service reset: an admin generates a one-time link (valid 24 hours)
  from the Admin page and sends it to the person, who sets their own password
- Division selector (Tampa, Orlando) with a date-range filter (default current year)
- Views: By Community, By Vendor (starts-by-community grid), Full Matrix,
  Coverage Gaps (by trade / by community, adjustable core threshold), Starts
- Global search, CSV export on every view, Print/PDF, change history, mobile layout

## Structure
- `index.html`, `styles.css`, `app.js` — the site
- `config.js` — Supabase URL + anon key, roles, divisions, default range
- `logo.svg` — brand logo / home button / favicon

Division data lives in Supabase, not in this repo. The database schema and
row-level-security policies are kept out of the public
repo and already applied to the Supabase project.