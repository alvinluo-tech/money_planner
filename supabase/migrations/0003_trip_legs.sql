-- ===========================================================================
-- Money Planner · 0003_trip_legs
-- 多国旅行的「行程分段」：每一段有自己的国家、币种、时区、日期区间。
--
-- 设计原则（很重要）：
--   legs 只用于「推断」和「分析」——推断语音里没提币种时的默认币种、
--   推断「今天/昨天」该按哪个时区算、把消费归到哪一段做分段复盘。
--   它绝不回溯改写已落库的 amount / currency / base_amount / fx_rate。
--   因此事后修改分段是安全的：账目数字不会变，只是分段视图重新归属。
--
-- 分段是可选的：不配分段时，行为与单国行程完全一致。
-- ===========================================================================

create table if not exists public.trip_legs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  trip_id      uuid not null references public.trips(id) on delete cascade,
  seq          int  not null default 0,          -- 展示顺序
  name         text not null,                     -- 城市/地区，如「伦敦」
  country_code text,                              -- ISO-3166-1 alpha-2，如 GB
  currency     text not null,                     -- 该段主要使用币种
  timezone     text not null,                     -- 该段所在时区
  start_date   date not null,
  end_date     date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trip_legs_date_range check (end_date >= start_date)
);

create index if not exists trip_legs_trip_idx on public.trip_legs (trip_id, start_date);

drop trigger if exists trg_trip_legs_touch on public.trip_legs;
create trigger trg_trip_legs_touch before update on public.trip_legs
  for each row execute function public.touch_updated_at();

alter table public.trip_legs enable row level security;

drop policy if exists trip_legs_own on public.trip_legs;
create policy trip_legs_own on public.trip_legs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
