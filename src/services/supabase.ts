import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authStorage } from './auth-storage';
import { env, features } from './env';

/**
 * Supabase client. Sessions persist in the on-device SQLite KV store.
 * Users sign in with Apple or Google (services/auth.ts); browsing works without an account.
 */
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!features.backend) return null;
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      // Native: SQLite-backed KV store. Web (preview only): the browser's localStorage, because
      // browsers allow a single open handle per SQLite file and the memory database already holds it.
      auth: { storage: authStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
    });
  }
  return client;
}

/** Current signed-in user id, or null. Never creates an account. */
export async function currentUserId(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

export class BackendError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Invoke an Edge Function with the user's JWT; normalises errors into BackendError. */
export async function invoke<T>(fn: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const sb = supabase();
  if (!sb) throw new BackendError('not_configured', 'Cloud features are not configured.', 0);
  const { data: session } = await sb.auth.getSession();
  if (!session.session) throw new BackendError('auth_required', 'Please sign in first.', 401);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.session.access_token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } } & T;
    if (!res.ok) throw new BackendError(json.error?.code ?? 'http_error', json.error?.message ?? `Request failed (${res.status})`, res.status);
    return json;
  } catch (e) {
    if (e instanceof BackendError) throw e;
    if ((e as Error).name === 'AbortError') throw new BackendError('timeout', 'The request timed out.', 0);
    throw new BackendError('network', 'No connection to the cloud.', 0);
  } finally {
    clearTimeout(timer);
  }
}
