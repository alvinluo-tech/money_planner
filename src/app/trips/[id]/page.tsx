import Link from "next/link";
import nextDynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/db";
import { formatMoney, formatPercent } from "@/lib/money";
import { loadTripContext, tripToday } from "@/lib/services/trip";
import { paceLabel } from "@/lib/services/insights";
import { cx, dayLabel, HEALTH_META, LEG_STATUS_META, timeLabel } from "@/lib/ui/format";
import { CategoryBars, ChartSkeleton } from "@/components/charts";

const DailyTrend = nextDynamic(
  () => import("@/components/charts").then((mod) => mod.DailyTrend),
  {
    loading: () => <ChartSkeleton />,
  },
);

export const dynamic = "force-dynamic";

export default async function TripDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const [ctx, insights] = await Promise.all([
    loadTripContext(session.repo, id),
    session.repo.listInsights(id, 1),
  ]);
  if (!ctx) notFound();

  const { trip, summary, categories } = ctx;
  // 「今天」按当前所在分段（多国）或行程时区算，与语音记账的口径保持一致
  const today = tripToday(trip, ctx.legs);
  const meta = HEALTH_META[summary.health];
  const catMeta = new Map(categories.map((c) => [c.key, c]));
  const latest = insights[0];

  const progress = Math.min(100, summary.utilization * 100);
  const over = summary.remaining < 0;
  const recent = ctx.expenses.slice(0, 6);

  return (
    <div className="space-y-4">
      {/* ---------- 主卡片 ---------- */}
      <section className="card overflow-hidden">
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-ink-muted">
              {over ? "已超支" : "还可以花"}
            </span>
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-medium", meta.bg, meta.text)}>
              {meta.label} · {paceLabel(summary)}
            </span>
          </div>
          <p className="tnum mt-1.5 text-4xl font-semibold tracking-tight">
            {formatMoney(Math.abs(summary.remaining), summary.baseCurrency)}
          </p>
          <p className="mt-1.5 text-sm text-ink-muted">
            预算 {formatMoney(summary.totalBudget, summary.baseCurrency)} · 已花{" "}
            {formatMoney(summary.spent, summary.baseCurrency)}（{formatPercent(summary.utilization, 1)}）
          </p>

          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-line/70">
            <div
              className={cx("h-full rounded-full transition-all", over ? "bg-rose-500" : meta.bar)}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-ink-muted">
            <span>
              第 {summary.daysElapsed} / {summary.daysTotal} 天
            </span>
            <span>剩 {summary.daysRemaining} 天</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 divide-x divide-line border-t border-line">
          <Stat label="今日支出" value={formatMoney(summary.todaySpent, summary.baseCurrency)} sub={`昨日 ${formatMoney(summary.yesterdaySpent, summary.baseCurrency)}`} />
          <Stat
            label="健康日均"
            value={formatMoney(summary.allowedDaily, summary.baseCurrency)}
            sub={`实际 ${formatMoney(summary.actualDaily, summary.baseCurrency)}`}
          />
          <Stat
            label="预计总支出"
            value={formatMoney(summary.projectedTotal, summary.baseCurrency)}
            sub={summary.projectedOverrun > 0 ? `超 ${formatMoney(summary.projectedOverrun, summary.baseCurrency)}` : "在预算内"}
            tone={summary.projectedOverrun > 0 ? "risk" : "good"}
          />
        </div>
      </section>

      {/* ---------- 提醒 ---------- */}
      {summary.alerts.length > 0 && (
        <section className="space-y-2">
          {summary.alerts.map((alert, i) => {
            const tone =
              alert.level === "critical"
                ? "border-rose-200 bg-rose-50"
                : alert.level === "warn"
                  ? "border-amber-200 bg-amber-50"
                  : "border-line bg-surface";
            const dot =
              alert.level === "critical" ? "bg-rose-500" : alert.level === "warn" ? "bg-amber-500" : "bg-sky-500";
            return (
              <div key={`${i}-${alert.title}`} className={cx("rounded-2xl border px-4 py-3", tone)}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className={cx("h-1.5 w-1.5 rounded-full", dot)} />
                  {alert.title}
                </p>
                <p className="mt-1 pl-3.5 text-xs leading-relaxed text-ink-soft">{alert.detail}</p>
              </div>
            );
          })}
        </section>
      )}

      {/* ---------- AI 结论 ---------- */}
      <section className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title">AI 结论</h2>
            {latest ? (
              <>
                <p className="mt-2 text-base font-semibold">{latest.headline}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{latest.body}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">还没有分析结果，点右边生成一份。</p>
            )}
          </div>
          <Link href={`/trips/${id}/insights`} className="btn-ghost shrink-0 px-3 py-2 text-xs">
            {latest ? "查看" : "生成"}
          </Link>
        </div>
        {latest && (
          <p className="mt-3 text-xs text-ink-muted">
            {new Date(latest.createdAt).toLocaleString("zh-CN", { hour12: false })} ·{" "}
            {latest.model ?? "本地规则"}
          </p>
        )}
      </section>

      {/* ---------- 趋势 ---------- */}
      <section className="card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="section-title">支出节奏</h2>
          <span className="text-xs text-ink-muted">实线=实际累计 · 虚线=计划额度</span>
        </div>
        <DailyTrend days={summary.byDay} baseCurrency={summary.baseCurrency} today={today} />
      </section>

      {/* ---------- 分类 ---------- */}
      <section className="card p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="section-title">消费结构</h2>
          <span className="text-xs text-ink-muted">竖线为参考占比</span>
        </div>
        <CategoryBars
          baseCurrency={summary.baseCurrency}
          items={summary.byCategory.map((c) => ({ ...c, key: c.categoryKey }))}
        />
      </section>

      {/* ---------- 分段进度（多国）---------- */}
      {summary.byLeg.length > 0 && (
        <section className="card p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="section-title">分段进度</h2>
            <span className="text-xs text-ink-muted">参考额度按天数占比</span>
          </div>
          <ul className="space-y-4">
            {summary.byLeg.map((leg) => {
              const meta = LEG_STATUS_META[leg.status];
              return (
                <li key={leg.legId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      {leg.isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                      <span className="truncate">{leg.name}</span>
                      <span className="shrink-0 rounded-full bg-line/70 px-1.5 py-0.5 text-[11px] font-normal text-ink-muted">
                        {leg.currency}
                      </span>
                      {leg.isActive && (
                        <span className="shrink-0 text-[11px] font-normal text-brand">当前</span>
                      )}
                    </span>
                    <span className="tnum shrink-0 text-xs text-ink-muted">
                      {formatMoney(leg.spent, summary.baseCurrency)} /{" "}
                      {formatMoney(leg.referenceAllowance, summary.baseCurrency)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-line/70">
                    <div
                      className={cx("h-full rounded-full", meta.bar)}
                      style={{ width: `${Math.min(100, leg.utilization * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {leg.startDate.slice(5).replace("-", "/")}–{leg.endDate.slice(5).replace("-", "/")} ·{" "}
                    {leg.days} 天 · {leg.count} 笔 · 用了 {formatPercent(leg.utilization, 0)}
                    {leg.spentInLegCurrency > 0 && ` · 本币 ${formatMoney(leg.spentInLegCurrency, leg.currency)}`}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
            参考额度 = 全程预算 × 该段天数占比。跨国旅行里长途交通集中在移动日，
            所以它只是参照物，不是硬性上限。
          </p>
        </section>
      )}

      {/* ---------- 多币种预算 ---------- */}
      <section className="card p-5">
        <h2 className="section-title mb-4">预算构成</h2>
        <ul className="space-y-4">
          {summary.budgetByCurrency.map((b) => {
            const ratio = Math.min(100, b.consumedRatio * 100);
            return (
              <li key={`${b.currency}-${b.label}`}>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="font-medium">
                    {formatMoney(b.amount, b.currency)}
                    {b.label && <span className="ml-2 text-xs font-normal text-ink-muted">{b.label}</span>}
                  </span>
                  <span className="tnum text-xs text-ink-muted">
                    ≈ {formatMoney(b.amountBase, summary.baseCurrency)} · 已用{" "}
                    {formatPercent(b.consumedRatio, 0)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line/70">
                  <div
                    className={cx("h-full rounded-full", b.consumedRatio > 1 ? "bg-rose-500" : "bg-brand")}
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  汇率 1 {b.currency} ≈ {b.rateToBase.toFixed(4)} {summary.baseCurrency}
                  {b.rateToBase === 0 && " · 汇率缺失"}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
          多币种预算按记账当时的汇率折算成 {summary.baseCurrency} 统一汇总；历史记录不会被汇率波动改写。
        </p>
      </section>

      {/* ---------- 最近消费 ---------- */}
      <section className="card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="section-title">最近消费</h2>
          <Link href={`/trips/${id}/expenses`} className="text-xs text-brand hover:underline">
            全部 {ctx.expenses.length} 笔 →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            还没有记录，点下面的按钮说一句话试试。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((e) => {
              const c = catMeta.get(e.categoryKey ?? "other");
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className="text-base">
                      {c?.emoji ?? "💸"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {(e.merchant && !["打车", "消费", "买东西"].includes(e.merchant))
                          ? e.merchant
                          : (e.note || e.merchant || c?.name || "消费")}
                        {e.source === "voice" && (
                          <span className="ml-1.5 rounded bg-brand-soft px-1 py-0.5 text-[11px] text-brand">
                            语音
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {dayLabel(e.spentOn, today)} {timeLabel(e.spentAt)}
                        {e.note && (e.merchant ? e.note !== e.merchant : false) && ` · ${e.note}`}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tnum text-sm font-medium">{formatMoney(e.amount, e.currency)}</p>
                    {e.currency !== summary.baseCurrency && (
                      <p className="tnum text-xs text-ink-muted">
                        ≈ {formatMoney(e.baseAmount, summary.baseCurrency)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "risk";
}) {
  return (
    <div className="min-w-0 px-2 py-3.5 text-center sm:px-3 sm:py-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p
        className={cx(
          "tnum mt-1 truncate text-sm font-semibold tracking-tight sm:text-base",
          tone === "risk" && "text-risk",
          tone === "good" && "text-good",
        )}
      >
        {value}
      </p>
      {sub && <p className="tnum mt-0.5 truncate text-[11px] text-ink-muted">{sub}</p>}
    </div>
  );
}
