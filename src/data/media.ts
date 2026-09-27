import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import type { BoundingBox, MediaAsset } from '@/core/types';
import { newId, nowIso } from '@/core/ids';

/**
 * Evidence media lives in the app's private documents directory. Frames are downscaled to the
 * vision model's sweet spot; object crops become thumbnails/evidence. When people appear and
 * "minimise people" is on, only crops are kept and the full frame is deleted.
 */

const MAX_EDGE = 1568; // Claude vision's recommended long edge
const CROP_MIN_PX = 160;

function mediaDir(): Directory {
  const d = new Directory(Paths.document, 'media');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export interface PreparedFrame {
  asset: MediaAsset;
  base64: string;
}

/** Downscale + JPEG-encode a camera photo, persist it, and return base64 for analysis. */
export async function prepareFrame(uri: string, width: number, height: number): Promise<PreparedFrame> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  const img = await ctx.renderAsync();
  const saved = await img.saveAsync({ compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  const id = newId();
  const dest = new File(mediaDir(), `${id}.jpg`);
  new File(saved.uri).copy(dest);
  return {
    asset: { id, localUri: dest.uri, width: saved.width, height: saved.height, kind: 'frame', containsPeople: false, createdAt: nowIso() },
    base64: saved.base64 ?? '',
  };
}

/** Cut an evidence crop around a detection (with padding). */
export async function cropEvidence(frame: MediaAsset, bbox: BoundingBox, pad = 0.12): Promise<MediaAsset | null> {
  const x = Math.max(0, bbox.x - bbox.w * pad);
  const y = Math.max(0, bbox.y - bbox.h * pad);
  const w = Math.min(1 - x, bbox.w * (1 + 2 * pad));
  const h = Math.min(1 - y, bbox.h * (1 + 2 * pad));
  const px = { originX: Math.round(x * frame.width), originY: Math.round(y * frame.height), width: Math.round(w * frame.width), height: Math.round(h * frame.height) };
  if (px.width < CROP_MIN_PX / 2 || px.height < CROP_MIN_PX / 2) return null;
  try {
    const ctx = ImageManipulator.ImageManipulator.manipulate(frame.localUri);
    ctx.crop(px);
    if (Math.max(px.width, px.height) > 640) {
      const s = 640 / Math.max(px.width, px.height);
      ctx.resize({ width: Math.round(px.width * s), height: Math.round(px.height * s) });
    }
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    const id = newId();
    const dest = new File(mediaDir(), `${id}.jpg`);
    new File(saved.uri).copy(dest);
    return { id, localUri: dest.uri, width: saved.width, height: saved.height, kind: 'crop', parentMediaId: frame.id, containsPeople: false, createdAt: nowIso() };
  } catch {
    return null;
  }
}

export function deleteMediaFile(asset: Pick<MediaAsset, 'localUri'>): void {
  try {
    const f = new File(asset.localUri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

export async function readBase64(asset: Pick<MediaAsset, 'localUri'>): Promise<string> {
  return new File(asset.localUri).base64();
}

export function wipeMedia(): void {
  const d = new Directory(Paths.document, 'media');
  if (d.exists) d.delete();
}
