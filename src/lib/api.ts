// Typed access to the database RPCs. Every call goes through PostgREST with the anon key
// (clients) or the owner's session (cabinet). Errors become ApiError with a stable code and Russian text.
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const FALLBACK: Record<string, string> = {
  network: 'Нет соединения с сервером. Проверьте интернет и повторите.',
  forbidden: 'Нет доступа',
  not_authenticated: 'Войдите в кабинет',
  rate_limited: 'Слишком много запросов. Попробуйте через минуту.',
};

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const pg = e as Partial<PostgrestError> & { status?: number };
  if (pg?.code === 'P0001' && pg.message) return new ApiError(pg.message, pg.details || FALLBACK[pg.message] || pg.message);
  if (pg?.code === '42501' || pg?.code === 'PGRST301') return new ApiError('forbidden', FALLBACK.forbidden!);
  const msg = String(pg?.message ?? e ?? '');
  if (/fetch|network|load failed|NetworkError/i.test(msg)) return new ApiError('network', FALLBACK.network!);
  return new ApiError('unknown', 'Что-то пошло не так. Повторите попытку.');
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    throw toApiError(e);
  }
  if (res.error) throw toApiError(res.error);
  return res.data as T;
}

// ------------------------------------------------------------------ types

export interface Service {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  duration_minutes: number;
  price_cents: number;
  price_is_from: boolean;
  image_path: string | null;
}

export interface InfoCard {
  position: number;
  icon: string;
  title: string;
  body: string;
}

export interface GalleryItem {
  id: string;
  image_path: string;
  caption: string;
}

export interface WorkingHours {
  weekday: number;
  opens: string;
  closes: string;
}

export interface ScheduleException {
  id?: number;
  day: string;
  closed: boolean;
  opens: string | null;
  closes: string | null;
  note: string;
}

export interface TenantPublic {
  id: string;
  slug: string;
  status: 'preview' | 'live' | 'suspended';
  name: string;
  short_name: string;
  tagline: string;
  description: string;
  address: string;
  map_url: string | null;
  phone: string;
  messenger_url: string | null;
  timezone: string;
  currency: string;
  locale: string;
  accent_color: string;
  logo_path: string | null;
  hero_path: string | null;
  slot_step_minutes: number;
  max_days_ahead: number;
  cancel_cutoff_hours: number;
  cancellation_policy: string;
  today: string;
  resources_count: number;
  services: Service[];
  info_cards: InfoCard[];
  gallery: GalleryItem[];
  working_hours: WorkingHours[];
  exceptions: ScheduleException[];
}

export interface Slot {
  starts_at: string;
  local_day: string;
  local_time: string;
  available: boolean;
}

export interface BookingPublic {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price_cents: number;
  price_is_from: boolean;
  client_name: string;
  client_phone: string;
  car: string;
  comment: string;
  is_demo: boolean;
  resource_name: string;
  cancelled_at: string | null;
  can_cancel: boolean;
  cancel_deadline: string;
  tenant: {
    slug: string;
    name: string;
    address: string;
    phone: string;
    map_url: string | null;
    timezone: string;
    currency: string;
    cancel_cutoff_hours: number;
    cancellation_policy: string;
    status: string;
  };
}

export type BookingStatus = 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';

export interface CreateBookingInput {
  slug: string;
  serviceId: string;
  startsAt: string;
  clientName: string;
  clientPhone: string;
  car: string;
  comment: string;
  idempotencyKey: string;
}

export interface CreateBookingResult {
  booking: BookingPublic;
  token: string;
  replayed: boolean;
}

// ------------------------------------------------------------------ public API

export const api = {
  tenant: (slug: string) => rpc<TenantPublic>('get_tenant_public', { p_slug: slug }),
  availability: (slug: string, serviceId: string, from: string, to: string) =>
    rpc<Slot[]>('get_availability', { p_slug: slug, p_service_id: serviceId, p_from: from, p_to: to }),
  nearest: (slug: string, serviceId: string, limit = 5) =>
    rpc<Omit<Slot, 'available'>[]>('get_nearest_slots', { p_slug: slug, p_service_id: serviceId, p_limit: limit }),
  createBooking: (i: CreateBookingInput) =>
    rpc<CreateBookingResult>('create_booking', {
      p_slug: i.slug,
      p_service_id: i.serviceId,
      p_starts_at: i.startsAt,
      p_client_name: i.clientName,
      p_client_phone: i.clientPhone,
      p_car: i.car,
      p_comment: i.comment,
      p_idempotency_key: i.idempotencyKey,
    }),
  booking: (id: string, token: string) => rpc<BookingPublic>('get_booking', { p_booking_id: id, p_token: token }),
  cancelBooking: (id: string, token: string, reason?: string) =>
    rpc<BookingPublic>('cancel_my_booking', { p_booking_id: id, p_token: token, p_reason: reason ?? null }),
  saveBookingPush: (id: string, token: string, sub: PushSubscriptionJSON) =>
    rpc<{ saved: boolean; delivers: boolean; reminder_at: string | null }>('save_booking_push', {
      p_booking_id: id,
      p_token: token,
      p_endpoint: sub.endpoint,
      p_p256dh: sub.keys?.p256dh,
      p_auth: sub.keys?.auth,
    }),
};

