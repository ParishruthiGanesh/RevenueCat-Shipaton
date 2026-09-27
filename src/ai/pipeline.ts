import type { MemoryGraph } from '@/core/graph';
import { newId, nowIso } from '@/core/ids';
import type { ID, MediaAsset } from '@/core/types';
import type { CaptureMode } from '@/core/capture';
import { SceneAnalysis, clampAnalysis, type AnalyzeRequestT, type SceneAnalysisT } from '../../supabase/functions/_shared/scene-schema';
import { cropEvidence, deleteMediaFile, prepareFrame, type PreparedFrame } from '@/data/media';
import { enqueueCapture } from '@/data/db';
import { BackendError, invoke } from '@/services/supabase';
import { features } from '@/services/env';
import { buildDraft, manualDraft, type DraftCapture } from './draft';

/**
 * CAPTURE PIPELINE (client side)
 *
 *   camera photos
 *   → frame selection (≤ 6, evenly spaced across a burst)
 *   → downscale / encode
 *   → cloud perception (analyze-scene) — or manual path if cloud AI is off / offline
 *   → evidence crops per object (people-minimising if enabled)
 *   → draft for user review (re-identification against the memory graph)
 */

export interface RawPhoto {
  uri: string;
  width: number;
  height: number;
}

export interface PipelineInput {
  photos: RawPhoto[];
  mode: CaptureMode;
  spaceId: ID;
  targetId?: ID;
  utterance?: string;
  scanTarget?: string;
  cloudAI: boolean;
  sensitiveMode: boolean;
  minimizePeople: boolean;
  /** Real pipeline stages, surfaced in the UI as progress. */
  onStage?: (stage: 'preparing' | 'analyzing' | 'matching') => void;
}

export type PipelineOutcome =
  | { kind: 'draft'; draft: DraftCapture; media: MediaAsset[]; via: 'ai' | 'manual'; remainingFree?: number | null }
  | { kind: 'queued'; draft: DraftCapture; media: MediaAsset[]; reason: string }
  | { kind: 'limit'; draft: DraftCapture; media: MediaAsset[]; reason: string };

const MAX_FRAMES = 6;

export function selectFrames<T>(frames: T[], max = MAX_FRAMES): T[] {
  if (frames.length <= max) return frames;
  const step = (frames.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => frames[Math.round(i * step)]);
}

export function knownPlaceNames(graph: MemoryGraph): string[] {
  return graph
    .entities((e) => e.kind === 'room' || e.kind === 'fixture' || e.kind === 'container')
    .filter((e) => !e.privateZone)
    .map((e) => e.name)
    .slice(0, 200);
}

async function analyze(frames: PreparedFrame[], input: PipelineInput, graph: MemoryGraph): Promise<{ analysis: SceneAnalysisT; remainingFree: number | null }> {
  const body: AnalyzeRequestT = {
    mode: input.mode,
    frames: frames.map((f) => ({ mediaType: 'image/jpeg', data: f.base64 })),
    utterance: input.utterance,
    knownPlaces: knownPlaceNames(graph),
    sensitiveMode: input.sensitiveMode,
    scanTarget: input.scanTarget,
  };
  const res = await invoke<{ analysis: unknown; remainingFree: number | null }>('analyze-scene', body, 90_000);
  // Validate again on the client: never trust the wire.
  const analysis = clampAnalysis(SceneAnalysis.parse(res.analysis), frames.length);
  return { analysis, remainingFree: res.remainingFree };
}

export async function runCapturePipeline(graph: MemoryGraph, input: PipelineInput): Promise<PipelineOutcome> {
  const captureId = newId();
  const observedAt = nowIso();
  const ctx = { captureId, mode: input.mode, observedAt, spaceId: input.spaceId, utterance: input.utterance, targetId: input.targetId };

  input.onStage?.('preparing');
  const frames = await Promise.all(selectFrames(input.photos).map((p) => prepareFrame(p.uri, p.width, p.height)));
  const frameAssets = frames.map((f) => f.asset);

  const manual = (): DraftCapture => {
    const d = manualDraft(graph, ctx);
    d.items = d.items.map((i) => ({ ...i, mediaId: frameAssets[0]?.id }));
    return d;
  };

  if (!input.cloudAI || !features.backend) {
    return { kind: 'draft', draft: manual(), media: frameAssets, via: 'manual' };
  }

  let analysis: SceneAnalysisT;
  let remainingFree: number | null = null;
  try {
    input.onStage?.('analyzing');
    ({ analysis, remainingFree } = await analyze(frames, input, graph));
  } catch (e) {
    const err = e as BackendError;
    if (err.code === 'ai_limit_reached') return { kind: 'limit', draft: manual(), media: frameAssets, reason: err.message };
    if (err.code === 'network' || err.code === 'timeout') {
      // Keep the capture; analyse automatically when back online.
      await enqueueCapture(captureId, { input: { ...input, photos: [] }, frames: frameAssets, ctx });
      return { kind: 'queued', draft: manual(), media: frameAssets, reason: 'You’re offline. The photos are saved and will be analysed when you reconnect.' };
    }
    return { kind: 'draft', draft: manual(), media: frameAssets, via: 'manual' };
  }

  input.onStage?.('matching');
  const draft = buildDraft(graph, analysis, ctx);

  // Evidence crops: each object gets a thumbnail cut from the frame where it is clearest.
  const media: MediaAsset[] = [];
  for (const item of draft.items) {
    const frame = frameAssets[item.frameIndex] ?? frameAssets[0];
    let crop: MediaAsset | null = null;
    if (item.bbox && frame) crop = await cropEvidence(frame, item.bbox);
    if (crop) media.push(crop);
    item.mediaId = crop?.id ?? (draft.peoplePresent && input.minimizePeople ? undefined : frame?.id);
  }

  if (draft.peoplePresent && input.minimizePeople) {
    // Privacy: discard full frames containing people; keep only object crops.
    frameAssets.forEach(deleteMediaFile);
  } else {
    media.push(...frameAssets.map((f) => ({ ...f, containsPeople: draft.peoplePresent })));
  }

  return { kind: 'draft', draft, media, via: 'ai', remainingFree };
}
