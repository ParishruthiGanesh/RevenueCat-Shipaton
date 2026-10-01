import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInUp, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { Check, Keyboard, Mic, Square, X, Zap, ZapOff } from 'lucide-react-native';
import type { CaptureMode } from '@/core/capture';
import { createEntity } from '@/core/operations';
import { softLower } from '@/core/phrasing';
import { runCapturePipeline, type RawPhoto } from '@/ai/pipeline';
import { manualDraft } from '@/ai/draft';
import { captureSession } from '@/state/capture-session';
import { useMemory } from '@/state/memory';
import { usePro } from '@/state/pro';
import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';
import { useVoice } from '@/services/voice';
import { track } from '@/services/analytics';
import { radius, space } from '@/ui/tokens';
import { Button, IconButton } from '@/ui/components/Button';
import { T } from '@/ui/components/Text';
import { useTheme } from '@/ui/theme';

const MODES: { id: CaptureMode; label: string; hint: string; max: number }[] = [
  { id: 'remember', label: 'Remember', hint: 'Show the object and where it’s going', max: 3 },
  { id: 'scan', label: 'Scan area', hint: 'Capture the whole space — add angles', max: 8 },
  { id: 'box', label: 'Box', hint: 'Photograph the contents before you close it', max: 8 },
];
const SCAN_TARGETS = ['Drawer', 'Shelf', 'Cabinet', 'Desk', 'Room', 'Box', 'Backpack', 'Suitcase'];
/** Hold-to-scan: frames captured while the shutter is held (the pipeline then selects ≤6 evenly). */
const MAX_SWEEP_FRAMES = 16;
const SWEEP_INTERVAL_MS = 450;

const STAGE_LABEL = { preparing: 'Preparing photos', analyzing: 'Finding objects and where they are', matching: 'Matching with your memory' } as const;

