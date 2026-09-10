import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/db";
import { aiEnabled } from "@/lib/ai/config";
import { InsightsTabs } from "@/components/insights-tabs";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { id } = await params;
  const { tab, q } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");

  const trip = await session.repo.getTrip(id);
  if (!trip) notFound();

  const [insights, threads] = await Promise.all([
    session.repo.listInsights(id, 10),
    session.repo.listThreads(id, 1),
  ]);
  const thread = threads[0] ?? null;
  const messages = thread ? await session.repo.listMessages(thread.id, 50) : [];

  return (
    <InsightsTabs
      tripId={id}
      insights={insights}
      aiEnabled={aiEnabled()}
      initialThreadId={thread?.id ?? null}
      initialMessages={messages}
      seedQuestion={q}
      initialTab={tab === "chat" || q ? "chat" : "report"}
    />
  );
}
