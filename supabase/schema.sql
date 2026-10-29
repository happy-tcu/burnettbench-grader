-- BurnettBench human validation — schema
-- Run this once in the Supabase SQL editor.

create table if not exists public.ratings (
  id          bigserial primary key,
  grader_name text not null,
  grader_email text,
  verdict_id  text not null,
  institution text not null,
  model       text not null,
  condition   text not null,
  human_verdict text not null check (human_verdict in ('A','B','C','SKIP')),
  rating_ms   integer,
  created_at  timestamptz not null default now()
);

create index if not exists ratings_grader_idx on public.ratings (grader_name);
create index if not exists ratings_verdict_idx on public.ratings (verdict_id);

-- Row-level security: allow anonymous INSERT only.
-- Reads are restricted to the service_role key (used by the researcher locally).
alter table public.ratings enable row level security;

drop policy if exists "anon can insert ratings" on public.ratings;
create policy "anon can insert ratings"
  on public.ratings for insert
  to anon
  with check (true);
