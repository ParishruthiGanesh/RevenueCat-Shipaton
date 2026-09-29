import type { GoogleTokenResult } from './google-signin';

/** The product targets iOS/Android; native Google sign-in isn't available in the web preview. */
export type { GoogleTokenResult };
export function configureGoogle(): void {}
export async function getGoogleIdToken(): Promise<GoogleTokenResult> {
  return { status: 'error', message: 'Google sign-in is available in the iOS and Android apps.' };
}
export async function googleSignOut(): Promise<void> {}
