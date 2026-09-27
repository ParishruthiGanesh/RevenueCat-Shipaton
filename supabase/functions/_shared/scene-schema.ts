import { z } from 'zod';

/**
 * Structured scene understanding returned by the vision stage.
 *
 * Shared by the Edge Function (Deno; `zod` mapped in deno.json) and the mobile app (Metro),
 * so request/response validation can never drift between the two.
 *
 * Kept within the structured-outputs JSON Schema subset: no numeric min/max, no regex.
 * Ranges are enforced after parsing (see clampAnalysis).
 */

export const BBox = z.object({
  x: z.number().describe('left edge, 0..1 of frame width'),
  y: z.number().describe('top edge, 0..1 of frame height'),
  w: z.number().describe('width, 0..1'),
  h: z.number().describe('height, 0..1'),
});

export const Attributes = z.object({
  colors: z.array(z.string()).describe('dominant colours, simple words: black, white, silver, blue…'),
  brand: z.string().nullable().describe('only if a logo or brand is clearly legible; otherwise null'),
  model: z.string().nullable(),
  material: z.string().nullable(),
  shape: z.string().nullable(),
  sizeClass: z.enum(['tiny', 'small', 'medium', 'large', 'huge']),
  distinguishingMarks: z.array(z.string()).describe('stickers, scratches, engravings, tags that identify THIS instance'),
});

export const PlaceKind = z.enum(['room', 'fixture', 'container']);

export const ScenePlace = z.object({
  ref: z.string().describe('short id like "p1"'),
  kind: PlaceKind.describe('room; fixture = furniture/appliance (dresser, desk, shelf unit); container = drawer, box, shelf level, cabinet compartment, bag'),
  label: z.string().describe('natural name, e.g. "Top drawer", "Black dresser", "Bedroom"'),
  description: z.string(),
  parentRef: z.string().nullable().describe('ref of the place that holds this one, or null if outermost visible'),
  confidence: z.number(),
});

export const SceneObject = z.object({
  ref: z.string().describe('short id like "o1"'),
  label: z.string().describe('specific everyday name: "USB-C to HDMI adapter" not "electronic device"'),
  category: z.string().describe('broad category path, e.g. "electronics/charger", "documents", "kitchen"'),
  visualDescription: z.string().describe('one sentence a person could use to recognise this exact object'),
  attributes: Attributes,
  isContainer: z.boolean().describe('true if it can hold other objects (pouch, bag, box, case)'),
  sensitive: z.boolean().describe('passport, ID, bank card, medication, legal/medical/financial documents'),
  placement: z.object({
    parentRef: z.string().nullable().describe('ref of the object or place it sits in/on; null if unclear'),
    relation: z.enum(['INSIDE', 'ON_TOP_OF', 'UNDER', 'NEXT_TO', 'ATTACHED_TO']),
  }),
  confidence: z.number().describe('0..1 confidence the label is correct'),
  frameIndex: z.number().describe('index of the frame where it is most clearly visible'),
  bbox: BBox.nullable().describe('tight box in that frame, normalised 0..1'),
  primary: z.boolean().describe('true for the object the user is deliberately showing/talking about'),
});

export const SceneAnalysis = z.object({
  scene: z.object({
    roomType: z.string().nullable().describe('bedroom, kitchen, office, garage… or null if not determinable'),
    summary: z.string().describe('one short sentence describing what the frames show'),
    peoplePresent: z.boolean().describe('true if any person or identifiable body part is visible'),
    quality: z.enum(['good', 'dim', 'blurry', 'obstructed']),
  }),
  places: z.array(ScenePlace),
  objects: z.array(SceneObject),
  notes: z.string().nullable().describe('anything the user should double-check, briefly'),
});

export type SceneAnalysisT = z.infer<typeof SceneAnalysis>;
export type SceneObjectT = z.infer<typeof SceneObject>;
export type ScenePlaceT = z.infer<typeof ScenePlace>;

export const AnalyzeRequest = z.object({
  mode: z.enum(['remember', 'scan', 'box']),
  frames: z
    .array(z.object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string() }))
    .min(1)
    .max(8),
  /** What the user said, e.g. "Remember where I'm putting my passport". */
  utterance: z.string().max(500).optional(),
  /** Names of rooms/furniture/containers the user already has, to ground naming. Never object names. */
  knownPlaces: z.array(z.string().max(80)).max(200).optional(),
  /** User asked us to minimise sensitive text: never transcribe document contents. */
  sensitiveMode: z.boolean().optional(),
  /** "Scan drawer" etc. — the kind of place being scanned. */
  scanTarget: z.string().max(40).optional(),
});
export type AnalyzeRequestT = z.infer<typeof AnalyzeRequest>;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Enforce numeric ranges and referential integrity the JSON-schema subset can't express. */
export function clampAnalysis(a: SceneAnalysisT, frameCount: number): SceneAnalysisT {
  const placeRefs = new Set(a.places.map((p) => p.ref));
  const objRefs = new Set(a.objects.map((o) => o.ref));
  return {
    ...a,
    places: a.places.map((p) => ({ ...p, confidence: clamp01(p.confidence), parentRef: p.parentRef && placeRefs.has(p.parentRef) && p.parentRef !== p.ref ? p.parentRef : null })),
    objects: a.objects.map((o) => ({
      ...o,
      confidence: clamp01(o.confidence),
      frameIndex: Math.min(Math.max(0, Math.round(o.frameIndex)), frameCount - 1),
      bbox: o.bbox ? { x: clamp01(o.bbox.x), y: clamp01(o.bbox.y), w: clamp01(o.bbox.w), h: clamp01(o.bbox.h) } : null,
      placement: {
        ...o.placement,
        parentRef: o.placement.parentRef && (placeRefs.has(o.placement.parentRef) || objRefs.has(o.placement.parentRef)) && o.placement.parentRef !== o.ref ? o.placement.parentRef : null,
      },
    })),
  };
}

/** Structured interpretation of a free-form question (cloud fallback for the on-device parser). */
export const InterpretedQuery = z.object({
  intent: z.enum([
    'find',
    'contents',
    'history',
    'usual',
    'last_seen_time',
    'was_ever_in',
    'previous',
    'lent_list',
    'inventory',
    'stale',
    'uncertain',
    'changes',
    'moves',
    'storage',
    'away',
    'misplaced',
    'not_scanned',
  ]),
  subject: z.string().nullable().describe('the object being asked about, as the user would name it'),
  place: z.string().nullable(),
  person: z.string().nullable(),
  containerType: z.string().nullable(),
  sinceDays: z.number().nullable(),
});
export type InterpretedQueryT = z.infer<typeof InterpretedQuery>;

export const InterpretRequest = z.object({ question: z.string().min(1).max(500) });
