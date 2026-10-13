export type Scope = 'client' | 'owner';

export interface ServiceInfo {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  duration_minutes: number;
  price_cents: number;
  price_is_from: boolean;
}

export interface TenantInfo {
  id: string;
  slug: string;
  status: string;
  name: string;
  short_name: string;
  tagline: string;
  address: string;
  phone: string;
  map_url: string | null;
  timezone: string;
  currency: string;
  cancel_cutoff_hours: number;
  cancellation_policy: string;
  services: ServiceInfo[];
  working_hours: { weekday: number; opens: string; closes: string }[];
  exceptions: { day: string; closed: boolean; opens: string | null; closes: string | null; note: string }[];
}

export interface Slot {
  starts_at: string;
  local_day: string;
  local_time: string;
}

export interface OwnerBooking {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  service_name: string;
  resource_name: string;
  client_name: string;
  client_phone: string;
  car: string;
  price_cents: number;
  price_is_from: boolean;
  paid_cents: number;
  refunded_cents: number;
  is_demo: boolean;
}

export interface OwnerStats {
  from: string;
  to: string;
  label: string;
  timezone: string;
  currency: string;
  visits: number;
  completed_orders: number;
  bookings_total: number;
  cancelled: number;
  no_show: number;
  received_cents: number;
  payments_cents: number;
  refunds_cents: number;
  expected_cents: number;
}

/** Everything the assistant may read. Implemented over SQL RPCs (backend-sql.ts) or fakes in tests. */
export interface AssistantBackend {
  tenant(): Promise<TenantInfo>;
  availability(serviceId: string, day: string): Promise<(Slot & { available: boolean })[]>;
  nearest(serviceId: string, limit: number): Promise<Slot[]>;
  /** owner scope only */
  ownerBookings(fromDay: string, toDay: string): Promise<OwnerBooking[]>;
  /** owner scope only */
  ownerStats(period: string): Promise<OwnerStats>;
  /** resolves named periods in the tenant timezone, same SQL as the cabinet */
  periodDays(period: string): Promise<{ from_day: string; to_day: string; label: string }>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  source: 'model' | 'prefetch' | 'json' | 'keyword';
}

/** A bookable slot suggested to the UI (renders as a "book" button). */
export interface SlotSuggestion {
  service_id: string;
  service_name: string;
  starts_at: string;
  label: string;
}

export interface AssistantReply {
  reply: string;
  router: 'tools' | 'json' | 'keyword';
  degraded: boolean;
  tools: ToolCallRecord[];
  slots: SlotSuggestion[];
  usage: { prompt_tokens: number; completion_tokens: number };
}
