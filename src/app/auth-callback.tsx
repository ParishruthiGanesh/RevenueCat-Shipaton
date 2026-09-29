import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { completeEmailLink } from '@/services/auth';
import { track } from '@/services/analytics';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { T } from '@/ui/components/Text';

/** Opened by the sign-in link in the email (pm://auth-callback?code=…). */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const { c } = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeEmailLink(params).then((r) => {
      if (r.status === 'signed_in') {
        track('sign_in_completed', { provider: 'email_link' });
        router.replace('/');
      } else if (r.status === 'error') setError(r.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, params.error_description]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg }}>
      {error ? (
        <>
          <T variant="heading" align="center">
            Couldn’t sign you in
          </T>
          <T variant="callout" color="muted" align="center">
            {error}
          </T>
          <Button label="Try again" onPress={() => router.replace({ pathname: '/sign-in', params: { reason: 'general' } })} />
        </>
      ) : (
        <>
          <ActivityIndicator color={c.muted} />
          <T variant="callout" color="muted">
            Signing you in…
          </T>
        </>
      )}
    </View>
  );
}
