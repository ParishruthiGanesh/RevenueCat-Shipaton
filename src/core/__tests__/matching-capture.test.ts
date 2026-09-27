import { commitCapture, type ReviewedCapture, type ReviewedItem } from '../capture';
import { computeBelief } from '../beliefs';
import { resetDeterminism } from '../ids';
import { findPotentialDuplicates, matchDetection } from '../matching';
import { correctLabel, markNotSame, mergeEntities, createStorageBox, findBoxByCode, deleteEntity, deleteObservation, rejectObservation } from '../operations';
import { historyOf } from '../queries';
import { buildHome, deterministic, hoursAfter, item, see, T0 } from './fixtures';

afterEach(resetDeterminism);

const reviewed = (partial: Partial<ReviewedItem> & { name: string }): ReviewedItem => ({
  key: partial.name,
  include: true,
  identity: { type: 'new' },
  aiLabel: partial.name,
  attributes: { colors: [], distinguishingMarks: [] },
  sensitive: false,
  detectionConfidence: 0.9,
  matchConfidence: 1,
  relation: 'INSIDE',
  ...partial,
});

describe('instance re-identification', () => {
  it('two identical chargers → asks instead of silently merging', () => {
    deterministic();
    const h = buildHome();
    const a = item(h.graph, 'Charger', { colors: ['white'], brand: 'Apple' }, { description: 'white Apple 96W USB-C power adapter' });
    const b = item(h.graph, 'Charger', { colors: ['white'], brand: 'Apple' }, { description: 'white Apple 96W USB-C power adapter' });
    see(h.graph, a.id, h.deskDrawer.id, T0);
    see(h.graph, b.id, h.topDrawer.id, T0);
    const d = matchDetection(h.graph, { label: 'charger', description: 'white Apple USB-C power adapter', attributes: { colors: ['white'], brand: 'Apple', distinguishingMarks: [] } }, hoursAfter(T0, 1));
    expect(d.kind).toBe('ask');
    if (d.kind === 'ask') expect(d.candidates.map((c) => c.entity.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('location prior breaks a tie between identical items when seen in one of their spots', () => {
    deterministic();
    const h = buildHome();
    const a = item(h.graph, 'Charger', { colors: ['white'], brand: 'Apple' });
    const b = item(h.graph, 'Charger', { colors: ['white'], brand: 'Apple' });
    see(h.graph, a.id, h.deskDrawer.id, T0);
    see(h.graph, b.id, h.topDrawer.id, T0);
    const d = matchDetection(h.graph, { label: 'Charger', attributes: { colors: ['white'], brand: 'Apple', distinguishingMarks: [] }, contextParentId: h.deskDrawer.id }, hoursAfter(T0, 1));
    const top = d.kind === 'same' ? d.entity : d.candidates[0].entity;
    expect(top.id).toBe(a.id);
  });

  it('distinguishes a black Anker charger from a white Apple charger', () => {
    deterministic();
    const h = buildHome();
    const apple = item(h.graph, 'Charger', { colors: ['white'], brand: 'Apple' }, { description: 'white Apple 96W USB-C' });
    const anker = item(h.graph, 'Charger', { colors: ['black'], brand: 'Anker' }, { description: 'black Anker dual USB-C' });
    const d = matchDetection(h.graph, { label: 'charger', description: 'black Anker dual port USB-C charger', attributes: { colors: ['black'], brand: 'Anker', distinguishingMarks: [] } });
    expect(d.kind).toBe('same');
    if (d.kind === 'same') expect(d.entity.id).toBe(anker.id);
    const appleScore = d.candidates.find((c) => c.entity.id === apple.id)?.score ?? 0;
    expect(appleScore).toBeLessThan(0.5);
  });

  it('proposes a new object when nothing similar exists', () => {
    deterministic();
    const h = buildHome();
    item(h.graph, 'Passport');
    const d = matchDetection(h.graph, { label: 'Coffee grinder', attributes: { colors: ['silver'], distinguishingMarks: [] } });
    expect(d.kind).toBe('new');
  });

  it('never proposes unrelated objects in the same category as duplicates (camera ≠ headphones)', () => {
    deterministic();
    const h = buildHome();
    const cam = item(h.graph, 'Camera', {}, { category: 'electronics' });
    item(h.graph, 'Headphones', {}, { category: 'electronics' });
    item(h.graph, 'Laptop charger', {}, { category: 'electronics' });
    expect(findPotentialDuplicates(h.graph, cam)).toEqual([]);
  });

  it('duplicate prompts respect "No, these are different"', () => {
    deterministic();
    const h = buildHome();
    const a = item(h.graph, 'Black USB-C cable', { colors: ['black'] });
    const b = item(h.graph, 'Black USB-C cable', { colors: ['black'] });
    expect(findPotentialDuplicates(h.graph, b).map((c) => c.entity.id)).toContain(a.id);
    markNotSame(h.graph, a.id, b.id);
    expect(findPotentialDuplicates(h.graph, b).map((c) => c.entity.id)).not.toContain(a.id);
  });

  it('merging keeps full history under one identity', () => {
    deterministic();
    const h = buildHome();
    const a = item(h.graph, 'Travel adapter');
    const b = item(h.graph, 'Universal adapter');
    see(h.graph, a.id, h.deskDrawer.id, T0);
    see(h.graph, b.id, h.topDrawer.id, hoursAfter(T0, 5));
    mergeEntities(h.graph, a.id, b.id);
    expect(historyOf(h.graph, a.id)).toHaveLength(2);
    expect(h.graph.entity(a.id)!.aliases).toContain('Universal adapter');
    expect(h.graph.items().map((e) => e.id)).not.toContain(b.id);
  });
});

describe('capture commit (Remember this / Scan / Box)', () => {
  it('remember: passport → blue pouch → top drawer → dresser → bedroom, creating the hierarchy', () => {
    const clock = deterministic();
    const h = buildHome();
    const rc: ReviewedCapture = {
      captureId: 'cap1',
      mode: 'remember',
      observedAt: clock.now.toISOString(),
      spaceId: h.home.id,
      source: 'camera_capture',
      path: [
        { name: 'Bedroom', kind: 'room' },
        { name: 'Black dresser', kind: 'fixture' },
        { name: 'Top drawer', kind: 'container' },
      ],
      items: [
        reviewed({ key: 'pouch', name: 'Blue document pouch', isContainer: true, attributes: { colors: ['blue'], distinguishingMarks: [] } }),
        reviewed({ key: 'passport', name: 'Passport', sensitive: true, insideItemKey: 'pouch' }),
      ],
    };
    const res = commitCapture(h.graph, rc);
    expect(res.targetId).toBe(h.topDrawer.id); // re-used existing places, no duplicates
    const passport = res.savedItems.find((s) => s.entity.name === 'Passport')!;
    const b = computeBelief(h.graph, passport.entity.id, hoursAfter(clock.now, 0.1));
    expect(h.graph.pathLabel(b.primary!.currentChain)).toBe('Home › Bedroom › Black dresser › Top drawer › Blue document pouch');
    expect(h.graph.structuralChildren(h.bedroom.id).filter((c) => c.name === 'Black dresser')).toHaveLength(1);
  });

  it('records a correction when the user fixes the AI label ("Actually → External SSD")', () => {
    const clock = deterministic();
    const h = buildHome();
    const res = commitCapture(h.graph, {
      captureId: 'c',
      mode: 'remember',
      observedAt: clock.now.toISOString(),
      spaceId: h.home.id,
      source: 'camera_capture',
      targetId: h.deskDrawer.id,
      path: [],
      items: [reviewed({ name: 'External SSD', aiLabel: 'Power bank' })],
    });
    const obs = res.savedItems[0].observation;
    expect(obs.detectedLabel).toBe('Power bank');
    expect(obs.verifiedLabel).toBe('External SSD');
    expect(obs.verification).toBe('corrected');
    expect(h.graph.corrections()).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'label', aiValue: 'Power bank', userValue: 'External SSD' })]));
  });

  it('AI mislabels passport as "notebook"; later rename fixes search without keeping the wrong alias', () => {
    const clock = deterministic();
    const h = buildHome();
    const res = commitCapture(h.graph, {
      captureId: 'c',
      mode: 'remember',
      observedAt: clock.now.toISOString(),
      spaceId: h.home.id,
      source: 'camera_capture',
      targetId: h.topDrawer.id,
      path: [],
      items: [reviewed({ name: 'Notebook', aiLabel: 'Notebook' })],
    });
    const e = res.savedItems[0].entity;
    correctLabel(h.graph, e.id, 'Passport', res.savedItems[0].observation.id);
    expect(h.graph.entity(e.id)!.name).toBe('Passport');
    expect(h.graph.entity(e.id)!.aliases).not.toContain('Notebook');
  });

  it('scan diff: added, still here, not detected, moved in', () => {
    const clock = deterministic();
    const h = buildHome();
    const passport = item(h.graph, 'Passport');
    const sunglasses = item(h.graph, 'Sunglasses');
    const watch = item(h.graph, 'Watch');
    const powerBank = item(h.graph, 'Power bank');
    for (const x of [passport, sunglasses, watch]) see(h.graph, x.id, h.topDrawer.id, T0, { source: 'area_scan' });
    see(h.graph, powerBank.id, h.deskDrawer.id, T0);

    clock.set(hoursAfter(T0, 96));
    const res = commitCapture(h.graph, {
      captureId: 'scan2',
      mode: 'scan',
      observedAt: clock.now.toISOString(),
      spaceId: h.home.id,
      source: 'area_scan',
      targetId: h.topDrawer.id,
      path: [],
      items: [
        reviewed({ name: 'Sunglasses', identity: { type: 'existing', entityId: sunglasses.id } }),
        reviewed({ name: 'Watch', identity: { type: 'existing', entityId: watch.id } }),
        reviewed({ name: 'Power bank', identity: { type: 'existing', entityId: powerBank.id } }),
        reviewed({ name: 'USB-C hub' }),
      ],
    });
    expect(res.diff.stillHere.map((e) => e.name).sort()).toEqual(['Sunglasses', 'Watch']);
    expect(res.diff.notDetected.map((e) => e.name)).toEqual(['Passport']);
    expect(res.diff.movedIn.map((m) => m.entity.name)).toEqual(['Power bank']);
    expect(res.diff.added.map((e) => e.name)).toEqual(['USB-C hub']);

    // Absence is not proof of absence: the passport keeps its last confirmed location, flagged.
    const b = computeBelief(h.graph, passport.id, hoursAfter(clock.now, 0.1));
    expect(b.primary!.observation.placement!.parentId).toBe(h.topDrawer.id);
    expect(b.flags).toContain('not_detected_in_latest_scan');
  });

  it('remember mode does NOT generate absences for other things in the spot', () => {
    const clock = deterministic();
    const h = buildHome();
    const watch = item(h.graph, 'Watch');
    see(h.graph, watch.id, h.topDrawer.id, T0);
    clock.set(hoursAfter(T0, 1));
    const res = commitCapture(h.graph, { captureId: 'c', mode: 'remember', observedAt: clock.now.toISOString(), spaceId: h.home.id, source: 'camera_capture', targetId: h.topDrawer.id, path: [], items: [reviewed({ name: 'Passport' })] });
    expect(res.absences).toHaveLength(0);
  });

  it('same object appearing in two observations of one capture keeps both as evidence', () => {
    const clock = deterministic();
    const h = buildHome();
    const cable = item(h.graph, 'HDMI adapter');
    see(h.graph, cable.id, h.deskDrawer.id, T0);
    see(h.graph, cable.id, h.deskDrawer.id, hoursAfter(T0, 0.01));
    const b = computeBelief(h.graph, cable.id, hoursAfter(clock.now, 1));
    expect(b.primary!.supportCount).toBe(2);
  });
});

