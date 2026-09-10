import { NextResponse } from "next/server";
import { withMutation, withSession, jsonError, zodMessage } from "@/lib/api";
import { tripInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  return withSession(async (session) => {
    const trips = await session.repo.listTrips();
    return NextResponse.json({ ok: true, trips });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    const body = await request.json().catch(() => null);
    const parsed = tripInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const { budgets, legs, ...trip } = parsed.data;
    const result = await session.repo.createTrip(
      {
        name: trip.name,
        destination: trip.destination ?? null,
        startDate: trip.startDate,
        endDate: trip.endDate,
        baseCurrency: trip.baseCurrency,
        timezone: trip.timezone,
        coverEmoji: trip.coverEmoji ?? null,
        notes: trip.notes ?? null,
      },
      budgets.map((b, index) => ({
        currency: b.currency,
        amount: b.amount,
        label: b.label,
        isPrimary: b.isPrimary ?? index === 0,
      })),
      (legs ?? []).map((l) => ({
        name: l.name,
        countryCode: l.countryCode ?? null,
        currency: l.currency,
        timezone: l.timezone,
        startDate: l.startDate,
        endDate: l.endDate,
      })),
    );
    return NextResponse.json({ ok: true, ...result });
  });
}
