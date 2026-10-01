import React, { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Mic, Search, Square, X } from 'lucide-react-native';
import { useVoice } from '@/services/voice';
import { useTheme } from '../theme';
import { fonts, radius, shadow, space } from '../tokens';

/** "Ask Physical Memory" — type or speak. Voice is first-class, not an afterthought. */
export function AskBar({ value, onChangeText, onSubmit, onClear, placeholder = 'Where did I put…', autoFocus, onFocus }: { value: string; onChangeText: (t: string) => void; onSubmit: (t: string) => void; onClear?: () => void; placeholder?: string; autoFocus?: boolean; onFocus?: () => void }) {
  const { c, scale } = useTheme();
  const voice = useVoice((final) => {
    onChangeText(final);
    onSubmit(final);
  });
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (voice.state === 'listening') onChangeText(voice.transcript);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript]);

  useEffect(() => {
    pulse.value = voice.state === 'listening' ? withRepeat(withSequence(withTiming(1.18, { duration: 520 }), withTiming(1, { duration: 520 })), -1) : withTiming(1);
  }, [voice.state, pulse]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: voice.state === 'listening' ? 0.35 : 0 }));

  const listening = voice.state === 'listening';
  return (
    <View style={[styles.wrap, { backgroundColor: c.surface, borderColor: c.line }, shadow.card]}>
      <Search size={20} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => value.trim() && onSubmit(value.trim())}
        onFocus={onFocus}
        placeholder={listening ? 'Listening…' : placeholder}
        placeholderTextColor={c.faint}
        returnKeyType="search"
        autoFocus={autoFocus}
        accessibilityLabel="Ask where something is"
        style={[styles.input, { color: c.ink, fontSize: 17 * scale }]}
      />
      {value && !listening ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear" hitSlop={10} onPress={() => (onClear ? onClear() : onChangeText(''))} style={[styles.clear, { backgroundColor: c.surfaceMuted }]}>
          <X size={14} color={c.muted} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop listening' : 'Ask by voice'}
        onPress={() => (listening ? voice.stop() : voice.start())}
        hitSlop={8}
        style={styles.micWrap}
      >
        <Animated.View style={[styles.ring, { backgroundColor: c.ember }, ring]} />
        <View style={[styles.mic, { backgroundColor: listening ? c.ember : c.ink }]}>{listening ? <Square size={14} color="#fff" fill="#fff" /> : <Mic size={18} color={c.inverse} />}</View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, paddingLeft: space.lg, paddingRight: 6, height: 60 },
  input: { flex: 1, fontFamily: fonts.medium, height: '100%' },
  clear: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  micWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 48, height: 48, borderRadius: 24 },
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
