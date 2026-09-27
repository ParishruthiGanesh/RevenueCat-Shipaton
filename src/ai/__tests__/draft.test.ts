import { buildDraft, manualDraft } from '../draft';
import { commitCapture } from '@/core/capture';
import { computeBelief } from '@/core/beliefs';
import { resetDeterminism } from '@/core/ids';
import { SceneAnalysis, clampAnalysis, type SceneAnalysisT } from '../../../supabase/functions/_shared/scene-schema';
import { buildHome, deterministic, item, see, T0, hoursAfter } from '@/core/__tests__/fixtures';

afterEach(resetDeterminism);

const attrs = (colors: string[] = [], brand: string | null = null) => ({ colors, brand, model: null, material: null, shape: null, sizeClass: 'small' as const, distinguishingMarks: [] });

/** What the vision model returns for the demo "passport in blue pouch in top drawer" photo. */
const passportScene: SceneAnalysisT = {
  scene: { roomType: 'bedroom', summary: 'An open dresser drawer with a blue pouch holding a passport.', peoplePresent: false, quality: 'good' },
  places: [
    { ref: 'p1', kind: 'fixture', label: 'black dresser', description: 'black wooden dresser', parentRef: null, confidence: 0.8 },
    { ref: 'p2', kind: 'container', label: 'top drawer', description: 'open top drawer', parentRef: 'p1', confidence: 0.85 },
  ],
  objects: [
    { ref: 'o1', label: 'passport', category: 'documents', visualDescription: 'dark red passport booklet', attributes: attrs(['red']), isContainer: false, sensitive: true, placement: { parentRef: 'o2', relation: 'INSIDE' }, confidence: 0.93, frameIndex: 0, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.25 }, primary: true },
    { ref: 'o2', label: 'blue document pouch', category: 'bags/pouch', visualDescription: 'navy blue zip document pouch', attributes: attrs(['blue']), isContainer: true, sensitive: false, placement: { parentRef: 'p2', relation: 'INSIDE' }, confidence: 0.88, frameIndex: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, primary: false },
    { ref: 'o3', label: 'sunglasses', category: 'accessories', visualDescription: 'black sunglasses', attributes: attrs(['black']), isContainer: false, sensitive: false, placement: { parentRef: 'p2', relation: 'INSIDE' }, confidence: 0.4, frameIndex: 0, bbox: null, primary: false },
  ],
  notes: null,
};

describe('vision → draft', () => {
  it('schema accepts the demo analysis and clamps out-of-range numbers', () => {
    const bad = { ...passportScene, objects: [{ ...passportScene.objects[0], confidence: 1.7, frameIndex: 9, placement: { parentRef: 'nope', relation: 'INSIDE' as const } }] };
    const parsed = SceneAnalysis.parse(bad);
    const c = clampAnalysis(parsed, 2);
    expect(c.objects[0].confidence).toBe(1);
    expect(c.objects[0].frameIndex).toBe(1);
    expect(c.objects[0].placement.parentRef).toBeNull();
  });

  it('reconciles the scene with existing structure and nests the passport inside the pouch', () => {
    const clock = deterministic();
    const h = buildHome();
    const d = buildDraft(h.graph, passportScene, { captureId: 'c1', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id, utterance: "Remember where I'm putting my passport" });
    expect(d.path.map((p) => p.name)).toEqual(['Bedroom', 'Black dresser', 'Top drawer']);
    expect(d.path.every((p) => p.id)).toBe(true);
    expect(d.pathSource).toBe('existing');
    expect(d.items[0]).toMatchObject({ name: 'Passport', primary: true, insideItemKey: 'o2', sensitive: true, include: true });
    // Low-confidence incidental detections are pre-unchecked in remember mode.
    expect(d.items.find((i) => i.aiLabel === 'sunglasses')!.include).toBe(false);

    const res = commitCapture(h.graph, d);
    const passport = res.savedItems.find((s) => s.entity.name === 'Passport')!;
    const b = computeBelief(h.graph, passport.entity.id, hoursAfter(clock.now, 0.1));
    expect(h.graph.pathLabel(b.primary!.currentChain)).toBe('Home › Bedroom › Black dresser › Top drawer › Blue document pouch');
  });

  it("the user's words win over the model's label and place", () => {
    const clock = deterministic();
    const h = buildHome();
    const d = buildDraft(h.graph, passportScene, { captureId: 'c', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id, utterance: "Remember I'm putting my travel documents in the left drawer" });
    expect(d.items[0].name).toBe('Travel documents');
    expect(d.pathSource).toBe('voice');
    expect(d.path.map((p) => p.name)).toEqual(['Office', 'Desk', 'Left drawer']);
  });

  it('re-identifies a known object instead of creating a duplicate', () => {
    const clock = deterministic();
    const h = buildHome();
    const pouch = item(h.graph, 'Blue document pouch', { colors: ['blue'] }, { isContainer: true, description: 'navy blue zip document pouch' });
    see(h.graph, pouch.id, h.topDrawer.id, T0);
    const d = buildDraft(h.graph, passportScene, { captureId: 'c', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id });
    const p = d.items.find((i) => i.key === 'o2')!;
    expect(p.matchKind).toBe('same');
    expect(p.identity).toEqual({ type: 'existing', entityId: pouch.id });
  });

  it('with no existing structure, proposes the full vision hierarchy as new places', () => {
    const clock = deterministic();
    const h = buildHome();
    const scene: SceneAnalysisT = { ...passportScene, places: passportScene.places.map((p) => (p.ref === 'p1' ? { ...p, label: 'oak wardrobe' } : { ...p, label: 'lower shelf' })), scene: { ...passportScene.scene, roomType: 'guest room' } };
    const d = buildDraft(h.graph, scene, { captureId: 'c', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id });
    expect(d.path.map((p) => [p.name, p.kind, !!p.id])).toEqual([
      ['Guest room', 'room', false],
      ['Oak wardrobe', 'fixture', false],
      ['Lower shelf', 'container', false],
    ]);
  });

  it('manual draft (cloud AI off) turns speech into structure', () => {
    const clock = deterministic();
    const h = buildHome();
    const d = manualDraft(h.graph, { captureId: 'c', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id, utterance: "I'm putting the charger in the top drawer" });
    expect(d.items[0].name).toBe('Charger');
    expect(d.targetId).toBe(h.topDrawer.id);
  });
});
