import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiInsight, AiMessage, AiThread, Category, Expense, Trip, TripBudget, TripLeg,
} from "../types";
import type {
  BudgetInsert, CaptureLogInsert, ExpenseInsert, InsightInsert, LegInsert, Repo, TripInsert,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

function mapTrip(row: any): Trip {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    baseCurrency: row.base_currency,
    timezone: row.timezone,
    status: row.status,
    coverEmoji: row.cover_emoji,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapBudget(row: any): TripBudget {
  return {
    id: row.id,
    tripId: row.trip_id,
    currency: row.currency,
    amount: Number(row.amount),
    label: row.label ?? "",
    isPrimary: Boolean(row.is_primary),
  };
}

function mapThread(row: any): AiThread {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function mapMessage(row: any): AiMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content ?? "",
    createdAt: row.created_at,
  };
}

function mapLeg(row: any): TripLeg {
  return {
    id: row.id,
    tripId: row.trip_id,
    seq: row.seq ?? 0,
    name: row.name,
    countryCode: row.country_code,
    currency: row.currency,
    timezone: row.timezone,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function mapCategory(row: any): Category {
  return {
    id: row.id,
    userId: row.user_id,
    key: row.key,
    name: row.name,
    emoji: row.emoji,
    color: row.color,
    kind: row.kind,
    sortOrder: row.sort_order,
    isSystem: Boolean(row.is_system),
  };
}

function mapExpense(row: any): Expense {
  return {
    id: row.id,
    userId: row.user_id,
    tripId: row.trip_id,
    categoryId: row.category_id,
    categoryKey: row.category_key,
    amount: Number(row.amount),
    currency: row.currency,
    baseAmount: Number(row.base_amount),
    baseCurrency: row.base_currency,
    fxRate: Number(row.fx_rate),
    fxSource: row.fx_source,
    merchant: row.merchant,
    note: row.note,
    spentAt: row.spent_at,
    spentOn: row.spent_on,
    paymentMethod: row.payment_method,
    source: row.source,
    rawInput: row.raw_input,
    aiConfidence: row.ai_confidence === null ? null : Number(row.ai_confidence),
    aiModel: row.ai_model,
    tags: row.tags ?? [],
    createdAt: row.created_at,
  };
}

function mapInsight(row: any): AiInsight {
  return {
    id: row.id,
    tripId: row.trip_id,
    kind: row.kind,
    forDate: row.for_date,
    headline: row.headline,
    body: row.body,
    severity: row.severity,
    metrics: row.metrics ?? {},
    model: row.model,
    createdAt: row.created_at,
  };
}

/** 生产仓储：所有查询都跑在 RLS 之下，user_id 由数据库策略再次校验。 */
export class SupabaseRepo implements Repo {
  readonly kind = "supabase" as const;
  private categoryCache: Category[] | null = null;

  constructor(
    private readonly client: Client,
    private readonly userId: string,
  ) {}

  private get table() {
    return this.client;
  }

  private async categoryIdFor(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    const categories = await this.listCategories();
    return categories.find((c) => c.key === key)?.id ?? null;
  }

  async listTrips(): Promise<Trip[]> {
    const { data, error } = await this.table
      .from("trips")
      .select("*")
      .order("start_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapTrip);
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const { data, error } = await this.table.from("trips").select("*").eq("id", tripId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapTrip(data) : null;
  }

  async createTrip(input: TripInsert, budgets: BudgetInsert[], legs: LegInsert[] = []) {
    const { data, error } = await this.table
      .from("trips")
      .insert({
        user_id: this.userId,
        name: input.name,
        destination: input.destination,
        start_date: input.startDate,
        end_date: input.endDate,
        base_currency: input.baseCurrency,
        timezone: input.timezone,
        cover_emoji: input.coverEmoji,
        notes: input.notes,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const trip = mapTrip(data);
    const rows = await this.replaceBudgets(trip.id, budgets);
    const legRows = await this.replaceLegs(trip.id, legs);
    return { trip, budgets: rows, legs: legRows };
  }

  async updateTrip(tripId: string, patch: Partial<TripInsert>): Promise<Trip> {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.destination !== undefined) payload.destination = patch.destination;
    if (patch.startDate !== undefined) payload.start_date = patch.startDate;
    if (patch.endDate !== undefined) payload.end_date = patch.endDate;
    if (patch.baseCurrency !== undefined) payload.base_currency = patch.baseCurrency;
    if (patch.timezone !== undefined) payload.timezone = patch.timezone;
    if (patch.coverEmoji !== undefined) payload.cover_emoji = patch.coverEmoji;
    if (patch.notes !== undefined) payload.notes = patch.notes;

    const { data, error } = await this.table
      .from("trips")
      .update(payload)
      .eq("id", tripId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapTrip(data);
  }

  async deleteTrip(tripId: string): Promise<void> {
    const { error } = await this.table.from("trips").delete().eq("id", tripId);
    if (error) throw new Error(error.message);
  }

  async listBudgets(tripId: string): Promise<TripBudget[]> {
    const { data, error } = await this.table
      .from("trip_budgets")
      .select("*")
      .eq("trip_id", tripId)
      .order("is_primary", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapBudget);
  }

  async replaceBudgets(tripId: string, budgets: BudgetInsert[]): Promise<TripBudget[]> {
    const del = await this.table.from("trip_budgets").delete().eq("trip_id", tripId);
    if (del.error) throw new Error(del.error.message);
    if (budgets.length === 0) return [];
    const { data, error } = await this.table
      .from("trip_budgets")
      .insert(
        budgets.map((b) => ({
          user_id: this.userId,
          trip_id: tripId,
          currency: b.currency,
          amount: b.amount,
          label: b.label,
          is_primary: b.isPrimary,
        })),
      )
      .select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapBudget);
  }

  async listLegs(tripId: string): Promise<TripLeg[]> {
    const { data, error } = await this.table
      .from("trip_legs")
      .select("*")
      .eq("trip_id", tripId)
      .order("start_date");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapLeg);
  }

  async replaceLegs(tripId: string, legs: LegInsert[]): Promise<TripLeg[]> {
    const del = await this.table.from("trip_legs").delete().eq("trip_id", tripId);
    if (del.error) throw new Error(del.error.message);
    if (legs.length === 0) return [];
    const { data, error } = await this.table
      .from("trip_legs")
      .insert(
        legs.map((leg, index) => ({
          user_id: this.userId,
          trip_id: tripId,
          seq: index,
          name: leg.name,
          country_code: leg.countryCode,
          currency: leg.currency,
          timezone: leg.timezone,
          start_date: leg.startDate,
          end_date: leg.endDate,
        })),
      )
      .select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapLeg);
  }

  async listCategories(): Promise<Category[]> {
    if (this.categoryCache) return this.categoryCache;
    const { data, error } = await this.table.from("categories").select("*").order("sort_order");
    if (error) throw new Error(error.message);
    this.categoryCache = (data ?? []).map(mapCategory);
    return this.categoryCache;
  }

  async listExpenses(
    tripId: string,
    options: { limit?: number; from?: string; to?: string } = {},
  ): Promise<Expense[]> {
    let query = this.table
      .from("expenses")
      .select("*")
      .eq("trip_id", tripId)
      .order("spent_on", { ascending: false })
      .order("spent_at", { ascending: false });
    if (options.from) query = query.gte("spent_on", options.from);
    if (options.to) query = query.lte("spent_on", options.to);
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapExpense);
  }

  async getExpense(id: string): Promise<Expense | null> {
    const { data, error } = await this.table.from("expenses").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapExpense(data) : null;
  }

  async createExpenses(rows: ExpenseInsert[]): Promise<Expense[]> {
    if (rows.length === 0) return [];
    const categoryIds = new Map<string, string | null>();
    for (const row of rows) {
      if (row.categoryKey && !categoryIds.has(row.categoryKey)) {
        categoryIds.set(row.categoryKey, await this.categoryIdFor(row.categoryKey));
      }
    }
    const { data, error } = await this.table
      .from("expenses")
      .insert(
        rows.map((row) => ({
          user_id: this.userId,
          trip_id: row.tripId,
          category_id: row.categoryId ?? (row.categoryKey ? categoryIds.get(row.categoryKey) : null),
          category_key: row.categoryKey,
          amount: row.amount,
          currency: row.currency,
          base_amount: row.baseAmount,
          base_currency: row.baseCurrency,
          fx_rate: row.fxRate,
          fx_source: row.fxSource,
          merchant: row.merchant,
          note: row.note,
          spent_at: row.spentAt,
          spent_on: row.spentOn,
          payment_method: row.paymentMethod,
          source: row.source,
          raw_input: row.rawInput,
          ai_confidence: row.aiConfidence,
          ai_model: row.aiModel,
          tags: row.tags,
        })),
      )
      .select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapExpense);
  }

  async updateExpense(id: string, patch: Partial<ExpenseInsert>): Promise<Expense> {
    const payload: Record<string, unknown> = {};
    const assign = (key: keyof ExpenseInsert, column: string) => {
      if (patch[key] !== undefined) payload[column] = patch[key];
    };
    assign("amount", "amount");
    assign("currency", "currency");
    assign("baseAmount", "base_amount");
    assign("baseCurrency", "base_currency");
    assign("fxRate", "fx_rate");
    assign("fxSource", "fx_source");
    assign("merchant", "merchant");
    assign("note", "note");
    assign("spentAt", "spent_at");
    assign("spentOn", "spent_on");
    assign("paymentMethod", "payment_method");
    assign("categoryKey", "category_key");
    assign("tags", "tags");
    if (patch.categoryKey !== undefined) {
      payload.category_id = await this.categoryIdFor(patch.categoryKey);
    }

    const { data, error } = await this.table
      .from("expenses")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapExpense(data);
  }

  async deleteExpense(id: string): Promise<void> {
    const { error } = await this.table.from("expenses").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async listInsights(tripId: string, limit = 10): Promise<AiInsight[]> {
    const { data, error } = await this.table
      .from("ai_insights")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapInsight);
  }

  async saveInsight(input: InsightInsert): Promise<AiInsight> {
    const { data, error } = await this.table
      .from("ai_insights")
      .insert({
        user_id: this.userId,
        trip_id: input.tripId,
        kind: input.kind,
        for_date: input.forDate,
        headline: input.headline,
        body: input.body,
        severity: input.severity,
        metrics: input.metrics,
        model: input.model,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapInsight(data);
  }

  async listThreads(tripId: string, limit = 20): Promise<AiThread[]> {
    const { data, error } = await this.table
      .from("ai_threads")
      .select("*")
      .eq("trip_id", tripId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapThread);
  }

  async getThread(threadId: string): Promise<AiThread | null> {
    const { data, error } = await this.table
      .from("ai_threads")
      .select("*")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapThread(data) : null;
  }

  async createThread(tripId: string, title: string): Promise<AiThread> {
    const { data, error } = await this.table
      .from("ai_threads")
      .insert({ user_id: this.userId, trip_id: tripId, title })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapThread(data);
  }

  async listMessages(threadId: string, limit = 50): Promise<AiMessage[]> {
    const { data, error } = await this.table
      .from("ai_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapMessage).reverse();
  }

  async appendMessage(input: {
    threadId: string;
    role: AiMessage["role"];
    content: string;
  }): Promise<AiMessage> {
    const { data, error } = await this.table
      .from("ai_messages")
      .insert({
        user_id: this.userId,
        thread_id: input.threadId,
        role: input.role,
        content: input.content,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await this.table
      .from("ai_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", input.threadId);
    return mapMessage(data);
  }

  async logCapture(input: CaptureLogInsert): Promise<string> {
    const { data, error } = await this.table
      .from("capture_logs")
      .insert({
        user_id: this.userId,
        trip_id: input.tripId,
        transcript: input.transcript,
        parsed: input.parsed,
        status: input.status,
        error: input.error,
        latency_ms: input.latencyMs,
        model: input.model,
      })
      .select("id")
      .single();
    if (error) {
      // 日志写失败不应该让用户记不了账
      console.error("[logCapture]", error.message);
      return "";
    }
    return String(data.id);
  }

  async updateCaptureStatus(
    id: string,
    status: CaptureLogInsert["status"],
    error?: string | null,
  ): Promise<void> {
    if (!id) return;
    const patch: Record<string, unknown> = { status };
    if (error !== undefined) patch.error = error;
    const { error: updateError } = await this.table.from("capture_logs").update(patch).eq("id", id);
    if (updateError) console.error("[updateCaptureStatus]", updateError.message);
  }
}
