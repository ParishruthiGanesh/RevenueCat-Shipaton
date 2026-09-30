import { Redirect } from 'expo-router';
import { useSettings } from '@/state/settings';

export default function Index() {
  const { settings } = useSettings();
  if (__DEV__ && typeof window !== 'undefined' && window.location?.search?.includes('demo=1')) return <Redirect href="/(tabs)" />;
  return <Redirect href={settings.onboarded ? '/(tabs)' : '/onboarding'} />;
}
