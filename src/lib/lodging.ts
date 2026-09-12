/**
 * 住宿平摊与行程区间辅助工具。
 * 格式规范：tags 中的 "stay:YYYY-MM-DD~YYYY-MM-DD"
 */

export interface StayRange {
  startDate: string;
  endDate: string;
  nights: number;
}

/** 从 tags 数组中解析出入住起止与晚数 */
export function parseStayTag(tags: string[] = []): StayRange | null {
  for (const tag of tags) {
    const m = tag.match(/^stay:(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const startDate = m[1];
      const endDate = m[2];
      const d1 = Date.parse(`${startDate}T00:00:00Z`);
      const d2 = Date.parse(`${endDate}T00:00:00Z`);
      if (Number.isFinite(d1) && Number.isFinite(d2) && d2 > d1) {
        const nights = Math.round((d2 - d1) / 86_400_000);
        return { startDate, endDate, nights: Math.max(1, nights) };
      }
    }
  }
  return null;
}

/** 生成标准 stay 标签 */
export function formatStayTag(startDate: string, endDate: string): string {
  return `stay:${startDate}~${endDate}`;
}

/** 格式化前端展示，如 "2晚 · 455 EUR/晚" */
export function formatStayBadge(
  stay: StayRange,
  totalAmount: number,
  currency: string,
): { label: string; perNight: number } {
  const perNight = Math.round((totalAmount / stay.nights) * 100) / 100;
  return {
    label: `${stay.nights}晚 · ${perNight} ${currency}/晚`,
    perNight,
  };
}

/** 获取入住期间的所有日期（不含退房当天，例如 12~14日 返回 ["2026-09-12", "2026-09-13"]） */
export function getStayDates(stay: StayRange): string[] {
  const dates: string[] = [];
  const curr = new Date(`${stay.startDate}T00:00:00Z`);
  for (let i = 0; i < stay.nights; i++) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}
