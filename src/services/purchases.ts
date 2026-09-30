import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import { PRO_ENTITLEMENT } from '@/core/plan';
import { env, features } from './env';

/**
 * RevenueCat integration. Offerings, packages and prices are configured in the RevenueCat
 * dashboard — nothing about pricing is hardcoded here. The `physical_memory_pro` entitlement
 * gates Pro features; the same entitlement is mirrored server-side via webhook.
 */

let configured = false;

export function configurePurchases(appUserId?: string | null): boolean {
  if (!features.purchases || configured) return configured;
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN).catch(() => undefined);
  Purchases.configure({ apiKey: env.revenueCatKey!, appUserID: appUserId ?? undefined });
  configured = true;
  return true;
}

export function isPurchasesReady(): boolean {
  return configured;
}

/** Align RevenueCat's app user with the Supabase user so the webhook can map entitlements. */
export async function identify(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch {
    // Non-fatal: purchases still work under the anonymous RevenueCat ID and alias later.
  }
}

/** Detach purchases from the account on sign-out (RevenueCat returns to an anonymous user). */
export async function logOutPurchases(): Promise<void> {
  if (!configured) return;
  try {
    if (!(await Purchases.isAnonymous())) await Purchases.logOut();
  } catch {
    // Already anonymous.
  }
}

/** Pro = the `physical_memory_pro` entitlement, or any active entitlement (this project has a single tier). */
export function hasPro(info: CustomerInfo | null | undefined): boolean {
  const active = info?.entitlements.active ?? {};
  return !!active[PRO_ENTITLEMENT] || Object.keys(active).length > 0;
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

export type PurchaseOutcome = { status: 'purchased'; info: CustomerInfo } | { status: 'cancelled' } | { status: 'error'; message: string };

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return hasPro(customerInfo) ? { status: 'purchased', info: customerInfo } : { status: 'error', message: 'The purchase completed but Pro is not active yet. Try Restore.' };
  } catch (e) {
    const err = e as { userCancelled?: boolean | null; message?: string };
    if (err.userCancelled) return { status: 'cancelled' };
    return { status: 'error', message: err.message ?? 'The purchase could not be completed.' };
  }
}

export async function restore(): Promise<{ restored: boolean; info?: CustomerInfo; message?: string }> {
  if (!configured) return { restored: false, message: 'Purchases are unavailable on this device.' };
  try {
    const info = await Purchases.restorePurchases();
    return { restored: hasPro(info), info };
  } catch (e) {
    return { restored: false, message: (e as Error).message ?? 'Restore failed.' };
  }
}

export function onCustomerInfo(listener: (info: CustomerInfo) => void): () => void {
  if (!configured) return () => undefined;
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}
