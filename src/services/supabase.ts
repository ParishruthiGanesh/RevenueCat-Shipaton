import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';
import { env, features } from './env';

/**
 * Supabase client. Sessions persist in the on-device SQLite KV store.
 * Users start with an anonymous account (no sign-up wall) that can later be linked to email/Apple.
 */
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!features.backend) return null;
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { storage: Storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
  }
  return client;
}

export async function ensureSession(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return anon.user?.id ?? null;
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
  await ensureSession();
  const { data: session } = await sb.auth.getSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.session?.access_token ?? env.supabaseAnonKey}`,
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
