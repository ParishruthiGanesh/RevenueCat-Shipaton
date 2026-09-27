import { Redirect } from 'expo-router';
import { useSettings } from '@/state/settings';

export default function Index() {
  const { settings } = useSettings();
  return <Redirect href={settings.onboarded ? '/(tabs)' : '/onboarding'} />;
}
