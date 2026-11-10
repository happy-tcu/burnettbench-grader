-- BurnettBench human validation — schema
-- Run this once in the Supabase SQL editor on a fresh project.
-- Three tables: questions (anon SELECT), ratings (anon INSERT only), judge_verdicts (service_role only).

create table if not exists public.questions (
  id          text primary key,
  institution text not null,
  fact_id     text not null,
  model       text not null,
  condition   text not null,
  category    text,
  fact        text not null,
  probe       text not null,
  response    text not null,
  in_v2       boolean not null default false,
  sources     jsonb not null default '[]'::jsonb
);

create table if not exists public.ratings (
  id            bigserial primary key,
  grader_name   text not null,
  grader_email  text,
  verdict_id    text not null,
  institution   text not null,
  model         text not null,
  condition     text not null,
  human_verdict text not null check (human_verdict in ('A','B','C','FLAG','SKIP')),
  rating_ms     integer,
  comment       text,
  created_at    timestamptz not null default now()
);

create index if not exists ratings_grader_idx  on public.ratings (grader_name);
create index if not exists ratings_verdict_idx on public.ratings (verdict_id);

create table if not exists public.judge_verdicts (
  id            text primary key,
  judge_verdict text not null check (judge_verdict in ('A','B','C','FLAG','SKIP'))
);

-- Row-level security.
alter table public.questions      enable row level security;
alter table public.ratings        enable row level security;
alter table public.judge_verdicts enable row level security;

-- questions: public catalog (anon can read).
drop policy if exists "anon can read questions" on public.questions;
create policy "anon can read questions"
  on public.questions for select
  to anon
  using (true);

-- ratings: write-only drop box (anon can insert, no select).
drop policy if exists "anon can insert ratings" on public.ratings;
create policy "anon can insert ratings"
  on public.ratings for insert
  to anon
  with check (true);

-- judge_verdicts: no anon policy at all → service_role only.
-- Seed questions + judge_verdicts from private/sample_with_verdicts.json
-- using the service_role key (see README).
