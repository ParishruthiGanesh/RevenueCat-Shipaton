import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Insight } from '@/core/insights';
import { kvGet, kvSet } from '@/data/db';
import { env, features } from './env';

/**
 * Notification orchestration.
 *
 * Insights (core/insights.ts) decide WHAT is worth saying; this module decides HOW:
 *  - Local notifications for on-device events (loans, trips) — work offline, no server.
 *  - OneSignal (when configured) for identity + re-engagement orchestration, tagged only with
 *    coarse, non-sensitive properties (never object names).
 * Each insight is delivered at most once, and only if the user enabled notifications.
 */

let oneSignal: typeof import('react-native-onesignal').OneSignal | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function initNotifications(userId?: string | null): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('memory', { name: 'Memory reminders', importance: Notifications.AndroidImportance.DEFAULT });
  }
  if (features.oneSignal && !oneSignal) {
    try {
      const mod = await import('react-native-onesignal');
      oneSignal = mod.OneSignal;
      oneSignal.initialize(env.oneSignalAppId);
      if (userId) oneSignal.login(userId);
    } catch {
      oneSignal = null; // native module unavailable (e.g. Expo Go)
    }
  }
}

/** Ask only when the user turns on a feature that needs it — never at first launch. */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const res = await Notifications.requestPermissionsAsync();
  if (res.granted && oneSignal) oneSignal.Notifications.requestPermission(false).catch(() => undefined);
  return res.granted;
}

const SENT_KEY = 'notifications.sent.v1';

export async function deliverInsights(insights: Insight[], enabled: boolean): Promise<number> {
  if (!enabled) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  const sent = new Set<string>(JSON.parse((await kvGet(SENT_KEY)) ?? '[]'));
  let n = 0;
  for (const i of insights.filter((x) => x.push && !sent.has(x.id)).slice(0, 2)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: i.title, body: i.body, data: { entityId: i.entityId, kind: i.kind } },
      trigger: null,
    });
    sent.add(i.id);
    n++;
  }
  await kvSet(SENT_KEY, JSON.stringify([...sent].slice(-500)));
  return n;
}

/** Coarse engagement tags for OneSignal segments. Never object names or places. */
export function tagEngagement(tags: { items: number; boxes: number; pro: boolean }): void {
  if (!oneSignal) return;
  oneSignal.User.addTags({ items_bucket: tags.items >= 50 ? '50+' : tags.items >= 10 ? '10-49' : '0-9', has_boxes: String(tags.boxes > 0), pro: String(tags.pro) });
}

export function onNotificationOpened(handler: (entityId?: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => handler(r.notification.request.content.data?.entityId as string | undefined));
  return () => sub.remove();
}
