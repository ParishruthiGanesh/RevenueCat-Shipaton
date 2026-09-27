import { useSyncExternalStore } from 'react';
import type { CommitResult } from '@/core/capture';
import type { MediaAsset } from '@/core/types';
import type { DraftCapture, DraftItem } from '@/ai/draft';

/**
 * Ephemeral state for one capture → review → result flow. Kept outside React state so the
 * camera, review and result screens (separate routes) share it without prop drilling.
 */

export interface CaptureSession {
  draft: DraftCapture | null;
  media: MediaAsset[];
  via: 'ai' | 'manual' | null;
  notice?: string;
  result: CommitResult | null;
}

let state: CaptureSession = { draft: null, media: [], via: null, result: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const captureSession = {
  get: () => state,
  start(draft: DraftCapture, media: MediaAsset[], via: 'ai' | 'manual', notice?: string) {
    state = { draft, media, via, notice, result: null };
    emit();
  },
  updateDraft(fn: (d: DraftCapture) => DraftCapture) {
    if (!state.draft) return;
    state = { ...state, draft: fn(state.draft) };
    emit();
  },
  updateItem(key: string, patch: Partial<DraftItem>) {
    captureSession.updateDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  },
  finish(result: CommitResult) {
    state = { ...state, result };
    emit();
  },
  clear() {
    state = { draft: null, media: [], via: null, result: null };
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useCaptureSession(): CaptureSession {
  return useSyncExternalStore(captureSession.subscribe, captureSession.get, captureSession.get);
}
