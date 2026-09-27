import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { Check, Cloud, History, Infinity as InfinityIcon, Luggage, ScanLine, Users, X } from 'lucide-react-native';
import { FREE_LIMITS } from '@/core/plan';
import { getCurrentOffering, purchase, restore } from '@/services/purchases';
import { track } from '@/services/analytics';
import { usePro } from '@/state/pro';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button, IconButton } from '@/ui/components/Button';
import { DrawerIllustration } from '@/ui/components/EmptyState';
import { Screen } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

const FEATURES = [
  { icon: InfinityIcon, title: 'Unlimited memory', body: `Remember everything — not just ${FREE_LIMITS.items} items and ${FREE_LIMITS.storageBoxes} boxes.` },
  { icon: ScanLine, title: 'Unlimited AI scans', body: 'Scan whole drawers, shelves and rooms. See what changed since last time.' },
  { icon: History, title: 'Full object history', body: 'Every place something has been. Where you usually keep it.' },
  { icon: Luggage, title: 'Travel mode', body: 'Packed, confirmed, and nothing left behind in the hotel room.' },
  { icon: Users, title: 'Family spaces', body: '“Where did Dad put the drill?” — with private items kept private.' },
  { icon: Cloud, title: 'Encrypted backup & sync', body: 'Your physical memory, safe across devices.' },
];

/**
 * Paywall driven entirely by the current RevenueCat offering — packages, prices and trial
 * terms come from the dashboard. No purchase is ever simulated.
 */
