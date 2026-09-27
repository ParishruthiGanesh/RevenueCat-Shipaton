import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { AskResult } from '@/core/ask';
import type { MemoryGraph } from '@/core/graph';
import { Camera } from 'lucide-react-native';
import { space } from '../tokens';
import { AnswerCard } from './AnswerCard';
import { Button } from './Button';
import { Card } from './Layout';
import { ObjectCard } from './ObjectCard';
import { T } from './Text';
import { Timeline } from './Timeline';

/** Renders any structured answer. No free-form model text reaches this view. */
export function AskResultView({ graph, result, simple }: { graph: MemoryGraph; result: AskResult; simple?: boolean }) {
  switch (result.type) {
    case 'item':
      return (
        <View style={{ gap: space.md }}>
          <AnswerCard graph={graph} entity={result.entity} belief={result.belief} answer={result.answer} note={result.note} simple={simple} />
          {result.others.length ? (
            <>
              <T variant="overline" color="muted" style={{ marginTop: space.md }}>
                You have more than one
              </T>
              {result.others.map((h) => (
                <ObjectCard key={h.entity.id} graph={graph} entity={h.entity} belief={h.belief} />
              ))}
            </>
          ) : null}
        </View>
      );
    case 'candidates':
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.md }}>
          <T variant="heading">{result.message}</T>
          <T variant="callout" color="muted">
            I’d rather show you the options than guess.
          </T>
          {result.hits.map((h) => (
            <ObjectCard key={h.entity.id} graph={graph} entity={h.entity} belief={h.belief} />
          ))}
        </Animated.View>
      );
    case 'contents':
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.md }}>
          <Card onPress={() => router.push(`/place/${result.place.id}`)} tone="muted">
            <T variant="overline" color="muted">
              {result.place.box ? `Storage box #${result.place.box.number}` : 'Place'}
            </T>
            <T variant="heading">{result.place.name}</T>
            <T variant="callout" color="muted">
              {result.message}
            </T>
          </Card>
          {result.entries.map((e) => (
            <ObjectCard key={e.entity.id} graph={graph} entity={e.entity} belief={e.belief} />
          ))}
        </Animated.View>
      );
    case 'history':
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.lg }}>
          <Card>
            <T variant="overline" color="muted">
              {result.entity.name}
            </T>
            <T variant="heading" style={{ marginTop: space.xs }}>
              {result.message}
            </T>
          </Card>
          <Timeline graph={graph} entries={result.entries} sensitive={result.entity.sensitive} />
          <Button label={`Open ${result.entity.name}`} variant="secondary" onPress={() => router.push(`/item/${result.entity.id}`)} />
        </Animated.View>
      );
    case 'usual':
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.md }}>
          <Card>
            <T variant="overline" color="muted">
              {result.entity.name}
            </T>
            <T variant="heading" style={{ marginTop: space.xs }}>
              {result.message}
            </T>
          </Card>
          <ObjectCard graph={graph} entity={result.entity} belief={result.belief} subtitle="Where it was last seen" />
        </Animated.View>
      );
    case 'list':
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.md }}>
          <T variant="heading">{result.title}</T>
          <T variant="callout" color="muted">
            {result.message}
          </T>
          {result.rows.map((r) => (
            <ObjectCard key={r.entity.id} graph={graph} entity={r.entity} belief={r.belief} subtitle={r.subtitle} />
          ))}
        </Animated.View>
      );
    case 'changes': {
      const ch = result.changes;
      const groups: [string, { id: string; name: string }[]][] = [
        ['Added', ch.added],
        ['No longer detected', ch.noLongerDetected],
        ['Moved in', ch.movedIn.map((m) => m.entity)],
        ['Moved out', ch.movedOut.map((m) => m.entity)],
      ];
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.md }}>
          <T variant="heading">What changed in {result.place.name}</T>
          <T variant="callout" color="muted">
            {result.message}
          </T>
          {groups
            .filter(([, list]) => list.length)
            .map(([label, list]) => (
              <Card key={label}>
                <T variant="overline" color="muted">
                  {label}
                </T>
                {list.map((e) => (
                  <T key={e.id} variant="bodyStrong" style={{ marginTop: space.xs }} onPress={() => router.push(`/item/${e.id}`)}>
                    {e.name}
                  </T>
                ))}
              </Card>
            ))}
          {ch.noLongerDetected.length ? (
            <T variant="caption" color="muted">
              Not being detected in a scan doesn’t mean something is gone — it may have been out of view.
            </T>
          ) : null}
        </Animated.View>
      );
    }
    case 'none':
      return (
        <Animated.View entering={FadeIn} style={{ gap: space.md }}>
          <T variant="heading">{result.message}</T>
          <Button label="Remember something now" icon={Camera} variant="ember" onPress={() => router.push('/capture')} />
        </Animated.View>
      );
  }
}
