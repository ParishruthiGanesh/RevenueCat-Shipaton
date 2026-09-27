import React from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { MemoryGraph } from '@/core/graph';
import type { Entity } from '@/core/types';
import { contentsOf } from '@/core/queries';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { T } from './Text';
import { qrSvg } from '../qr';

export const boxUrl = (box: Entity) => `pm://box/${box.box!.code}`;

/**
 * Printable storage-box label. The QR encodes only an opaque code (never contents), so a
 * label on a box in a shared storage unit reveals nothing without the owner's phone.
 */
export function BoxLabel({ graph, box }: { graph: MemoryGraph; box: Entity }) {
  const { c } = useTheme();
  const n = contentsOf(graph, box.id, { recursive: true }).length;
  return (
    <View style={[styles.label, { backgroundColor: '#FFFDFA', borderColor: c.lineStrong }]} accessible accessibilityLabel={`Label for ${box.name}. QR code.`}>
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="overline" style={{ color: '#6F695F' }}>
          Physical Memory
        </T>
        <T variant="hero" style={{ color: '#1D1B18', fontSize: 54, lineHeight: 58 }}>
          {box.box!.number}
        </T>
        <T variant="subheading" style={{ color: '#1D1B18' }}>
          {box.box!.category ?? 'Storage box'}
        </T>
        <T variant="caption" style={{ color: '#6F695F' }}>
          {n} {n === 1 ? 'item' : 'items'} · scan to see contents
        </T>
        <T variant="caption" style={{ color: '#9A9387', fontFamily: 'Inter_600SemiBold', letterSpacing: 2 }}>
          {box.box!.code}
        </T>
      </View>
      <QRCode value={boxUrl(box)} size={116} backgroundColor="#FFFDFA" color="#1D1B18" />
    </View>
  );
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Render a print-ready label (QR generated locally as SVG) and open the system share/print sheet. */
export async function printBoxLabel(graph: MemoryGraph, box: Entity): Promise<void> {
  const items = contentsOf(graph, box.id, { recursive: true }).filter((x) => !x.entity.sensitive);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"/>
<style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:0;padding:28px;color:#1D1B18}
.l{border:2px solid #1D1B18;border-radius:18px;padding:24px;display:flex;justify-content:space-between;align-items:center;width:540px}
.n{font-size:120px;font-weight:700;line-height:1;margin:6px 0}
.o{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6F695F}
.c{font-size:22px;font-weight:600}.k{font-size:13px;letter-spacing:3px;color:#9A9387;margin-top:8px}
.list{margin-top:18px;font-size:12px;color:#6F695F;width:540px}
</style></head><body>
<div class="l"><div><div class="o">Physical Memory</div><div class="n">${box.box!.number}</div>
<div class="c">${escape(box.box!.category ?? 'Storage box')}</div><div class="k">${box.box!.code}</div></div>
${qrSvg(boxUrl(box), 200)}</div>
<div class="list">Packing list (keep inside the box, not on the outside): ${items.map((i) => escape(i.entity.name)).join(', ') || '—'}</div>
</body></html>`;
  try {
    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Label for ${box.name}`, UTI: 'com.adobe.pdf' });
    else await Print.printAsync({ uri });
  } catch {
    await Print.printAsync({ html });
  }
}

const styles = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xl, borderRadius: radius.xl, borderWidth: 2 },
});
