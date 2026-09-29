import { Platform } from 'react-native';

/**
 * Public, client-safe configuration only. Secrets (Anthropic, Voyage, service role,
 * webhook secrets) live exclusively in Supabase Edge Function secrets.
 */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  revenueCatKey: Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    default: undefined,
  }),
  oneSignalAppId: process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '',
  /** Google OAuth "Web application" client ID (also configured in Supabase → Auth → Google). */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  /** Google OAuth "iOS" client ID. */
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  /** Sign in with Apple requires the paid Apple Developer Program; enable when available. */
  appleSignIn: process.env.EXPO_PUBLIC_ENABLE_APPLE_SIGN_IN === 'true',
};

export const features = {
  backend: !!(env.supabaseUrl && env.supabaseAnonKey),
  purchases: !!env.revenueCatKey,
  oneSignal: !!env.oneSignalAppId,
};
