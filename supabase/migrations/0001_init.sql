-- ===========================================================================
-- Money Planner · 0001_init
-- 多币种旅行记账 + AI 预算分析
-- 设计要点：
--   1) 每笔消费同时保存「原币金额」与「折算基准币金额 + 当时汇率」，
--      汇率历史被冻结，日后汇率波动不会篡改历史账本。
--   2) 所有业务表都带 user_id，RLS 策略可下推为单列比较，避免子查询。
--   3) spent_on 是「旅行当地日期」，用于按天分组，与 timestamptz 分离。
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------- 枚举 ----------
do $$ begin
  create type public.trip_status as enum ('planning', 'active', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.expense_source as enum ('voice', 'manual', 'receipt', 'import', 'recurring');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.insight_severity as enum ('info', 'warn', 'critical');
exception when duplicate_object then null; end $$;

-- ---------- 通用 updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  avatar_url     text,
  base_currency  text not null default 'CNY',
  locale         text not null default 'zh-CN',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- trips ----------
create table if not exists public.trips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  destination    text,
  start_date     date not null,
  end_date       date not null,
  base_currency  text not null default 'CNY',
  timezone       text not null default 'Asia/Shanghai',
  status         public.trip_status not null default 'active',
  cover_emoji    text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint trips_date_range check (end_date >= start_date)
);
create index if not exists trips_user_idx on public.trips (user_id, start_date desc);

-- ---------- trip_budgets：多币种预算组合，例如 1000 GBP + 10000 CNY ----------
create table if not exists public.trip_budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  currency    text not null,
  amount      numeric(16, 2) not null check (amount >= 0),
  label       text not null default '',      -- 例如「英镑现金」「招行卡」
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists trip_budgets_trip_idx on public.trip_budgets (trip_id);
create unique index if not exists trip_budgets_unique_idx
  on public.trip_budgets (trip_id, currency, label);

-- ---------- categories ----------
-- user_id 为 null 表示系统内置分类；用户可自建同名分类覆盖
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  key         text not null,
  name        text not null,
  emoji       text not null default '💸',
  color       text not null default '#64748b',
  kind        text not null default 'expense' check (kind in ('expense', 'income')),
  sort_order  int not null default 100,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists categories_system_key_idx
  on public.categories (key) where user_id is null;
create unique index if not exists categories_user_key_idx
  on public.categories (user_id, key) where user_id is not null;

-- ---------- expenses ----------
create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  trip_id        uuid not null references public.trips(id) on delete cascade,
  category_id    uuid references public.categories(id) on delete set null,
  category_key   text,                              -- 冗余，便于聚合与兜底
  amount         numeric(16, 2) not null check (amount > 0),   -- 原币
  currency       text not null,                     -- ISO-4217
  base_amount    numeric(16, 2) not null,           -- 折算基准币
  base_currency  text not null,
  fx_rate        numeric(20, 8) not null default 1, -- 1 原币 = fx_rate 基准币
  fx_source      text,                              -- ecb | er-api | manual | fixed | same
  merchant       text,
  note           text,
  spent_at       timestamptz not null default now(),
  spent_on       date not null,                     -- 旅行当地日期，按天分组用
  payment_method text,                              -- cash | card | alipay | wechat | other
  source         public.expense_source not null default 'manual',
  raw_input      text,                              -- 原始语音转写 / 文本
  ai_confidence  numeric(4, 3),
  ai_model       text,
  tags           text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists expenses_trip_spent_idx on public.expenses (trip_id, spent_on desc, spent_at desc);
create index if not exists expenses_user_idx on public.expenses (user_id, spent_at desc);
create index if not exists expenses_category_idx on public.expenses (trip_id, category_key);

-- ---------- fx_rates：汇率缓存（按日） ----------
-- 说明：应用当前使用「进程内缓存 → ECB → 备用源 → 离线兜底」的解析链，
-- 本表预留给定时任务写入，作为跨实例共享的汇率快照与历史审计依据。
-- 写入需要 service_role（RLS 只开放了 SELECT）。
create table if not exists public.fx_rates (
  base       text not null,
  quote      text not null,
  rate       numeric(20, 8) not null check (rate > 0),
  as_of      date not null,
  source     text not null default 'ecb',
  fetched_at timestamptz not null default now(),
  primary key (base, quote, as_of)
);

-- ---------- ai_insights ----------
create table if not exists public.ai_insights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  trip_id    uuid not null references public.trips(id) on delete cascade,
  kind       text not null default 'budget_check',   -- budget_check | daily_digest | anomaly
  for_date   date,
  headline   text not null,
  body       text,
  severity   public.insight_severity not null default 'info',
  metrics    jsonb not null default '{}'::jsonb,
  model      text,
  created_at timestamptz not null default now()
);
create index if not exists ai_insights_trip_idx on public.ai_insights (trip_id, created_at desc);

-- ---------- capture_logs：语音捕获审计，便于重试与调参 ----------
create table if not exists public.capture_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  trip_id     uuid references public.trips(id) on delete set null,
  transcript  text,
  parsed      jsonb,
  status      text not null default 'pending',       -- pending | confirmed | discarded | failed
  error       text,
  latency_ms  int,
  model       text,
  created_at  timestamptz not null default now()
);

-- ---------- updated_at 触发器 ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','trips','trip_budgets','expenses'] loop
    execute format('drop trigger if exists trg_%1$s_touch on public.%1$s', t);
    execute format('create trigger trg_%1$s_touch before update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- 新用户自动建档 ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.profiles     enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_budgets enable row level security;
alter table public.categories   enable row level security;
alter table public.expenses     enable row level security;
alter table public.fx_rates     enable row level security;
alter table public.ai_insights  enable row level security;
alter table public.capture_logs enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists trips_own on public.trips;
create policy trips_own on public.trips
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists trip_budgets_own on public.trip_budgets;
create policy trip_budgets_own on public.trip_budgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists expenses_own on public.expenses;
create policy expenses_own on public.expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ai_insights_own on public.ai_insights;
create policy ai_insights_own on public.ai_insights
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists capture_logs_own on public.capture_logs;
create policy capture_logs_own on public.capture_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 分类：所有人可读系统分类，只能写自己的
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories
  for select using (user_id is null or user_id = auth.uid());

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 汇率是公共只读数据，由服务端 service_role 写入
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates for select using (true);
