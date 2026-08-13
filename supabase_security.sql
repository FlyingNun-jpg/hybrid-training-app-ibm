-- ─────────────────────────────────────────────────────────────────────────────
-- Milkbag security hardening — run this whole file in Supabase → SQL Editor.
-- Fixes every CRITICAL "RLS Disabled in Public" advisory plus the performance
-- warnings (Auth RLS Initialization Plan, unindexed foreign keys).
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) CRITICAL: core tables had RLS disabled — any client with the public anon
--    key could read/write EVERY user's data. Enable RLS + own-row policies.
--    (auth.uid() is wrapped in a sub-select so Postgres evaluates it once per
--    query instead of once per row — this is what the "Initialization Plan"
--    warnings are about.)

alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

alter table public.training_plans enable row level security;
drop policy if exists "own plans" on public.training_plans;
create policy "own plans" on public.training_plans
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.workout_logs enable row level security;
drop policy if exists "own logs" on public.workout_logs;
create policy "own logs" on public.workout_logs
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- lift_logs / run_logs are legacy tables no code references. RLS with NO policies
-- = deny-all for clients (the service role still bypasses). If you're sure you
-- don't need their data, you can `drop table` them instead.
alter table if exists public.lift_logs enable row level security;
alter table if exists public.run_logs enable row level security;

-- 2) PERF: recreate the strava/push policies with the optimized auth.uid() form.
drop policy if exists "own strava row" on public.strava_connections;
create policy "own strava row" on public.strava_connections
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own push rows" on public.push_subscriptions;
create policy "own push rows" on public.push_subscriptions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 3) PERF: index the foreign keys the advisor flagged.
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
create index if not exists idx_workout_logs_user on public.workout_logs(user_id);
create index if not exists idx_training_plans_user on public.training_plans(user_id);
-- Legacy tables: their FK is workout_log_id (skip silently if absent).
do $$ begin
  begin
    create index if not exists idx_lift_logs_workout_log on public.lift_logs(workout_log_id);
  exception when undefined_table or undefined_column then null; end;
  begin
    create index if not exists idx_run_logs_workout_log on public.run_logs(workout_log_id);
  exception when undefined_table or undefined_column then null; end;
end $$;

-- 4) NOT SQL — do these two in the dashboard:
--    • Authentication → Attack Protection → enable "Leaked password protection".
--    • Authentication → Attack Protection → review rate limits while you're there.
