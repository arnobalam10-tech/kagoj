-- Kagoj schema (PRD §13.2). Applied as migration `kagoj_schema_v1`.
-- Deviation: pages.label (text) added so conflict copies keep their
-- "conflict copy (iPad, 3 Oct 14:20)" name across devices (PRD §14.3).

create table if not exists public.notebooks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Untitled notebook' check (char_length(title) <= 120),
  cover_color text not null default '#2F3640',
  default_paper text not null default 'ruled'
    check (default_paper in ('blank','ruled','grid','dotted')),
  page_count int not null default 0,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.pages (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  position int not null,
  paper text not null default 'ruled'
    check (paper in ('blank','ruled','grid','dotted')),
  drawing jsonb not null default '{"v":1,"w":1000,"h":1414,"strokes":[]}'
    check (pg_column_size(drawing) < 2000000),
  revision int not null default 1,
  label text check (label is null or char_length(label) <= 200),
  background_asset text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists pages_notebook_idx on public.pages (notebook_id, position);
create index if not exists notebooks_updated_idx on public.notebooks (user_id, updated_at);
create index if not exists pages_updated_idx on public.pages (user_id, updated_at);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists notebooks_touch on public.notebooks;
create trigger notebooks_touch before update on public.notebooks
  for each row execute function public.touch_updated_at();
drop trigger if exists pages_touch on public.pages;
create trigger pages_touch before update on public.pages
  for each row execute function public.touch_updated_at();

alter table public.notebooks enable row level security;
alter table public.pages enable row level security;

create policy "own notebooks" on public.notebooks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own pages" on public.pages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.client_logs (
  id bigserial primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  device text check (device is null or char_length(device) <= 300),
  level text check (level is null or char_length(level) <= 20),
  message text check (message is null or char_length(message) <= 4000),
  created_at timestamptz default now()
);
create index if not exists client_logs_user_idx on public.client_logs (user_id, created_at);
alter table public.client_logs enable row level security;
create policy "own logs" on public.client_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Migration `kagoj_revoke_anon`: the anon role never needs these tables.
revoke all on public.notebooks, public.pages, public.client_logs from anon;
revoke all on sequence public.client_logs_id_seq from anon;
