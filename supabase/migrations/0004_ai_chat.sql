-- ===========================================================================
-- Money Planner · 0004_ai_chat
-- AI 助手的会话与消息（多轮记忆）。
-- 只存 user / assistant 的文本；工具调用结果不入库（每轮都会重新查真实数据，
-- 避免把过期数字当成上下文喂回模型）。
-- ===========================================================================

create table if not exists public.ai_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  trip_id    uuid not null references public.trips(id) on delete cascade,
  title      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_threads_trip_idx on public.ai_threads (trip_id, updated_at desc);

create table if not exists public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  thread_id  uuid not null references public.ai_threads(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_thread_idx on public.ai_messages (thread_id, created_at);

drop trigger if exists trg_ai_threads_touch on public.ai_threads;
create trigger trg_ai_threads_touch before update on public.ai_threads
  for each row execute function public.touch_updated_at();

alter table public.ai_threads  enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists ai_threads_own on public.ai_threads;
create policy ai_threads_own on public.ai_threads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ai_messages_own on public.ai_messages;
create policy ai_messages_own on public.ai_messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
