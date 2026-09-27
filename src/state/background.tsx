import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { computeInsights } from '@/core/insights';
import { pushOutbox } from '@/data/sync';
import { flush, setAnalyticsEnabled, track } from '@/services/analytics';
import { deliverInsights, initNotifications, onNotificationOpened, tagEngagement } from '@/services/notifications';
import { useMemory } from './memory';
import { usePro } from './pro';
import { useSession } from './session';
import { useSettings } from './settings';

/**
 * Invisible coordinator for work that happens outside screens:
 *  - drain the sync outbox when online (Pro + cloud sync enabled),
 *  - deliver genuinely useful reminders on foreground,
 *  - route notification taps to the right object,
 *  - flush privacy-safe analytics.
 */
export function BackgroundTasks() {
  const { graph } = useMemory();
  const { online, userId } = useSession();
  const { settings } = useSettings();
  const { isPro, usage } = usePro();
  const syncing = useRef(false);

  useEffect(() => setAnalyticsEnabled(settings.analytics), [settings.analytics]);

  useEffect(() => {
    initNotifications(userId).catch(() => undefined);
    return onNotificationOpened((entityId) => {
      track('notification_opened');
      if (entityId) router.push(`/item/${entityId}`);
    });
  }, [userId]);

  useEffect(() => {
    tagEngagement({ items: usage.items, boxes: usage.storageBoxes, pro: isPro });
  }, [usage.items, usage.storageBoxes, isPro]);

  useEffect(() => {
    const run = async () => {
      if (online && isPro && settings.cloudSync && userId && !syncing.current) {
        syncing.current = true;
        try {
          await pushOutbox(graph);
        } catch {
          // Retried on next foreground/commit; outbox keeps everything.
        } finally {
          syncing.current = false;
        }
      }
      if (settings.notifications) deliverInsights(computeInsights(graph), true).catch(() => undefined);
      flush().catch(() => undefined);
    };
    run();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = graph.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(run, 4000);
    });
    return () => {
      sub.remove();
      unsub();
      clearTimeout(timer);
    };
  }, [graph, online, isPro, settings.cloudSync, settings.notifications, userId]);

  return null;
}
