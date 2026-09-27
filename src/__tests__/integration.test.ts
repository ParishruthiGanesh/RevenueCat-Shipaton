import { ask } from '@/core/ask';
import { computeBelief } from '@/core/beliefs';
import { commitCapture } from '@/core/capture';
import { MemoryGraph, type TableName } from '@/core/graph';
import { resetDeterminism } from '@/core/ids';
import { historyOf } from '@/core/queries';
import { fromRemote, PUSH_ORDER, REMOTE_TABLE, remoteKey, toRemote } from '@/data/remote';
import { seedDemo } from '@/demo/seed';
import { selectFrames } from '@/ai/pipeline';
import { buildDraft } from '@/ai/draft';
import { sanitizeProps } from '@/services/analytics';
import { qrSvg } from '@/ui/qr';
import { buildHome, deterministic, hoursAfter, item, see, T0 } from '@/core/__tests__/fixtures';
import type { SceneAnalysisT } from '../../supabase/functions/_shared/scene-schema';

jest.mock('@/data/media', () => ({ prepareFrame: jest.fn(), cropEvidence: jest.fn(), deleteMediaFile: jest.fn() }));
jest.mock('@/data/db', () => ({ enqueueCapture: jest.fn() }));
jest.mock('@/services/supabase', () => ({ invoke: jest.fn(), supabase: () => null, BackendError: class extends Error {} }));

afterEach(resetDeterminism);

describe('sync mapping (device ⇄ Postgres)', () => {
  it('round-trips every synced table without loss', () => {
    deterministic();
    const h = buildHome();
    const p = item(h.graph, 'Passport', { colors: ['red'], brand: 'Gov' }, { sensitive: true, description: 'red booklet' });
    see(h.graph, p.id, h.topDrawer.id, T0, { bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, detectedLabel: 'notebook', verifiedLabel: 'Passport', verification: 'corrected' });
    const snap = h.graph.snapshot();
    for (const table of PUSH_ORDER) {
      for (const row of snap[table] as unknown[]) {
        const remote = toRemote(table, row, 'user-1');
        expect(remote).not.toBeNull();
        expect(remote!.user_id).toBe('user-1');
        const back = fromRemote(table, remote!) as Record<string, unknown>;
        const orig = row as Record<string, unknown>;
        for (const [k, v] of Object.entries(orig)) {
          if (table === 'media' && k === 'localUri') continue; // device-local path is never synced
          if (v === undefined) continue;
          expect(back[k]).toEqual(v);
        }
      }
    }
  });

  it('never syncs local-only tables and keys composite rows correctly', () => {
    expect(REMOTE_TABLE.embeddings).toBeUndefined();
    expect(remoteKey('tripItems' as TableName, 'trip-1:item-9')).toEqual({ trip_id: 'trip-1', item_id: 'item-9' });
    expect(remoteKey('entities', 'abc')).toEqual({ id: 'abc' });
  });
});

describe('privacy-safe analytics', () => {
  it('drops free text (object names, places) and keeps numbers/enums', () => {
    expect(sanitizeProps({ items: 3, mode: 'scan', name: 'My Passport in the top drawer', ok: true, bad_key_Upper: 1, pi: 3.14159 } as never)).toEqual({ items: 3, mode: 'scan', ok: true, pi: 3.14 });
  });
});

