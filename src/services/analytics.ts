import { supabase } from './supabase';

/**
 * Privacy-respecting product analytics.
 *
 * Event names are a closed set; properties are coarse numbers/enums only. Object names,
 * places, photos and free text are NEVER sent. Disabled entirely when the user opts out.
 */

export type AnalyticsEvent =
  | 'first_object_saved'
  | 'scan_started'
  | 'scan_completed'
  | 'object_found'
  | 'query_success'
  | 'query_failed'
  | 'location_corrected'
  | 'object_corrected'
  | 'box_created'
  | 'box_scanned'
  | 'paywall_viewed'
  | 'purchase_started'
  | 'purchase_completed'
  | 'notification_opened'
  | 'capture_saved'
  | 'onboarding_completed';

type Prop = number | boolean | 'remember' | 'scan' | 'box' | 'ai' | 'manual' | 'high' | 'medium' | 'low' | 'unknown' | string;

const ALLOWED_STRING = /^[a-z_]{1,24}$/;

let enabled = true;
const buffer: { name: AnalyticsEvent; props: Record<string, Prop>; created_at: string }[] = [];

export function setAnalyticsEnabled(on: boolean): void {
  enabled = on;
  if (!on) buffer.length = 0;
}

/** Strip anything that isn't a number, boolean or short enum-like token. */
export function sanitizeProps(props: Record<string, Prop>): Record<string, Prop> {
  const out: Record<string, Prop> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && ALLOWED_STRING.test(v)) out[k] = v;
  }
  return out;
}

export function track(name: AnalyticsEvent, props: Record<string, Prop> = {}): void {
  if (!enabled) return;
  buffer.push({ name, props: sanitizeProps(props), created_at: new Date().toISOString() });
  if (buffer.length >= 10) void flush();
}

export async function flush(): Promise<void> {
  const sb = supabase();
  if (!sb || !enabled || buffer.length === 0) return;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return;
  const batch = buffer.splice(0, buffer.length);
  const { error } = await sb.from('analytics_events').insert(batch.map((e) => ({ ...e, user_id: uid })));
  if (error) buffer.unshift(...batch.slice(-50));
}
