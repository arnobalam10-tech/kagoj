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

-- ===================== v1.1: uploads (migration `kagoj_uploads_v1_1`) =====================
create table if not exists public.folders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'New folder' check (char_length(name) <= 120),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists folders_updated_idx on public.folders (user_id, updated_at);
create trigger folders_touch before update on public.folders
  for each row execute function public.touch_updated_at();
alter table public.folders enable row level security;
create policy "own folders" on public.folders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.folders from anon;

alter table public.notebooks
  add column if not exists kind text not null default 'notebook' check (kind in ('notebook','document')),
  add column if not exists folder_id uuid references public.folders(id) on delete set null,
  add column if not exists source_name text check (source_name is null or char_length(source_name) <= 300);
create index if not exists notebooks_folder_idx on public.notebooks (folder_id);
alter table public.pages
  add constraint pages_background_asset_len check (background_asset is null or char_length(background_asset) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 52428800, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy "kagoj own uploads read" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kagoj own uploads insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kagoj own uploads update" on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kagoj own uploads delete" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.kagoj_asset_in_use(prefix text, exclude_notebook uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.pages p
    join public.notebooks n on n.id = p.notebook_id
    where p.notebook_id <> exclude_notebook
      and p.deleted_at is null and n.deleted_at is null
      and (p.background_asset like prefix || '%' or p.drawing::text like '%' || prefix || '%')
  );
$$;
revoke all on function public.kagoj_asset_in_use(text, uuid) from anon, public;
grant execute on function public.kagoj_asset_in_use(text, uuid) to authenticated;

-- ===================================================================
-- Migration kagoj_v2_docs (V2: typed pages, databases, rows, versions)
-- ===================================================================
create table if not exists public.docs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.docs(id) on delete cascade,
  kind text not null default 'page' check (kind in ('page','database','row','canvas')),
  title text not null default '' check (char_length(title) <= 500),
  icon text check (icon is null or char_length(icon) <= 300),
  cover text check (cover is null or char_length(cover) <= 300),
  position int not null default 0,
  favorite boolean not null default false,
  content jsonb not null default '[]'::jsonb check (pg_column_size(content) < 4000000),
  props jsonb not null default '{}'::jsonb,
  schema jsonb,
  settings jsonb not null default '{}'::jsonb,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists docs_updated_idx on public.docs (user_id, updated_at);
create index if not exists docs_parent_idx on public.docs (parent_id, position);
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs
  for each row execute function public.touch_updated_at();
alter table public.docs enable row level security;
create policy "own docs" on public.docs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.docs from anon;

create table if not exists public.doc_versions (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_id uuid not null references public.docs(id) on delete cascade,
  title text,
  content jsonb not null,
  props jsonb,
  created_at timestamptz not null default now()
);
create index if not exists doc_versions_doc_idx on public.doc_versions (doc_id, created_at desc);
alter table public.doc_versions enable row level security;
create policy "own versions" on public.doc_versions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.doc_versions from anon;
revoke all on sequence public.doc_versions_id_seq from anon;

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  feed_token text unique,
  updated_at timestamptz not null default now()
);
drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_settings from anon;

update storage.buckets set allowed_mime_types = null where id = 'uploads';

-- Migration kagoj_v2_sections: sidebar sections are top-level docs of kind 'section'
alter table public.docs drop constraint docs_kind_check;
alter table public.docs add constraint docs_kind_check check (kind in ('page','database','row','canvas','section'));