describe('storage boxes', () => {
  it('numbers boxes sequentially and resolves QR codes', () => {
    deterministic();
    const h = buildHome();
    const b1 = createStorageBox(h.graph, { parentId: h.garage.id, category: 'Kitchen' });
    const b2 = createStorageBox(h.graph, { parentId: h.garage.id });
    expect(b1.name).toBe('Box 1');
    expect(b2.box!.number).toBe(2);
    expect(b1.box!.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(findBoxByCode(h.graph, `pm://box/${b1.box!.code}`)?.id).toBe(b1.id);
  });
});

describe('privacy deletes', () => {
  it('deleting an object removes it and its observations permanently', () => {
    deterministic();
    const h = buildHome();
    const p = item(h.graph, 'Passport');
    see(h.graph, p.id, h.topDrawer.id, T0);
    deleteEntity(h.graph, p.id);
    expect(h.graph.entity(p.id)).toBeUndefined();
    expect(h.graph.allObservations().filter((o) => o.subjectId === p.id)).toHaveLength(0);
  });

  it('deleting one observation keeps the rest of the history', () => {
    deterministic();
    const h = buildHome();
    const p = item(h.graph, 'Passport');
    const o1 = see(h.graph, p.id, h.topDrawer.id, T0);
    see(h.graph, p.id, h.deskDrawer.id, hoursAfter(T0, 1));
    deleteObservation(h.graph, o1.id);
    expect(historyOf(h.graph, p.id)).toHaveLength(1);
  });

  it('rejecting a sighting retracts it but keeps an audit record', () => {
    deterministic();
    const h = buildHome();
    const p = item(h.graph, 'Passport');
    const o = see(h.graph, p.id, h.topDrawer.id, T0);
    rejectObservation(h.graph, o.id);
    expect(h.graph.observation(o.id)!.retracted).toBe(true);
    expect(computeBelief(h.graph, p.id).primary).toBeUndefined();
  });
});
