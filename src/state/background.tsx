import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { computeInsights } from '@/core/insights';
import { pushOutbox } from '@/data/sync';
import { flush, setAnalyticsEnabled, track } from '@/services/analytics';
import { deliverInsights, initNotifications, onNotificationOpened, tagEngagement } from '@/services/notifications';
import { useMemory } from './memory';
import { usePro } from './pro';
import { useFamily } from './family';
import { pullFamily } from '@/services/family';
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
  const { family } = useFamily();
  const syncing = useRef(false);
  const pulling = useRef(false);
  const lastPull = useRef(0);

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
      // Family members always sync their shared memory (the owner's Pro covers the household).
      if (online && userId && !syncing.current && ((isPro && settings.cloudSync) || family)) {
        syncing.current = true;
        try {
          await pushOutbox(graph);
          // Pull family changes at most once a minute; the pull's own commits must not re-trigger sync.
          if (family && Date.now() - lastPull.current > 60_000) {
            pulling.current = true;
            lastPull.current = Date.now();
            try {
              await pullFamily(graph, family.id);
            } finally {
              pulling.current = false;
            }
          }
        } catch (e) {
          // Retried on next foreground/commit; outbox keeps everything.
          console.warn('[sync] background sync failed:', (e as Error).message);
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
      if (pulling.current) return;
      clearTimeout(timer);
      timer = setTimeout(run, 4000);
    });
    return () => {
      sub.remove();
      unsub();
      clearTimeout(timer);
    };
  }, [graph, online, isPro, settings.cloudSync, settings.notifications, userId, family]);

  return null;
}