export default function Paywall() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { c } = useTheme();
  const { available, isPro, setCustomerInfo } = usePro();
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    track('paywall_viewed', { source: reason ? 'gate' : 'direct' });
    if (!available) return;
    getCurrentOffering()
      .then((o) => {
        setOffering(o);
        setSelected(o?.annual ?? o?.availablePackages[0] ?? null);
      })
      .catch(() => setMessage('Couldn’t load plans. Check your connection and try again.'))
      .finally(() => setLoading(false));
  }, [available, reason]);

  const buy = async () => {
    if (!selected) return;
    setBusy('buy');
    setMessage(null);
    track('purchase_started', { package: selected.packageType.toLowerCase() });
    const r = await purchase(selected);
    setBusy(null);
    if (r.status === 'purchased') {
      setCustomerInfo(r.info);
      track('purchase_completed', { package: selected.packageType.toLowerCase() });
      router.back();
    } else if (r.status === 'error') setMessage(r.message);
  };

  const doRestore = async () => {
    setBusy('restore');
    setMessage(null);
    const r = await restore();
    setBusy(null);
    if (r.info) setCustomerInfo(r.info);
    setMessage(r.restored ? 'Pro restored. Thank you!' : (r.message ?? 'No previous Pro purchase was found for this account.'));
    if (r.restored) setTimeout(() => router.back(), 900);
  };

  const pkgs = offering?.availablePackages ?? [];
  const monthly = offering?.monthly;

  return (
    <Screen bottomInset={40}>
      <View style={{ alignItems: 'flex-end' }}>
        <IconButton icon={X} label="Close" onPress={() => router.back()} />
      </View>
      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <DrawerIllustration size={120} />
      </View>
      <T variant="overline" color="ember" align="center" style={{ marginTop: space.lg }}>
        Physical Memory Pro
      </T>
      <T variant="title" align="center" style={{ marginTop: space.xs }}>
        Your whole physical world, remembered.
      </T>
      {reason ? (
        <T variant="callout" color="muted" align="center" style={{ marginTop: space.sm }}>
          {reason}
        </T>
      ) : null}

      <View style={{ gap: space.lg, marginTop: space.xxl }}>
        {FEATURES.map((f, i) => (
          <Animated.View key={f.title} entering={FadeInDown.delay(i * 50)} style={styles.feature}>
            <View style={[styles.featureIcon, { backgroundColor: c.emberSoft }]}>
              <f.icon size={18} color={c.emberInk} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{f.title}</T>
              <T variant="caption" color="muted">
                {f.body}
              </T>
            </View>
          </Animated.View>
        ))}
      </View>

      <View style={{ marginTop: space.xxl, gap: space.sm }}>
        {isPro ? (
          <View style={[styles.pkg, { borderColor: c.success, backgroundColor: c.surface }]}>
            <Check size={20} color={c.success} />
            <T variant="bodyStrong">You have Pro. Thank you for supporting Physical Memory.</T>
          </View>
        ) : available && loading ? (
          <ActivityIndicator color={c.muted} style={{ marginVertical: space.xl }} />
        ) : !available ? (
          <T variant="callout" color="muted" align="center">
            Purchases aren’t available in this build. Install from the App Store or Google Play to upgrade.
          </T>
        ) : pkgs.length === 0 ? (
          <T variant="callout" color="muted" align="center">
            {message ?? 'No plans are available right now.'}
          </T>
        ) : (
          pkgs.map((p) => {
            const active = selected?.identifier === p.identifier;
            const isAnnual = p.packageType === 'ANNUAL';
            const saving = isAnnual && monthly && p.product.pricePerMonth && monthly.product.price ? Math.round((1 - p.product.pricePerMonth / monthly.product.price) * 100) : null;
            return (
              <Pressable key={p.identifier} onPress={() => setSelected(p)} accessibilityRole="radio" accessibilityState={{ selected: active }} style={[styles.pkg, { borderColor: active ? c.ink : c.line, backgroundColor: c.surface, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}>
                <View style={[styles.radio, { borderColor: active ? c.ink : c.lineStrong }]}>{active ? <View style={[styles.radioDot, { backgroundColor: c.ink }]} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{isAnnual ? 'Yearly' : p.packageType === 'MONTHLY' ? 'Monthly' : p.product.title}</T>
                  <T variant="caption" color="muted">
                    {isAnnual && p.product.pricePerMonthString ? `${p.product.pricePerMonthString}/month, billed yearly` : p.product.subscriptionPeriod ? 'Billed monthly' : 'One-time purchase'}
                    {p.product.introPrice ? ` · ${p.product.introPrice.price === 0 ? `free for ${p.product.introPrice.periodNumberOfUnits} ${p.product.introPrice.periodUnit.toLowerCase()}${p.product.introPrice.periodNumberOfUnits > 1 ? 's' : ''}` : `intro ${p.product.introPrice.priceString}`}` : ''}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T variant="bodyStrong">{p.product.priceString}</T>
                  {saving && saving > 0 ? (
                    <View style={[styles.save, { backgroundColor: c.ember }]}>
                      <T variant="caption" style={{ color: '#fff', fontFamily: 'Inter_600SemiBold' }}>
                        Save {saving}%
                      </T>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
        {message && pkgs.length ? (
          <T variant="callout" color="muted" align="center">
            {message}
          </T>
        ) : null}
      </View>

      {!isPro && available && pkgs.length ? (
        <Button label={selected?.product.introPrice?.price === 0 ? 'Start free trial' : 'Continue'} variant="ember" size="lg" full loading={busy === 'buy'} disabled={!selected || busy !== null} onPress={buy} style={{ marginTop: space.xl }} />
      ) : null}
      {available ? <Button label="Restore purchases" variant="ghost" loading={busy === 'restore'} onPress={doRestore} style={{ marginTop: space.sm }} /> : null}

      <T variant="caption" color="faint" align="center" style={{ marginTop: space.lg }}>
        Subscriptions renew automatically until cancelled in your store account settings. Your memory stays yours: cancelling never deletes anything.
      </T>
      <View style={styles.links}>
        <T variant="caption" color="muted" onPress={() => Linking.openURL('https://github.com/ParishruthiGanesh/RevenueCat-Shipaton/blob/main/docs/TERMS.md')}>
          Terms
        </T>
        <T variant="caption" color="muted" onPress={() => Linking.openURL('https://github.com/ParishruthiGanesh/RevenueCat-Shipaton/blob/main/docs/PRIVACY.md')}>
          Privacy
        </T>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  feature: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  featureIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  pkg: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  save: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, marginTop: 4 },
  links: { flexDirection: 'row', gap: space.xl, justifyContent: 'center', marginTop: space.md },
});