describe('capture pipeline helpers', () => {
  it('selects evenly spaced frames from a burst', () => {
    expect(selectFrames([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 6)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(selectFrames([1, 2], 6)).toEqual([1, 2]);
  });

  it('generates a scannable-size QR SVG offline', () => {
    const svg = qrSvg('pm://box/ABCD2345', 200);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="200"');
    expect((svg.match(/h[\d.]+v/g) ?? []).length).toBeGreaterThan(100);
  });
});

describe('THE DEMO — end to end through the real pipeline stages', () => {
  const attrs = (colors: string[] = []) => ({ colors, brand: null, model: null, material: null, shape: null, sizeClass: 'small' as const, distinguishingMarks: [] });

  it('remember passport → box of electronics → ask → rescan without passport → honest answer → history', () => {
    const clock = deterministic(new Date('2026-09-26T20:14:00'));
    const h = buildHome();
    const g = h.graph;

    // 1–3. "Remember where I'm putting my passport." Camera sees passport → blue pouch → drawer.
    const scene1: SceneAnalysisT = {
      scene: { roomType: 'bedroom', summary: 'Open dresser drawer', peoplePresent: false, quality: 'good' },
      places: [
        { ref: 'p1', kind: 'fixture', label: 'black dresser', description: '', parentRef: null, confidence: 0.8 },
        { ref: 'p2', kind: 'container', label: 'top drawer', description: '', parentRef: 'p1', confidence: 0.9 },
      ],
      objects: [
        { ref: 'o1', label: 'passport', category: 'documents', visualDescription: 'passport booklet', attributes: attrs(['red']), isContainer: false, sensitive: true, placement: { parentRef: 'o2', relation: 'INSIDE' }, confidence: 0.95, frameIndex: 0, bbox: null, primary: true },
        { ref: 'o2', label: 'blue document pouch', category: 'bags', visualDescription: 'blue zip pouch', attributes: attrs(['blue']), isContainer: true, sensitive: false, placement: { parentRef: 'p2', relation: 'INSIDE' }, confidence: 0.9, frameIndex: 0, bbox: null, primary: false },
        { ref: 'o3', label: 'sunglasses', category: 'accessories', visualDescription: 'black sunglasses', attributes: attrs(['black']), isContainer: false, sensitive: false, placement: { parentRef: 'p2', relation: 'INSIDE' }, confidence: 0.85, frameIndex: 0, bbox: null, primary: false },
      ],
      notes: null,
    };
    const d1 = buildDraft(g, scene1, { captureId: 'c1', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id, utterance: "Remember where I'm putting my passport" });
    commitCapture(g, d1);

    // 4–5. Box: headphones, charger, camera, adapter → Box 1 on the garage shelf.
    clock.advanceHours(1);
    const scene2: SceneAnalysisT = {
      scene: { roomType: null, summary: 'Open cardboard box', peoplePresent: false, quality: 'good' },
      places: [],
      objects: ['headphones', 'laptop charger', 'camera', 'HDMI adapter'].map((l, i) => ({ ref: `b${i}`, label: l, category: 'electronics', visualDescription: l, attributes: attrs(['black']), isContainer: false, sensitive: false, placement: { parentRef: null, relation: 'INSIDE' as const }, confidence: 0.9, frameIndex: 0, bbox: null, primary: false })),
      notes: null,
    };
    const { createStorageBox } = jest.requireActual('@/core/operations') as typeof import('@/core/operations');
    const box = createStorageBox(g, { parentId: h.shelf.id, category: 'Electronics' });
    const d2 = buildDraft(g, scene2, { captureId: 'c2', mode: 'box', observedAt: clock.now.toISOString(), spaceId: h.home.id, targetId: box.id });
    commitCapture(g, d2);

    // 6–7. "Where's my passport?"
    clock.advanceHours(1);
    const r1 = ask(g, "Where's my passport?", { now: clock.now });
    expect(r1.type).toBe('item');
    if (r1.type !== 'item') return;
    expect(r1.answer.headline).toBe('Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom — today at 8:14 PM.');
    expect(r1.belief.level).toBe('high');

    // 8–9. "Where is my camera?" → Box 1 → metal shelf → garage.
    const r2 = ask(g, 'Where is my camera?', { now: clock.now });
    expect(r2.type === 'item' && r2.answer.headline).toMatch(/^Last seen in Box 1, in the metal shelf, in the garage — today at 9:14 PM\.$/);

    // 10–11. Rescan the drawer without the passport (the pouch is gone too).
    clock.advanceHours(24);
    const sunglasses = g.items().find((e) => e.name === 'Sunglasses')!;
    const scene3: SceneAnalysisT = { ...scene1, objects: [scene1.objects[2]] };
    const d3 = buildDraft(g, scene3, { captureId: 'c3', mode: 'scan', observedAt: clock.now.toISOString(), spaceId: h.home.id, targetId: h.topDrawer.id });
    expect(d3.items[0].identity).toEqual({ type: 'existing', entityId: sunglasses.id });
    const res3 = commitCapture(g, d3);
    expect(res3.diff.notDetected.map((e) => e.name)).toContain('Blue document pouch');

    const r3 = ask(g, 'Where is my passport?', { now: hoursAfter(clock.now, 0.1) });
    expect(r3.type).toBe('item');
    if (r3.type !== 'item') return;
    // Never "the passport is gone": it still reports the last confirmed sighting, with a caveat.
    expect(r3.answer.headline).toMatch(/blue document pouch/);
    expect(r3.answer.headline).not.toMatch(/gone|missing/i);
    const passport = r3.entity;
    const pouchBelief = computeBelief(g, g.items().find((e) => e.name === 'Blue document pouch')!.id, hoursAfter(clock.now, 0.1));
    expect(pouchBelief.flags).toContain('not_detected_in_latest_scan');

    // 12. Object history.
    expect(historyOf(g, passport.id).length).toBeGreaterThanOrEqual(1);
  });

  it('dev demo seed produces a coherent, queryable scenario', () => {
    const g = new MemoryGraph();
    const now = new Date('2026-09-26T21:00:00');
    const { passport, box } = seedDemo(g, now);
    expect(historyOf(g, passport.id).filter((x) => x.observation.type === 'sighting').length).toBe(4);
    const lent = ask(g, 'Where are my headphones?', { now });
    expect(lent.type === 'item' && lent.belief.status).toBe('lent');
    const inBox = ask(g, `What's inside ${box.name}?`, { now });
    expect(inBox.type === 'contents' && inBox.entries.length).toBe(3);
  });
});
