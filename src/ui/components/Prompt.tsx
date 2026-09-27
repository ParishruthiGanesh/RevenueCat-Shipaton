import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { Button } from './Button';
import { T } from './Text';

export interface PromptSpec {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirm?: string;
  suggestions?: string[];
  onSubmit: (value: string) => void;
}

/** Cross-platform single-field prompt (Alert.prompt is iOS-only). */
export function Prompt({ spec, onClose }: { spec: PromptSpec | null; onClose: () => void }) {
  return (
    <Modal visible={!!spec} transparent animationType="fade" onRequestClose={onClose}>
      {spec ? <PromptBody key={`${spec.title}|${spec.initial ?? ''}`} spec={spec} onClose={onClose} /> : null}
    </Modal>
  );
}

function PromptBody({ spec, onClose }: { spec: PromptSpec; onClose: () => void }) {
  const { c } = useTheme();
  const [value, setValue] = useState(spec.initial ?? '');
  const submit = () => {
    if (!value.trim()) return;
    spec.onSubmit(value.trim());
    onClose();
  };
  return (
    <>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, { backgroundColor: c.bgElevated }]}>
          <T variant="heading">{spec.title}</T>
          {spec.message ? (
            <T variant="callout" color="muted">
              {spec.message}
            </T>
          ) : null}
          <TextInput value={value} onChangeText={setValue} autoFocus placeholder={spec.placeholder} placeholderTextColor={c.faint} onSubmitEditing={submit} returnKeyType="done" style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]} accessibilityLabel={spec.title} />
          {spec.suggestions?.length ? (
            <View style={styles.sugg}>
              {spec.suggestions.map((s) => (
                <Pressable key={s} onPress={() => setValue(s)} style={[styles.chip, { borderColor: c.line }]}>
                  <T variant="caption">{s}</T>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button label={spec.confirm ?? 'Save'} onPress={submit} disabled={!value.trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { margin: space.md, borderRadius: radius.xxl, padding: space.xl, gap: space.md },
  input: { height: 50, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontSize: 16, fontFamily: 'Inter_500Medium' },
  sugg: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
});
