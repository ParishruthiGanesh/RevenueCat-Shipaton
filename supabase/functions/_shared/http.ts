import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Every AI endpoint requires a signed-in (possibly anonymous) user, so none is an open proxy. */
export async function requireUser(req: Request): Promise<{ user: User; db: SupabaseClient } | Response> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return errorResponse(401, 'unauthenticated', 'Sign in required.');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return errorResponse(401, 'unauthenticated', 'Invalid session.');
  return { user: data.user, db };
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

export const FREE_AI_SCANS_PER_MONTH = 20;

/** Pro users are unlimited; free users get a monthly allowance. Server-side so it can't be bypassed. */
export async function checkAiAllowance(userId: string): Promise<{ allowed: boolean; used: number; pro: boolean }> {
  const admin = adminClient();
  const { data: sub } = await admin
    .from('subscriptions')
    .select('expires_at, is_active')
    .eq('user_id', userId)
    .eq('entitlement', 'physical_memory_pro')
    .maybeSingle();
  const pro = !!sub?.is_active && (!sub.expires_at || new Date(sub.expires_at) > new Date());
  if (pro) return { allowed: true, used: 0, pro };
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'scene').gte('created_at', monthStart.toISOString());
  const used = count ?? 0;
  return { allowed: used < FREE_AI_SCANS_PER_MONTH, used, pro };
}

export async function recordAiUsage(userId: string, kind: 'scene' | 'interpret' | 'embed', meta: Record<string, unknown>): Promise<void> {
  await adminClient().from('ai_usage').insert({ user_id: userId, kind, meta });
}
