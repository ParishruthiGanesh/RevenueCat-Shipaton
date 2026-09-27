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
};

export const features = {
  backend: !!(env.supabaseUrl && env.supabaseAnonKey),
  purchases: !!env.revenueCatKey,
  oneSignal: !!env.oneSignalAppId,
};
