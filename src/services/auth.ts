import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { configureGoogle, getGoogleIdToken, googleSignOut } from './google-signin';
import { env } from './env';
import { supabase } from './supabase';

/**
 * Native Sign in with Apple / Google → Supabase session via `signInWithIdToken`.
 * No passwords are handled by the app; the platform account pickers issue ID tokens that
 * Supabase verifies server-side.
 */

export type AuthResult = { status: 'signed_in' } | { status: 'cancelled' } | { status: 'error'; message: string };

export const googleAvailable = (): boolean => !!env.googleWebClientId && Platform.OS !== 'web';

export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !env.appleSignIn) return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithGoogle(): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { status: 'error', message: 'Sign-in isn’t configured in this build.' };
  if (!env.googleWebClientId) return { status: 'error', message: 'Google sign-in isn’t configured in this build.' };
  configureGoogle(env.googleWebClientId, env.googleIosClientId);
  const r = await getGoogleIdToken();
  if (r.status !== 'token') return r;
  const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: r.idToken });
  if (error) return { status: 'error', message: error.message };
  return { status: 'signed_in' };
}

export async function signInWithApple(): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { status: 'error', message: 'Sign-in isn’t configured in this build.' };
  try {
    // Apple receives the SHA-256 of the nonce; Supabase gets the raw value to verify it.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return { status: 'error', message: 'Apple didn’t return a sign-in token.' };
    const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
    if (error) return { status: 'error', message: error.message };
    // Apple shares the name only on the very first sign-in — keep it.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    if (name) await sb.auth.updateUser({ data: { full_name: name } });
    return { status: 'signed_in' };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { status: 'cancelled' };
    return { status: 'error', message: (e as Error).message || 'Apple sign-in failed.' };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email.trim());

/** Email sign-in, step 1: Supabase emails a one-time code (creates the account if new). */
export async function sendEmailCode(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = supabase();
  if (!sb) return { ok: false, message: 'Sign-in isn’t configured in this build.' };
  if (!isValidEmail(email)) return { ok: false, message: 'That doesn’t look like an email address.' };
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    // The email's sign-in link opens the app (pm://auth-callback); the code works too once the template includes it.
    options: { shouldCreateUser: true, emailRedirectTo: Linking.createURL('auth-callback') },
  });
  if (error) return { ok: false, message: error.status === 429 ? 'Too many codes requested. Wait a minute and try again.' : error.message };
  return { ok: true };
}

/** Email sign-in, step 2: verify the code from the email. */
export async function verifyEmailCode(email: string, code: string): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { status: 'error', message: 'Sign-in isn’t configured in this build.' };
  const token = code.replace(/\D/g, '');
  if (token.length < 6) return { status: 'error', message: 'Enter the code from the email.' };
  const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
  if (error) return { status: 'error', message: /expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Request a new one.' : error.message };
  return { status: 'signed_in' };
}

/** Completes sign-in from an email link (PKCE `code` param) or reports the error Supabase attached. */
export async function completeEmailLink(params: { code?: string; error_description?: string }): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { status: 'error', message: 'Sign-in isn’t configured in this build.' };
  if (params.error_description) return { status: 'error', message: params.error_description.replace(/\+/g, ' ') };
  if (!params.code) return { status: 'error', message: 'This sign-in link is incomplete.' };
  const { error } = await sb.auth.exchangeCodeForSession(params.code);
  if (error) return { status: 'error', message: /expired|invalid/i.test(error.message) ? 'This link has expired or was opened on a different device. Request a new one in the app.' : error.message };
  return { status: 'signed_in' };
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut();
  await googleSignOut();
}
