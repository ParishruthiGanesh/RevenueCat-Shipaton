import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Lock } from 'lucide-react-native';
import type { MediaAsset } from '@/core/types';
import { supabase } from '@/services/supabase';
import { useTheme } from '../theme';
import { radius } from '../tokens';
import { ObjectGlyph } from './ObjectGlyph';

const signedCache = new Map<string, { url: string; exp: number }>();

async function signedUrl(path: string): Promise<string | null> {
  const hit = signedCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.storage.from('media').createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  signedCache.set(path, { url: data.signedUrl, exp: Date.now() + 3500e3 });
  return data.signedUrl;
}

/**
 * Visual evidence. Local file first; restored-from-cloud media via short-lived signed URL.
 * Sensitive objects are blurred by default until the user reveals them.
 */
export function EvidenceImage({
  media,
  name,
  category,
  size,
  style,
  rounded = radius.lg,
  sensitive,
  revealed,
}: {
  media?: MediaAsset;
  name?: string;
  category?: string;
  size?: number;
  style?: ViewStyle;
  rounded?: number;
  sensitive?: boolean;
  revealed?: boolean;
}) {
  const { c } = useTheme();
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    if (media?.localUri || !media?.remotePath) return;
    const path = media.remotePath;
    let live = true;
    signedUrl(path).then((url) => live && setSigned({ path, url }));
    return () => {
      live = false;
    };
  }, [media?.localUri, media?.remotePath]);
  const uri = media?.localUri || (signed && signed.path === media?.remotePath ? signed.url : null);

  const dims: ViewStyle = size ? { width: size, height: size } : {};
  const hide = sensitive && !revealed;
  return (
    <View style={[{ borderRadius: rounded, overflow: 'hidden', backgroundColor: c.surfaceMuted }, dims, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} blurRadius={hide ? 28 : 0} accessibilityLabel={name ? `Photo of ${name}` : 'Evidence photo'} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <ObjectGlyph name={name} category={category} size={(size ?? 80) * 0.42} />
        </View>
      )}
      {hide && uri ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Lock size={Math.max(14, (size ?? 60) * 0.22)} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}
