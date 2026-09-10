-- ===========================================================================
-- Money Planner · 0002_seed_categories
-- 内置分类（user_id 为 null）。中文优先，同时保留英文 key 便于模型对齐。
-- ===========================================================================
insert into public.categories (user_id, key, name, emoji, color, sort_order, is_system) values
  (null, 'food',          '餐饮',     '🍜', '#f97316', 10, true),
  (null, 'grocery',       '超市杂货', '🛒', '#84cc16', 20, true),
  (null, 'transport',     '交通',     '🚇', '#3b82f6', 30, true),
  (null, 'lodging',       '住宿',     '🏨', '#8b5cf6', 40, true),
  (null, 'shopping',      '购物',     '🛍️', '#ec4899', 50, true),
  (null, 'attraction',    '门票景点', '🎟️', '#14b8a6', 60, true),
  (null, 'entertainment', '娱乐',     '🎬', '#f59e0b', 70, true),
  (null, 'health',        '医疗健康', '💊', '#ef4444', 80, true),
  (null, 'communication', '通讯网络', '📶', '#06b6d4', 90, true),
  (null, 'fee',           '手续费/税', '🧾', '#64748b', 100, true),
  (null, 'gift',          '礼物伴手', '🎁', '#a855f7', 110, true),
  (null, 'other',         '其他',     '💸', '#94a3b8', 999, true)
on conflict do nothing;
