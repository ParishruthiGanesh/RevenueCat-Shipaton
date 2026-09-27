import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { CornerDownRight } from 'lucide-react-native';
import { ask, type AskResult } from '@/core/ask';
import { parseQuery, type ParsedQuery, type QueryIntent } from '@/core/query';
import type { InterpretedQueryT } from '../../../supabase/functions/_shared/scene-schema';
import { invoke } from '@/services/supabase';
import { track } from '@/services/analytics';
import { useMemory } from '@/state/memory';
import { usePro } from '@/state/pro';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { AskBar } from '@/ui/components/AskBar';
import { AskResultView } from '@/ui/components/AskResultView';
import { Screen, Section } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

const SMART: QueryIntent[] = ['stale', 'away', 'misplaced', 'changes', 'not_scanned', 'moves', 'storage'];

const EXAMPLES: { title: string; items: string[] }[] = [
  { title: 'Find', items: ['Where is my passport?', 'Which box has the coffee grinder?', 'What’s inside Box 1?', 'Where did I put my AirPods?'] },
  { title: 'History', items: ['Where do I usually keep my passport?', 'When did I last see my keys?', 'Was my passport ever in my backpack?'] },
  { title: 'Your whole physical life', items: ['What things are lent out?', 'How many chargers do I have?', 'What objects have uncertain locations?', 'What changed in my bedroom this week?', 'Which objects haven’t been seen in a year?', 'What hasn’t been scanned recently?'] },
];

export default function Search() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { graph } = useMemory();
  const { c, simple } = useTheme();
  const { online, backend } = useSession();
  const { settings } = useSettings();
  const { require } = usePro();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [thinking, setThinking] = useState(false);

  const run = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      setQ(t);
      let parsed: ParsedQuery = parseQuery(t);
      // Only when the on-device parser is unsure do we ask the cloud to structure the question.
      if (parsed.confidence < 0.5 && backend && online && settings.cloudAI) {
        setThinking(true);
        try {
          const res = await invoke<{ query: InterpretedQueryT }>('interpret-query', { question: t }, 20_000);
          const iq = res.query;
          parsed = { intent: iq.intent, subject: iq.subject ?? undefined, place: iq.place ?? undefined, person: iq.person ?? undefined, containerType: iq.containerType ?? undefined, sinceDays: iq.sinceDays ?? undefined, raw: t, confidence: 0.8 };
        } catch {
          // Fall back to the on-device interpretation.
        } finally {
          setThinking(false);
        }
      }
      if (SMART.includes(parsed.intent) && !require('smart_questions')) return;
      const r = ask(graph, parsed, { includeSensitive: true });
      setResult(r);
      track(r.type === 'none' ? 'query_failed' : 'query_success', { intent: parsed.intent, kind: r.type });
      if (r.type === 'item') track('object_found', { level: r.belief.level });
    },
    [graph, backend, online, settings.cloudAI, require],
  );

  useEffect(() => {
    if (!params.q) return;
    // Deferred so navigation with a ?q= param runs the question once the screen is mounted.
    const t = setTimeout(() => run(params.q!), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  return (
    <Screen>
      <T variant="title" style={{ marginBottom: space.lg }}>
        Ask Physical Memory
      </T>
      <AskBar value={q} onChangeText={setQ} onSubmit={run} autoFocus={!params.q && !result} placeholder="Ask about anything you own…" />
      <View style={{ marginTop: space.xl }}>
        {thinking ? (
          <View style={styles.thinking}>
            <ActivityIndicator color={c.muted} />
            <T variant="callout" color="muted">
              Understanding your question…
            </T>
          </View>
        ) : result ? (
          <AskResultView graph={graph} result={result} simple={simple} />
        ) : (
          EXAMPLES.map((group) => (
            <Section key={group.title} title={group.title} style={{ marginTop: space.xl }}>
              <View style={{ gap: space.xs }}>
                {group.items.map((ex) => (
                  <Pressable key={ex} onPress={() => run(ex)} style={({ pressed }) => [styles.example, { backgroundColor: pressed ? c.surfaceMuted : 'transparent' }]} accessibilityRole="button">
                    <CornerDownRight size={14} color={c.faint} />
                    <T variant="callout" color="inkSoft">
                      {ex}
                    </T>
                  </Pressable>
                ))}
              </View>
            </Section>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  thinking: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingVertical: space.xl },
  example: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: radius.md },
});
