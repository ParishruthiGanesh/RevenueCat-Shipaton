import { Platform } from 'react-native';
import { GoogleOneTapSignIn, isCancelledResponse, isErrorWithCode, isNoSavedCredentialFoundResponse, isSuccessResponse, statusCodes } from 'react-native-nitro-google-signin';

/** Native Google sign-in (Credential Manager on Android, Google SDK on iOS). Web uses google-signin.web.ts. */

export type GoogleTokenResult = { status: 'token'; idToken: string } | { status: 'cancelled' } | { status: 'error'; message: string };

let configured = false;

export function configureGoogle(webClientId: string, iosClientId?: string): void {
  if (configured) return;
  GoogleOneTapSignIn.configure({ webClientId, iosClientId: iosClientId || undefined, scopes: ['email', 'profile'] });
  configured = true;
}

export async function getGoogleIdToken(): Promise<GoogleTokenResult> {
  try {
    let res;
    if (Platform.OS === 'android') {
      // Returning users get one tap; first-timers pick an account.
      res = await GoogleOneTapSignIn.signIn();
      if (isNoSavedCredentialFoundResponse(res)) res = await GoogleOneTapSignIn.createAccount();
    } else {
      res = await GoogleOneTapSignIn.presentExplicitSignIn();
    }
    if (isCancelledResponse(res) || isNoSavedCredentialFoundResponse(res)) return { status: 'cancelled' };
    if (!isSuccessResponse(res) || !res.data.idToken) return { status: 'error', message: 'Google didn’t return a sign-in token.' };
    return { status: 'token', idToken: res.data.idToken };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return { status: 'cancelled' };
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { status: 'error', message: 'Google Play Services is missing or out of date.' };
      if (e.code === statusCodes.DEVELOPER_ERROR) return { status: 'error', message: 'Google sign-in is misconfigured (check the OAuth client IDs and SHA-1).' };
    }
    return { status: 'error', message: (e as Error).message || 'Google sign-in failed.' };
  }
}

export async function googleSignOut(): Promise<void> {
  if (configured) await GoogleOneTapSignIn.signOut().catch(() => undefined);
}
