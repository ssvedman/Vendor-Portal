-- ============================================================
-- Lennar Vendor Assignments Portal — Supabase schema + security (v2.1)
-- Safe to re-run: policies are dropped-if-exists before creation.
-- Run in Supabase > SQL Editor.
-- ============================================================

-- 1) Division data ------------------------------------------------------------
create table if not exists public.division_data (
  key        text primary key,
  label      text not null,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.division_data enable row level security;

-- 2) Roles --------------------------------------------------------------------
create table if not exists public.app_roles (
  email      text primary key,
  role       text not null default 'viewer',
  divisions  text[] default '{}'
);
alter table public.app_roles enable row level security;
insert into public.app_roles(email,role) values ('stephen.svedman@lennar.com','admin')
  on conflict (email) do update set role='admin';

-- 3) Change log ---------------------------------------------------------------
create table if not exists public.change_log (
  id         bigint generated always as identity primary key,
  key        text not null,
  actor      text,
  summary    jsonb,
  created_at timestamptz not null default now()
);
alter table public.change_log enable row level security;

-- helpers ---------------------------------------------------------------------
create or replace function public.jwt_email() returns text
  language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;
create or replace function public.my_role() returns text
  language sql stable as $$ select coalesce((select role from public.app_roles where email = public.jwt_email()),'viewer') $$;

-- READ: any @lennar.com user ---------------------------------------------------
drop policy if exists "lennar read divisions" on public.division_data;
create policy "lennar read divisions" on public.division_data for select
  to authenticated using ( public.jwt_email() like '%@lennar.com' );

drop policy if exists "lennar read roles" on public.app_roles;
create policy "lennar read roles" on public.app_roles for select
  to authenticated using ( public.jwt_email() like '%@lennar.com' );

drop policy if exists "lennar read changelog" on public.change_log;
create policy "lennar read changelog" on public.change_log for select
  to authenticated using ( public.jwt_email() like '%@lennar.com' );

-- WRITE division_data: admin (any) or editor (their divisions) ----------------
-- NOTE: compare the text key against the ELEMENTS of the divisions text[] array
--       using EXISTS + (key = any(r.divisions)) — avoids "text = text[]".
drop policy if exists "admin/editor write divisions" on public.division_data;
create policy "admin/editor write divisions" on public.division_data for all
  to authenticated
  using (
    public.my_role() = 'admin'
    or exists (
      select 1 from public.app_roles r
      where r.email = public.jwt_email() and r.role = 'editor'
        and division_data.key = any (coalesce(r.divisions, '{}'))
    )
  )
  with check (
    public.my_role() = 'admin'
    or exists (
      select 1 from public.app_roles r
      where r.email = public.jwt_email() and r.role = 'editor'
        and division_data.key = any (coalesce(r.divisions, '{}'))
    )
  );

-- WRITE change_log: any admin/editor ------------------------------------------
drop policy if exists "admin/editor append changelog" on public.change_log;
create policy "admin/editor append changelog" on public.change_log for insert
  to authenticated with check ( public.my_role() in ('admin','editor') );

-- MANAGE roles: admin only ----------------------------------------------------
drop policy if exists "admin manage roles" on public.app_roles;
create policy "admin manage roles" on public.app_roles for all
  to authenticated
  using ( public.my_role() = 'admin' ) with check ( public.my_role() = 'admin' );

-- Load data via the site's Admin page (upload RE2 + starts per division).