// ------------------------------------------------------------------ owner API

export interface OwnerBooking {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  occupied_until: string;
  service_id: string;
  service_name: string;
  resource_id: string;
  resource_name: string;
  price_cents: number;
  price_is_from: boolean;
  client_name: string;
  client_phone: string;
  car: string;
  comment: string;
  source: 'client' | 'owner';
  is_demo: boolean;
  created_at: string;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: 'client' | 'owner' | null;
  cancel_reason: string | null;
  paid_cents: number;
  refunded_cents: number;
}

export interface Resource {
  id: string;
  key: string;
  name: string;
  active: boolean;
  sort: number;
  source: string;
}

export interface OwnerService extends Service {
  active: boolean;
  buffer_minutes: number;
  sort: number;
  source: string;
  resource_ids: string[];
}

export interface ResourceBlock {
  id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
}

export interface OwnerSettings {
  tenant: TenantPublic & {
    min_lead_minutes: number;
    config_version: number;
    published_at: string | null;
    activated_at: string | null;
  };
  today: string;
  resources: Resource[];
  services: OwnerService[];
  working_hours: WorkingHours[];
  exceptions: ScheduleException[];
  info_cards: (InfoCard & { source: string })[];
  gallery: (GalleryItem & { source: string; sort: number })[];
  blocks: ResourceBlock[];
}

export interface Payment {
  id: string;
  kind: 'payment' | 'refund';
  amount_cents: number;
  method: 'cash' | 'card' | 'transfer';
  note: string;
  created_at: string;
}

export interface Stats {
  from: string;
  to: string;
  label: string;
  period: string | null;
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
  by_day: { day: string; visits: number; received_cents: number }[];
}

export type StatsPeriod = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_30_days';

