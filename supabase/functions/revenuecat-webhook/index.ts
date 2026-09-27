import { adminClient, errorResponse, json } from '../_shared/http.ts';

/**
 * revenuecat-webhook — mirrors entitlement state server-side so AI quotas and cloud sync can be
 * enforced by the backend (the client SDK remains the source of truth for UI).
 *
 * Configure in RevenueCat → Integrations → Webhooks with Authorization header
 * `Bearer <REVENUECAT_WEBHOOK_SECRET>`. App user IDs are Supabase auth user IDs (Purchases.logIn).
 */

const ENTITLEMENT = 'physical_memory_pro';
const ACTIVE = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
const INACTIVE = new Set(['EXPIRATION', 'BILLING_ISSUE']);

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!secret || !safeEqual(req.headers.get('Authorization') ?? '', `Bearer ${secret}`)) return errorResponse(401, 'unauthorized', 'Bad signature.');

  const payload = await req.json().catch(() => null);
  const event = payload?.event;
  if (!event?.type || !event.app_user_id) return errorResponse(400, 'invalid_event', 'Missing event.');

  const entitlements: string[] = event.entitlement_ids ?? [];
  if (entitlements.length && !entitlements.includes(ENTITLEMENT)) return json({ ignored: true });

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const userIds = [event.app_user_id, ...(event.aliases ?? [])].filter((id: string) => uuid.test(id));
  if (!userIds.length) return json({ ignored: 'anonymous_app_user' });

  let isActive: boolean | undefined;
  if (ACTIVE.has(event.type)) isActive = true;
  else if (INACTIVE.has(event.type)) isActive = false;
  else if (event.type === 'CANCELLATION') isActive = true; // still active until expiration
  if (isActive === undefined) return json({ ignored: event.type });

  const admin = adminClient();
  for (const userId of userIds) {
    const { error } = await admin.from('subscriptions').upsert(
      {
        user_id: userId,
        entitlement: ENTITLEMENT,
        is_active: isActive,
        product_id: event.product_id ?? null,
        store: event.store ?? null,
        period_type: event.period_type ?? null,
        expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
        will_renew: event.type !== 'CANCELLATION' && event.type !== 'EXPIRATION',
        last_event: event.type,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,entitlement' },
    );
    if (error) console.error('subscription upsert failed', error.message);
  }
  return json({ ok: true });
});