export default function CaptureScreen() {
  const params = useLocalSearchParams<{ mode?: CaptureMode; targetId?: string; itemId?: string; utterance?: string }>();
  const { graph } = useMemory();
  const { settings } = useSettings();
  const { require: requireFeature, recordAiScan } = usePro();
  const { signedIn, authReady, backend } = useSession();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);

  const item = params.itemId ? graph.entity(params.itemId) : undefined;
  const target = params.targetId ? graph.entity(params.targetId) : undefined;
  const [mode, setMode] = useState<CaptureMode>(params.mode ?? 'remember');
  const [scanTarget, setScanTarget] = useState<string>('Drawer');
  const [photos, setPhotos] = useState<RawPhoto[]>([]);
  const [typedUtterance, setUtterance] = useState(params.utterance ?? (item ? `Remember where I'm putting my ${softLower(item.name)}` : ''));
  const [typing, setTyping] = useState(false);
  const [torch, setTorch] = useState(false);
  const [stage, setStage] = useState<keyof typeof STAGE_LABEL | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voice = useVoice((t) => setUtterance(t));
  const flash = useSharedValue(0);
  const sweeping = useRef(false);
  const [sweepCount, setSweepCount] = useState<number | null>(null);

  // While listening, show the live transcript; the final transcript is committed via onFinal.
  const utterance = voice.state === 'listening' && voice.transcript ? voice.transcript : typedUtterance;
  const modeInfo = MODES.find((m) => m.id === mode)!;

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const spaceId = useMemo(() => {
    const spaces = graph.spaces();
    return (settings.defaultSpaceId && graph.entity(settings.defaultSpaceId)?.id) || spaces[0]?.id;
  }, [graph, settings.defaultSpaceId]);

  const shoot = async () => {
    if (!cam.current || photos.length >= modeInfo.max) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      flash.set(withSequence(withTiming(0.9, { duration: 0 }), withTiming(0, { duration: 260 })));
      const pic = await cam.current.takePictureAsync({ quality: 0.85, skipProcessing: false, shutterSound: false });
      if (pic) setPhotos((p) => [...p, { uri: pic.uri, width: pic.width, height: pic.height }]);
      if (photos.length === 0) track('scan_started', { mode });
    } catch {
      setError('Couldn’t take the photo. Try again.');
    }
  };

  /** Hold the shutter and sweep the camera: grabs a frame every ~0.7s until release (video-style scan). */
  const startSweep = async () => {
    if (!cam.current || sweeping.current) return;
    sweeping.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    track('scan_started', { mode, sweep: true });
    const frames: RawPhoto[] = [];
    setSweepCount(0);
    while (sweeping.current && frames.length < MAX_SWEEP_FRAMES && cam.current) {
      try {
        const pic = await cam.current.takePictureAsync({ quality: 0.6, skipProcessing: true, shutterSound: false });
        if (pic) {
          frames.push({ uri: pic.uri, width: pic.width, height: pic.height });
          setSweepCount(frames.length);
          Haptics.selectionAsync().catch(() => undefined);
        }
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, SWEEP_INTERVAL_MS));
    }
    sweeping.current = false;
    setSweepCount(null);
    if (frames.length) setPhotos((p) => [...p, ...frames]);
  };

  const stopSweep = () => {
    if (sweeping.current) {
      sweeping.current = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  };

  const analyze = async () => {
    if (!photos.length) return;
    if (settings.cloudAI && !requireFeature('ai_scan')) return;
    if (mode === 'box' && !target && !requireFeature('create_box')) return;
    const space = spaceId ?? createEntity(graph, { kind: 'space', name: 'Home', spaceType: 'home' }).id;
    setError(null);
    try {
      const out = await runCapturePipeline(graph, {
        photos,
        mode,
        spaceId: space,
        targetId: target?.id,
        utterance: utterance.trim() || undefined,
        scanTarget: mode === 'scan' ? scanTarget.toLowerCase() : mode === 'box' ? 'storage box' : undefined,
        cloudAI: settings.cloudAI,
        sensitiveMode: settings.sensitiveMode,
        minimizePeople: settings.minimizePeople,
        onStage: setStage,
      });
      if (out.kind === 'draft' && out.via === 'ai') recordAiScan();
      if (item && out.draft.items.length) {
        // "Update location" for a known item: bind the primary detection to it.
        out.draft.items[0] = { ...out.draft.items[0], identity: { type: 'existing', entityId: item.id }, name: item.name, matchKind: 'same' };
      }
      const notice = out.kind === 'queued' || out.kind === 'limit' ? out.reason : out.kind === 'draft' && out.via === 'manual' && settings.cloudAI ? 'Cloud analysis is unavailable, so add what you’re putting away below.' : undefined;
      captureSession.start(out.draft, out.media, out.kind === 'draft' ? out.via : 'manual', notice);
      router.replace('/capture/review');
    } catch (e) {
      setError((e as Error).message || 'Something went wrong while analysing.');
    } finally {
      setStage(null);
    }
  };

  // Capturing stores information, so it requires an account (every entry point lands here).
  if (backend && authReady && !signedIn) {
    const next = { pathname: '/capture', params: Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'string')) as Record<string, string> };
    return <Redirect href={{ pathname: '/sign-in', params: { reason: 'capture', next: JSON.stringify(next) } }} />;
  }

  // ── permission states ──
  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!permission.granted) {
    return (
      <View style={[styles.perm, { backgroundColor: c.bg, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
        <View style={{ alignSelf: 'flex-end' }}>
          <IconButton icon={X} label="Close" onPress={() => router.back()} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
          <T variant="title">The camera is how Physical Memory sees where things go.</T>
          <T variant="body" color="muted">
            Photos are only taken when you press the shutter. They stay on your phone unless cloud analysis is on, and you can delete any of them at any time.
          </T>
          {permission.canAskAgain ? (
            <Button label="Allow camera" variant="ember" size="lg" onPress={requestPermission} />
          ) : (
            <Button label="Open Settings" size="lg" onPress={() => Linking.openSettings()} />
          )}
          <Button
            label="Describe it instead"
            variant="ghost"
            icon={Keyboard}
            onPress={() => {
              const sp = spaceId ?? createEntity(graph, { kind: 'space', name: 'Home', spaceType: 'home' }).id;
              captureSession.start(manualDraft(graph, { captureId: `${Date.now()}`, mode, observedAt: new Date().toISOString(), spaceId: sp, targetId: target?.id, utterance }), [], 'manual');
              router.replace('/capture/review');
            }}
          />
        </View>
      </View>
    );
  }

  const busy = stage !== null;

  return (
    <View style={styles.root}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} mode="picture" />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }, flashStyle]} />
      <Viewfinder active={!busy} />

      {/* top bar */}
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon={X} label="Close camera" tone="glass" onPress={() => router.back()} />
        <View style={[styles.hintPill, { backgroundColor: c.cameraScrim }]}>
          <T variant="label" style={{ color: '#fff' }} numberOfLines={1}>
            {target ? `${mode === 'box' ? 'Rescanning' : 'Scanning'} ${target.name}` : item ? `Updating ${item.name}` : modeInfo.hint}
          </T>
        </View>
        <IconButton icon={torch ? ZapOff : Zap} label={torch ? 'Torch off' : 'Torch on'} tone="glass" onPress={() => setTorch((t) => !t)} />
      </View>

      {/* utterance bubble */}
      {utterance || voice.state === 'listening' || typing ? (
        <Animated.View entering={FadeInUp} exiting={FadeOut} style={[styles.bubble, { top: insets.top + 76 }]}>
          {typing ? (
            <TextInput
              value={utterance}
              onChangeText={setUtterance}
              autoFocus
              placeholder="e.g. Remember I'm putting my passport in the top drawer"
              placeholderTextColor="rgba(255,255,255,0.6)"
              onSubmitEditing={() => setTyping(false)}
              style={styles.bubbleInput}
              accessibilityLabel="What you're putting away"
            />
          ) : (
            <T variant="bodyStrong" style={{ color: '#fff' }}>
              {voice.state === 'listening' && !utterance ? 'Listening…' : `“${utterance}”`}
            </T>
          )}
        </Animated.View>
      ) : null}

      {/* busy overlay */}
      {busy ? (
        <Animated.View entering={FadeIn} style={[StyleSheet.absoluteFill, styles.busy, { backgroundColor: c.cameraScrim }]}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {photos.slice(0, 4).map((p) => (
              <Image key={p.uri} source={{ uri: p.uri }} style={styles.busyThumb} />
            ))}
          </View>
          <ScanBar />
          {(['preparing', 'analyzing', 'matching'] as const).map((s) => {
            const idx = ['preparing', 'analyzing', 'matching'].indexOf(stage!);
            const mine = ['preparing', 'analyzing', 'matching'].indexOf(s);
            return (
              <View key={s} style={styles.stageRow}>
                <View style={[styles.stageDot, { backgroundColor: mine < idx ? '#fff' : mine === idx ? c.ember : 'rgba(255,255,255,0.3)' }]}>{mine < idx ? <Check size={10} color="#000" /> : null}</View>
                <T variant="bodyStrong" style={{ color: mine <= idx ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                  {STAGE_LABEL[s]}
                </T>
              </View>
            );
          })}
        </Animated.View>
      ) : null}

      {/* bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {error ? (
          <View style={[styles.error, { backgroundColor: c.danger }]}>
            <T variant="label" style={{ color: '#fff' }}>
              {error}
            </T>
          </View>
        ) : null}

        {sweepCount !== null ? (
          <View style={[styles.sweepPill, { backgroundColor: c.ember }]}>
            <View style={styles.recDot} />
            <T variant="label" style={{ color: '#fff' }}>
              {`Scanning · ${sweepCount} ${sweepCount === 1 ? 'frame' : 'frames'} — move slowly, release to finish`}
            </T>
          </View>
        ) : photos.length === 0 ? (
          <T variant="caption" align="center" style={{ color: 'rgba(255,255,255,0.8)' }}>
            Tap for a photo · hold to sweep-scan the whole area
          </T>
        ) : null}

        {mode === 'scan' && !target ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.xl }}>
            {SCAN_TARGETS.map((t) => (
              <Pressable key={t} onPress={() => setScanTarget(t)} style={[styles.targetChip, { backgroundColor: scanTarget === t ? '#fff' : 'rgba(255,255,255,0.16)' }]} accessibilityRole="button" accessibilityState={{ selected: scanTarget === t }}>
                <T variant="label" style={{ color: scanTarget === t ? '#000' : '#fff' }}>
                  {`Scan ${t.toLowerCase()}`}
                </T>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {photos.length ? (
          <ScrollView horizontal contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.xl }} showsHorizontalScrollIndicator={false}>
            {photos.map((p, i) => (
              <Pressable key={p.uri} onLongPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} accessibilityLabel={`Photo ${i + 1}. Long press to remove.`}>
                <Image source={{ uri: p.uri }} style={styles.thumb} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.controls}>
          <View style={styles.sideCtl}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voice.state === 'listening' ? 'Stop listening' : 'Say what you’re doing'}
              onPress={() => (voice.state === 'listening' ? voice.stop() : voice.state === 'unavailable' || voice.state === 'denied' ? setTyping(true) : voice.start())}
              onLongPress={() => setTyping(true)}
              style={[styles.side, { backgroundColor: voice.state === 'listening' ? c.ember : 'rgba(255,255,255,0.18)' }]}
            >
              {voice.state === 'listening' ? <Square size={18} color="#fff" fill="#fff" /> : <Mic size={22} color="#fff" />}
            </Pressable>
            <T variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {voice.state === 'unavailable' ? 'Type' : 'Say it'}
            </T>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo. Hold to sweep-scan."
            accessibilityHint="Tap for one photo, or hold and move the camera slowly to scan a whole area"
            onPress={shoot}
            onLongPress={startSweep}
            delayLongPress={300}
            onPressOut={stopSweep}
            disabled={busy}
            style={[styles.shutterOuter, sweepCount !== null && { borderColor: c.ember }]}
          >
            <View
              style={[
                styles.shutterInner,
                { backgroundColor: sweepCount !== null ? c.ember : photos.length >= modeInfo.max ? 'rgba(255,255,255,0.4)' : '#fff' },
                sweepCount !== null && { width: 40, height: 40, borderRadius: 10 },
              ]}
            />
            {photos.length ? (
              <View style={[styles.count, { backgroundColor: c.ember }]}>
                <T variant="caption" style={{ color: '#fff', fontFamily: 'Inter_700Bold' }}>
                  {photos.length}
                </T>
              </View>
            ) : null}
          </Pressable>

          <View style={styles.sideCtl}>
            <Pressable accessibilityRole="button" accessibilityLabel="Done — analyse photos" onPress={analyze} disabled={!photos.length || busy} style={[styles.side, { backgroundColor: photos.length ? c.ember : 'rgba(255,255,255,0.18)', opacity: photos.length ? 1 : 0.5 }]}>
              <Check size={24} color="#fff" />
            </Pressable>
            <T variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Done
            </T>
          </View>
        </View>

        {!target && !item ? (
          <View style={styles.modes}>
            {MODES.map((m) => (
              <Pressable key={m.id} onPress={() => { setMode(m.id); setPhotos([]); }} accessibilityRole="tab" accessibilityState={{ selected: mode === m.id }} style={[styles.mode, mode === m.id && { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <T variant="label" style={{ color: mode === m.id ? '#fff' : 'rgba(255,255,255,0.65)', fontFamily: mode === m.id ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>
                  {m.label}
                </T>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Soft corner brackets: frames the subject without a harsh box. */
function Viewfinder({ active }: { active: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);
  const s = useAnimatedStyle(() => ({ opacity: active ? 0.55 + pulse.value * 0.35 : 0 }));
  const corner = (pos: object) => <View style={[styles.corner, pos]} />;
  return (
    <Animated.View pointerEvents="none" style={[styles.finder, s]}>
      {corner({ top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 22 })}
      {corner({ top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 22 })}
      {corner({ bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 22 })}
      {corner({ bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 22 })}
    </Animated.View>
  );
}

function ScanBar() {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }), -1, true);
  }, [x]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateX: -90 + x.value * 180 }] }));
  return (
    <View style={styles.scanTrack}>
      <Animated.View style={[styles.scanFill, s]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  perm: { flex: 1, paddingHorizontal: space.xl },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, gap: space.sm },
  hintPill: { flexShrink: 1, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill },
  bubble: { position: 'absolute', left: space.xl, right: space.xl, backgroundColor: 'rgba(20,18,15,0.62)', borderRadius: radius.lg, padding: space.md },
  bubbleInput: { color: '#fff', fontSize: 16, fontFamily: 'Inter_500Medium', minHeight: 24 },
  finder: { position: 'absolute', top: '22%', left: '9%', right: '9%', bottom: '34%' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: '#fff' },
  busy: { alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xxl },
  busyThumb: { width: 58, height: 58, borderRadius: radius.md, borderWidth: 2, borderColor: '#fff' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'stretch', paddingHorizontal: space.xl },
  stageDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  scanTrack: { width: 180, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  scanFill: { width: 60, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: space.md },
  error: { marginHorizontal: space.xl, padding: space.md, borderRadius: radius.md },
  targetChip: { paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill },
  thumb: { width: 54, height: 54, borderRadius: radius.md, borderWidth: 2, borderColor: '#fff' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: space.xl },
  sideCtl: { alignItems: 'center', gap: 6, width: 72 },
  side: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  shutterOuter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 66, height: 66, borderRadius: 33 },
  sweepPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: radius.pill },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  count: { position: 'absolute', top: -4, right: -4, minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  modes: { flexDirection: 'row', alignSelf: 'center', gap: space.xs, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, padding: 4 },
  mode: { paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: radius.pill },
});
