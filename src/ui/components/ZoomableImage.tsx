import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { BoundingBox } from '@/core/types';

const MIN = 1;
const MAX = 6;
const SPRING = { damping: 20, stiffness: 180 };

/**
 * Immersive evidence viewer: pinch to zoom (1–6×), drag to explore, double-tap to zoom in/out,
 * with a subtle 3D tilt that follows your finger so the photo feels like an object you can turn.
 * Optionally outlines the detected object.
 */
export function ZoomableImage({ uri, aspect, bbox, accessibilityLabel }: { uri: string; aspect: number; bbox?: BoundingBox; accessibilityLabel?: string }) {
  const { width: W, height: H } = useWindowDimensions();
  // Fit the photo inside the screen.
  const fitW = Math.min(W, H * aspect);
  const fitH = fitW / aspect;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);

  const clamp = (v: number, lim: number) => {
    'worklet';
    return Math.min(lim, Math.max(-lim, v));
  };
  const limits = (s: number) => {
    'worklet';
    return { x: Math.max(0, (fitW * s - W) / 2 + 40), y: Math.max(0, (fitH * s - H) / 2 + 40) };
  };
  const settle = () => {
    'worklet';
    const s = Math.min(MAX, Math.max(MIN, scale.get()));
    const l = limits(s);
    scale.set(withSpring(s, SPRING));
    savedScale.set(s);
    const nx = s === 1 ? 0 : clamp(tx.get(), l.x);
    const ny = s === 1 ? 0 : clamp(ty.get(), l.y);
    tx.set(withSpring(nx, SPRING));
    ty.set(withSpring(ny, SPRING));
    savedTx.set(nx);
    savedTy.set(ny);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(Math.min(MAX * 1.2, Math.max(MIN * 0.8, savedScale.get() * e.scale)));
    })
    .onEnd(settle);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.get() > 1.01) {
        tx.set(savedTx.get() + e.translationX);
        ty.set(savedTy.get() + e.translationY);
      }
      // 3D tilt follows the finger (stronger when not zoomed).
      const k = savedScale.get() > 1.01 ? 0.015 : 0.05;
      tiltY.set(clamp(e.translationX * k, 12));
      tiltX.set(clamp(-e.translationY * k, 12));
    })
    .onEnd(() => {
      tiltX.set(withSpring(0, SPRING));
      tiltY.set(withSpring(0, SPRING));
      settle();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.get() > 1.01) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        savedScale.set(1);
        savedTx.set(0);
        savedTy.set(0);
      } else {
        // Zoom into the tapped point.
        const s = 2.5;
        const l = limits(s);
        const nx = clamp((W / 2 - e.x) * (s - 1), l.x);
        const ny = clamp((H / 2 - e.y) * (s - 1), l.y);
        scale.set(withTiming(s));
        tx.set(withTiming(nx));
        ty.set(withTiming(ny));
        savedScale.set(s);
        savedTx.set(nx);
        savedTy.set(ny);
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateX: tx.get() },
      { translateY: ty.get() },
      { rotateX: `${tiltX.get()}deg` },
      { rotateY: `${tiltY.get()}deg` },
      { scale: scale.get() },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.stage} collapsable={false}>
        <Animated.View style={[{ width: fitW, height: fitH }, styles.card, style]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={160} accessibilityLabel={accessibilityLabel} />
          {bbox ? <View pointerEvents="none" style={[styles.bbox, { left: bbox.x * fitW, top: bbox.y * fitH, width: bbox.w * fitW, height: bbox.h * fitH }]} /> : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  card: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 16 },
  bbox: { position: 'absolute', borderWidth: 2.5, borderColor: '#EE7A4A', borderRadius: 10 },
});
