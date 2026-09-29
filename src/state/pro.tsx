import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CustomerInfo } from 'react-native-purchases';
import { router } from 'expo-router';
import { gate, type GatedFeature, type GateResult, type Usage } from '@/core/plan';
import { kvGet, kvSet } from '@/data/db';
import { configurePurchases, getCustomerInfo, hasPro, identify, logOutPurchases, onCustomerInfo } from '@/services/purchases';
import { track } from '@/services/analytics';
import { useDerived } from './memory';

/**
 * Entitlement state from RevenueCat + local usage counters → feature gates.
 * When RevenueCat isn't configured (e.g. local dev without keys) the app runs as Free and the
 * paywall explains that purchases are unavailable — it never fakes a purchase.
 */

interface ProCtx {
  isPro: boolean;
  loading: boolean;
  available: boolean;
  customerInfo: CustomerInfo | null;
  usage: Usage;
  check: (f: GatedFeature) => GateResult;
  /** Returns true if allowed; otherwise opens the paywall and returns false. */
  require: (f: GatedFeature) => boolean;
  recordAiScan: () => void;
  refresh: () => Promise<void>;
  setCustomerInfo: (i: CustomerInfo) => void;
}

const Ctx = createContext<ProCtx | null>(null);
const SCANS_KEY = () => `aiScans.${new Date().toISOString().slice(0, 7)}`;

export function ProProvider({ children, userId }: { children: React.ReactNode; userId: string | null }) {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  // Configure once, anonymously; the Supabase user is attached via logIn below.
  const [available] = useState(() => configurePurchases(null));
  const [loading, setLoading] = useState(available);
  const [aiScans, setAiScans] = useState(0);

  const counts = useDerived((g) => ({ items: g.items().length, storageBoxes: g.entities((e) => !!e.box).length }));

  useEffect(() => {
    kvGet(SCANS_KEY()).then((v) => setAiScans(v ? parseInt(v, 10) : 0));
    if (!available) return;
    // Pro belongs to the account: log in on sign-in, detach on sign-out, then refresh.
    (userId ? identify(userId) : logOutPurchases())
      .then(() => getCustomerInfo())
      .then((i) => {
        setCustomerInfo(i);
        setLoading(false);
      });
    return onCustomerInfo(setCustomerInfo);
  }, [userId, available]);

  const usage = useMemo<Usage>(() => ({ ...counts, aiScansThisMonth: aiScans }), [counts, aiScans]);
  const isPro = hasPro(customerInfo);

  const check = useCallback((f: GatedFeature) => gate(f, usage, isPro), [usage, isPro]);
  const require = useCallback(
    (f: GatedFeature) => {
      const r = gate(f, usage, isPro);
      if (!r.allowed) {
        track('paywall_viewed', { trigger: f });
        router.push({ pathname: '/paywall', params: { reason: r.reason } });
      }
      return r.allowed;
    },
    [usage, isPro],
  );
  const recordAiScan = useCallback(() => {
    setAiScans((n) => {
      kvSet(SCANS_KEY(), String(n + 1)).catch(() => undefined);
      return n + 1;
    });
  }, []);
  const refresh = useCallback(async () => setCustomerInfo(await getCustomerInfo()), []);

  const value = useMemo(
    () => ({ isPro, loading, available, customerInfo, usage, check, require, recordAiScan, refresh, setCustomerInfo }),
    [isPro, loading, available, customerInfo, usage, check, require, recordAiScan, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePro(): ProCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePro must be used within ProProvider');
  return c;
}