export const ownerApi = {
  me: () => rpc<{ slug: string; name: string; role: string; status: string }[]>('owner_me', {}),
  settings: (slug: string) => rpc<OwnerSettings>('owner_settings', { p_slug: slug }),
  bookings: (slug: string, from: string, to: string) => rpc<OwnerBooking[]>('owner_bookings', { p_slug: slug, p_from: from, p_to: to }),
  payments: (slug: string, bookingId: string) => rpc<Payment[]>('owner_booking_payments', { p_slug: slug, p_booking_id: bookingId }),
  stats: (slug: string, period: StatsPeriod) => rpc<Stats>('owner_stats', { p_slug: slug, p_period: period }),
  createBooking: (slug: string, i: Omit<CreateBookingInput, 'slug'> & { resourceId: string | null; allowOffGrid: boolean }) =>
    rpc<{ booking: BookingPublic }>('owner_create_booking', {
      p_slug: slug,
      p_service_id: i.serviceId,
      p_starts_at: i.startsAt,
      p_client_name: i.clientName,
      p_client_phone: i.clientPhone,
      p_car: i.car,
      p_comment: i.comment,
      p_resource_id: i.resourceId,
      p_idempotency_key: i.idempotencyKey,
      p_allow_off_grid: i.allowOffGrid,
    }),
  reschedule: (slug: string, bookingId: string, startsAt: string, resourceId: string | null, allowOffGrid: boolean) =>
    rpc<BookingPublic>('owner_reschedule_booking', {
      p_slug: slug,
      p_booking_id: bookingId,
      p_new_start: startsAt,
      p_resource_id: resourceId,
      p_allow_off_grid: allowOffGrid,
    }),
  cancel: (slug: string, bookingId: string, reason: string) =>
    rpc<BookingPublic>('owner_cancel_booking', { p_slug: slug, p_booking_id: bookingId, p_reason: reason }),
  setStatus: (slug: string, bookingId: string, status: BookingStatus) =>
    rpc<BookingPublic>('owner_set_booking_status', { p_slug: slug, p_booking_id: bookingId, p_status: status }),
  addPayment: (slug: string, bookingId: string, kind: 'payment' | 'refund', amountCents: number, method: string, note: string, key: string) =>
    rpc<Payment>('owner_add_payment', {
      p_slug: slug,
      p_booking_id: bookingId,
      p_kind: kind,
      p_amount_cents: amountCents,
      p_method: method,
      p_note: note,
      p_idempotency_key: key,
    }),
  blockResource: (slug: string, resourceId: string, from: string, to: string, reason: string) =>
    rpc<ResourceBlock>('owner_block_resource', { p_slug: slug, p_resource_id: resourceId, p_starts_at: from, p_ends_at: to, p_reason: reason }),
  removeBlock: (slug: string, blockId: string) => rpc<{ ok: true }>('owner_remove_block', { p_slug: slug, p_block_id: blockId }),
  updateTenant: (slug: string, patch: Record<string, unknown>) => rpc<unknown>('owner_update_tenant', { p_slug: slug, p_patch: patch }),
  setHours: (slug: string, hours: WorkingHours[]) => rpc<unknown>('owner_set_working_hours', { p_slug: slug, p_hours: hours }),
  upsertException: (slug: string, e: { day: string; closed: boolean; opens: string | null; closes: string | null; note: string }) =>
    rpc<unknown>('owner_upsert_exception', { p_slug: slug, p_day: e.day, p_closed: e.closed, p_opens: e.opens, p_closes: e.closes, p_note: e.note }),
  deleteException: (slug: string, day: string) => rpc<unknown>('owner_delete_exception', { p_slug: slug, p_day: day }),
  upsertResource: (slug: string, id: string | null, name: string, active: boolean) =>
    rpc<Resource>('owner_upsert_resource', { p_slug: slug, p_resource_id: id, p_name: name, p_active: active }),
  upsertService: (slug: string, id: string | null, fields: Record<string, unknown>, resourceIds: string[] | null) =>
    rpc<OwnerService>('owner_upsert_service', { p_slug: slug, p_service_id: id, p_fields: fields, p_resource_ids: resourceIds }),
  updateInfoCard: (slug: string, position: number, icon: string, title: string, body: string) =>
    rpc<unknown>('owner_update_info_card', { p_slug: slug, p_position: position, p_icon: icon, p_title: title, p_body: body }),
  addGalleryItem: (slug: string, imagePath: string, caption: string) =>
    rpc<GalleryItem>('owner_add_gallery_item', { p_slug: slug, p_image_path: imagePath, p_caption: caption }),
  updateGalleryItem: (slug: string, id: string, imagePath: string | null, caption: string | null) =>
    rpc<GalleryItem>('owner_update_gallery_item', { p_slug: slug, p_item_id: id, p_image_path: imagePath, p_caption: caption }),
  removeGalleryItem: (slug: string, id: string) => rpc<unknown>('owner_remove_gallery_item', { p_slug: slug, p_item_id: id }),
  savePush: (slug: string, sub: PushSubscriptionJSON) =>
    rpc<{ saved: boolean; delivers: boolean }>('owner_save_push', {
      p_slug: slug,
      p_endpoint: sub.endpoint,
      p_p256dh: sub.keys?.p256dh,
      p_auth: sub.keys?.auth,
    }),
};

// ------------------------------------------------------------------ storage (owner uploads)

export async function uploadOwnerImage(tenantId: string, file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new ApiError('invalid_file', 'Нужна фотография JPG, PNG или WebP');
  if (file.size > 8 * 1024 * 1024) throw new ApiError('file_too_large', 'Файл больше 8 МБ');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${tenantId}/owner/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (error) throw new ApiError('upload_failed', `Не удалось загрузить фото: ${error.message}`);
  return path;
}

// ------------------------------------------------------------------ assistant

export interface AssistantResponse {
  reply: string;
  router: 'tools' | 'json' | 'keyword';
  degraded: boolean;
  ai_available: boolean;
  budget_exhausted: boolean;
  tools: { name: string; ok: boolean; source: string }[];
  slots: { service_id: string; service_name: string; starts_at: string; label: string }[];
}

export async function askAssistant(
  slug: string,
  scope: 'client' | 'owner',
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<AssistantResponse> {
  const { data, error } = await supabase.functions.invoke<AssistantResponse>('assistant', { body: { slug, scope, messages } });
  if (error) {
    let body: { error?: string; message?: string } | null = null;
    try {
      body = await (error as { context?: Response }).context?.json();
    } catch {
      body = null;
    }
    if (body?.message) throw new ApiError(body.error ?? 'assistant_error', body.message);
    throw toApiError(error);
  }
  return data!;
}
