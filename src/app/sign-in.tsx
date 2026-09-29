import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Cloud, Lock, Mail, ScanLine, ShieldCheck, X } from 'lucide-react-native';
import { appleAvailable, googleAvailable, isValidEmail, sendEmailCode, signInWithApple, signInWithGoogle, verifyEmailCode, type AuthResult } from '@/services/auth';
import { track } from '@/services/analytics';
import { useSession, type NextRoute, type SignInReason } from '@/state/session';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button, IconButton } from '@/ui/components/Button';
import { DrawerIllustration } from '@/ui/components/EmptyState';
import { Screen } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

const COPY: Record<SignInReason, { title: string; body: string }> = {
  capture: { title: 'Sign in to start remembering', body: 'Your objects, places and photos are saved to your account, so your memory is never lost if you change phones.' },
  save: { title: 'Sign in to save this', body: 'Everything you remember belongs to your account and stays private to you.' },
  purchase: { title: 'Sign in to upgrade', body: 'Pro is linked to your account, so it works on all your devices and can always be restored.' },
  sync: { title: 'Sign in to back up', body: 'Encrypted backup keeps your physical memory safe across devices.' },
  general: { title: 'Sign in to Physical Memory', body: 'Keep your memory safe and private to your account.' },
};

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

export default function SignIn() {
  const params = useLocalSearchParams<{ reason?: SignInReason; next?: string }>();
  const reason: SignInReason = params.reason && params.reason in COPY ? params.reason : 'general';
  const { c, scheme } = useTheme();
  const { signedIn, backend } = useSession();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<'apple' | 'google' | 'email' | null>(null);
  const [emailStep, setEmailStep] = useState<'closed' | 'enter' | 'code'>('closed');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appleAvailable().then(setApple);
  }, []);

  // Once signed in, continue exactly where the user was heading.
  useEffect(() => {
    if (!signedIn) return;
    let next: NextRoute | null = null;
    try {
      next = params.next ? (JSON.parse(params.next) as NextRoute) : null;
    } catch {
      next = null;
    }
    if (next?.pathname) router.replace({ pathname: next.pathname as never, params: next.params });
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [signedIn, params.next]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setBusy('email');
    setError(null);
    const r = await sendEmailCode(email);
    setBusy(null);
    if (!r.ok) return setError(r.message);
    setEmailStep('code');
    setCode('');
    setCooldown(60);
  };

  const run = async (provider: 'apple' | 'google' | 'email', fn: () => Promise<AuthResult>) => {
    setBusy(provider);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.status === 'signed_in') track('sign_in_completed', { provider, reason });
    else if (r.status === 'error') setError(r.message);
  };

  const copy = COPY[reason];

  return (
    <Screen bottomInset={40}>
      <View style={{ alignItems: 'flex-end' }}>
        <IconButton icon={X} label="Not now" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>

      <Animated.View entering={FadeInDown.duration(360)} style={{ alignItems: 'center', marginTop: space.md }}>
        <DrawerIllustration size={130} />
      </Animated.View>
      <T variant="title" align="center" style={{ marginTop: space.xl }}>
        {copy.title}
      </T>
      <T variant="body" color="muted" align="center" style={{ marginTop: space.sm }}>
        {copy.body}
      </T>

      <View style={[styles.points, { backgroundColor: c.surface, borderColor: c.line }]}>
        {[
          [ScanLine, 'Remember objects with your camera and voice'],
          [Cloud, 'Your memory follows you to a new phone'],
          [Lock, 'Private to your account — never sold or shared'],
        ].map(([Icon, text]) => {
          const I = Icon as typeof Lock;
          return (
            <View key={text as string} style={styles.point}>
              <I size={18} color={c.ember} />
              <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
                {text as string}
              </T>
            </View>
          );
        })}
      </View>

      <View style={{ gap: space.md, marginTop: space.xxl }}>
        {!backend ? (
          <T variant="callout" color="muted" align="center">
            Sign-in isn’t configured in this build. Add your Supabase keys to .env to enable accounts.
          </T>
        ) : null}

        {apple ? (
          <View pointerEvents={busy ? 'none' : 'auto'} style={{ opacity: busy && busy !== 'apple' ? 0.5 : 1 }}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.pill}
              style={styles.provider}
              onPress={() => run('apple', signInWithApple)}
            />
          </View>
        ) : null}

        {backend && googleAvailable() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            disabled={!!busy}
            onPress={() => run('google', signInWithGoogle)}
            style={({ pressed }) => [styles.provider, styles.google, { borderColor: c.lineStrong, backgroundColor: '#FFFFFF', opacity: pressed || (busy && busy !== 'google') ? 0.7 : 1 }]}
          >
            {busy === 'google' ? <ActivityIndicator color="#1F1F1F" /> : <GoogleG />}
            <T variant="bodyStrong" style={{ color: '#1F1F1F' }}>
              Continue with Google
            </T>
          </Pressable>
        ) : null}

        {backend && emailStep === 'closed' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with email"
            disabled={!!busy}
            onPress={() => setEmailStep('enter')}
            style={({ pressed }) => [styles.provider, styles.google, { borderColor: c.lineStrong, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <Mail size={18} color={c.ink} />
            <T variant="bodyStrong">Continue with email</T>
          </Pressable>
        ) : null}

        {backend && emailStep !== 'closed' ? (
          <View style={[styles.emailBox, { backgroundColor: c.surface, borderColor: c.line }]}>
            {emailStep === 'enter' ? (
              <>
                <T variant="label" color="muted">
                  We’ll email you a sign-in code
                </T>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={c.faint}
                  autoFocus
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  onSubmitEditing={() => isValidEmail(email) && sendCode()}
                  style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
                  accessibilityLabel="Email address"
                />
                <Button label="Send code" loading={busy === 'email'} disabled={!isValidEmail(email) || !!busy} onPress={sendCode} />
              </>
            ) : (
              <>
                <T variant="label" color="muted">
                  We emailed {email.trim()}. Tap the link in it on this phone — or enter the code if the email has one.
                </T>
                <TextInput
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 10))}
                  placeholder="123456"
                  placeholderTextColor={c.faint}
                  autoFocus
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  returnKeyType="done"
                  onSubmitEditing={() => code.length >= 6 && run('email', () => verifyEmailCode(email, code))}
                  style={[styles.input, styles.code, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
                  accessibilityLabel="Sign-in code"
                />
                <Button label="Sign in" loading={busy === 'email'} disabled={code.length < 6 || !!busy} onPress={() => run('email', () => verifyEmailCode(email, code))} />
                <View style={styles.emailLinks}>
                  <T variant="caption" color="muted" onPress={() => setEmailStep('enter')}>
                    Change email
                  </T>
                  <T variant="caption" color={cooldown > 0 ? 'faint' : 'ember'} onPress={cooldown > 0 || busy ? undefined : sendCode}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </T>
                </View>
              </>
            )}
          </View>
        ) : null}

        {error ? (
          <View style={[styles.error, { backgroundColor: c.emberSoft }]}>
            <T variant="callout" style={{ color: c.emberInk }}>
              {error}
            </T>
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.later} hitSlop={8}>
          <T variant="label" color="muted">
            Not now — just look around
          </T>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <ShieldCheck size={14} color={c.faint} />
        <T variant="caption" color="faint" style={{ flex: 1 }}>
          We only receive your name and email — never a password. See the{' '}
          <T variant="caption" color="muted" onPress={() => Linking.openURL('https://github.com/ParishruthiGanesh/RevenueCat-Shipaton/blob/main/docs/PRIVACY.md')}>
            privacy policy
          </T>
          .
        </T>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  points: { marginTop: space.xxl, padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, gap: space.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  provider: { height: 54, alignSelf: 'stretch' },
  google: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, borderRadius: radius.pill, borderWidth: 1 },
  error: { padding: space.md, borderRadius: radius.md },
  emailBox: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  input: { height: 52, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontSize: 17, fontFamily: 'Inter_500Medium' },
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontFamily: 'Inter_600SemiBold' },
  emailLinks: { flexDirection: 'row', justifyContent: 'space-between' },
  later: { alignItems: 'center', paddingVertical: space.sm },
  footer: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.xxl },
});
