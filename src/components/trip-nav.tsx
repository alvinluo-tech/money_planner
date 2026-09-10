"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/ui/format";

const TABS = [
  { href: "", label: "概览", d: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" },
  { href: "/expenses", label: "明细", d: "M4 6h16M4 12h16M4 18h10" },
  { href: "/insights", label: "分析", d: "M4 19V5m0 14h16M8 15l3-4 3 2 4-6" },
  { href: "/settings", label: "预算", d: "M3 8h18v11H3zM3 8l2-4h14l2 4M16 13h2" },
];

/**
 * 移动端底部标签栏 + 桌面端顶部标签。
 * 底部栏中间留空，语音悬浮按钮（VoiceCapture）正好落在这个缺口上。
 */
export function TripNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const base = `/trips/${tripId}`;
  const isActive = (href: string) =>
    href === "" ? pathname === base : pathname.startsWith(`${base}${href}`);

  const renderTab = (tab: (typeof TABS)[number], variant: "top" | "bottom") => {
    const active = isActive(tab.href);
    if (variant === "top") {
      return (
        <Link
          key={tab.href}
          href={`${base}${tab.href}`}
          className={cx(
            "shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-all active:scale-95",
            active ? "bg-ink text-white" : "text-ink-soft hover:bg-line/60",
          )}
        >
          {tab.label}
        </Link>
      );
    }
    return (
      <Link
        key={tab.href}
        href={`${base}${tab.href}`}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex h-15 flex-col items-center justify-center gap-1 pt-1.5 transition-colors active:opacity-60",
          active ? "text-brand" : "text-ink-muted",
        )}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d={tab.d} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs font-medium">{tab.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* 桌面端：顶部标签 */}
      <nav className="hidden gap-1 sm:flex">{TABS.map((tab) => renderTab(tab, "top"))}</nav>

      {/* 移动端：底部标签栏（中间缺口给语音按钮） */}
      <nav className="tabbar-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-5 items-center">
          {TABS.slice(0, 2).map((tab) => renderTab(tab, "bottom"))}
          <div aria-hidden />
          {TABS.slice(2).map((tab) => renderTab(tab, "bottom"))}
        </div>
      </nav>
    </>
  );
}
