import type { ExpoConfig } from 'expo/config';

// Google iOS sign-in needs the reversed iOS client ID registered as a URL scheme.
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const googleIosUrlScheme = googleIosClientId ? `com.googleusercontent.apps.${googleIosClientId.replace('.apps.googleusercontent.com', '')}` : undefined;
// Sign in with Apple needs a paid Apple Developer account; off until EXPO_PUBLIC_ENABLE_APPLE_SIGN_IN=true.
const appleSignIn = process.env.EXPO_PUBLIC_ENABLE_APPLE_SIGN_IN === 'true';

/**
 * App configuration. Public keys come from EXPO_PUBLIC_* env vars (see .env.example).
 * Secrets never live here — they are Supabase Edge Function secrets.
 */
const config: ExpoConfig = {
  name: 'Physical Memory',
  slug: 'physical-memory',
  scheme: 'pm',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.physicalmemory',
    usesAppleSignIn: appleSignIn,
    infoPlist: {
      NSCameraUsageDescription: 'Physical Memory uses the camera only when you press the shutter, to remember where you put your things.',
      NSMicrophoneUsageDescription: 'Say what you’re putting away, like “Remember my passport is in the top drawer”.',
      NSSpeechRecognitionUsageDescription: 'Your words are turned into text — on your device when supported — to understand what you’re remembering or asking.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.physicalmemory',
    adaptiveIcon: {
      backgroundColor: '#F6F2EC',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro' },
  plugins: [
    ['expo-router', { headers: { 'Cross-Origin-Embedder-Policy': 'credentialless', 'Cross-Origin-Opener-Policy': 'same-origin' } }],
    'expo-sqlite',
    'expo-image',
    'expo-secure-store',
    'expo-sharing',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#F6F2EC', image: './assets/splash-icon.png', imageWidth: 160 }],
    ['expo-camera', { cameraPermission: 'Physical Memory uses the camera only when you press the shutter, to remember where you put your things.', recordAudioAndroid: false }],
    ['expo-speech-recognition', { microphonePermission: 'Say what you’re putting away.', speechRecognitionPermission: 'Your words are turned into text to understand what you’re remembering or asking.' }],
    ['expo-notifications', { color: '#D9602F' }],
    ...(appleSignIn ? ['expo-apple-authentication'] : []),
    googleIosUrlScheme ? ['react-native-nitro-google-signin', { iosUrlScheme: googleIosUrlScheme }] : 'react-native-nitro-google-signin',
    ['onesignal-expo-plugin', { mode: process.env.NODE_ENV === 'production' ? 'production' : 'development' }],
    ['expo-build-properties', { ios: { deploymentTarget: '16.4' } }],
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
};

export default config;
