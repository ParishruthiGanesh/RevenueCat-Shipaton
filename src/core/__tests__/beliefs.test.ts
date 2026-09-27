import { computeBelief, levelFor } from '../beliefs';
import { resetDeterminism } from '../ids';
import { lendItem, markNoLongerThere, moveEntity, createStorageBox, returnLoan, buildAbsence, ensurePlace } from '../operations';
import { answerForBelief } from '../phrasing';
import { buildHome, deterministic, hoursAfter, item, see, T0 } from './fixtures';

afterEach(resetDeterminism);

describe('uncertainty engine', () => {
  it('reports a fresh direct observation as HIGH confidence with "last seen" language', () => {
    deterministic();
    const h = buildHome();
    const passport = item(h.graph, 'Passport', {}, { sensitive: true });
    const pouch = item(h.graph, 'Blue document pouch', { colors: ['blue'] }, { isContainer: true });
    see(h.graph, pouch.id, h.topDrawer.id, T0);
    see(h.graph, passport.id, pouch.id, T0);

    const b = computeBelief(h.graph, passport.id, hoursAfter(T0, 0.5));
    expect(b.status).toBe('located');
    expect(b.level).toBe('high');
    expect(b.primary!.currentChain.map((id) => h.graph.entity(id)!.name)).toEqual(['Blue document pouch', 'Top drawer', 'Black dresser', 'Bedroom', 'Home']);

    const a = answerForBelief(h.graph, b, hoursAfter(T0, 0.5));
    expect(a.headline).toMatch(/^Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom — today at 8:14 PM\.$/);
    expect(a.headline).not.toMatch(/\bis in\b/);
  });

  it('decays confidence over time according to mobility (keys fast, passport slow)', () => {
    deterministic();
    const h = buildHome();
    const keys = item(h.graph, 'Keys');
    const passport = item(h.graph, 'Passport');
    see(h.graph, keys.id, h.topDrawer.id, T0);
    see(h.graph, passport.id, h.topDrawer.id, T0);
    const threeDays = hoursAfter(T0, 72);
    expect(computeBelief(h.graph, keys.id, threeDays).level).toMatch(/low|unknown/);
    expect(computeBelief(h.graph, passport.id, threeDays).level).toBe('high');
    const fourMonths = hoursAfter(T0, 24 * 120);
    expect(computeBelief(h.graph, passport.id, fourMonths).level).toMatch(/low|medium/);
  });

  it('newer LOW-confidence sighting does not override an older HIGH-confidence one', () => {
    deterministic();
    const h = buildHome();
    const passport = item(h.graph, 'Passport');
    see(h.graph, passport.id, h.topDrawer.id, T0, { verification: 'confirmed' });
    // Ambiguous passive match on the desk a day later.
    see(h.graph, passport.id, h.deskDrawer.id, hoursAfter(T0, 24), { source: 'passive', detectionConfidence: 0.55, matchConfidence: 0.5 });

    const b = computeBelief(h.graph, passport.id, hoursAfter(T0, 25));
    expect(b.primary!.observation.placement!.parentId).toBe(h.topDrawer.id);
    expect(b.flags).toContain('newer_weak_sighting');
    expect(b.alternatives[0].observation.placement!.parentId).toBe(h.deskDrawer.id);
  });

  it('newer HIGH-confidence sighting supersedes the older location', () => {
    deterministic();
    const h = buildHome();
    const passport = item(h.graph, 'Passport');
    see(h.graph, passport.id, h.topDrawer.id, T0);
    see(h.graph, passport.id, h.deskDrawer.id, hoursAfter(T0, 24));
    const b = computeBelief(h.graph, passport.id, hoursAfter(T0, 25));
    expect(b.primary!.observation.placement!.parentId).toBe(h.deskDrawer.id);
    expect(b.level).toBe('high');
    expect(b.flags).not.toContain('newer_weak_sighting');
  });

  it('absence in a rescan lowers confidence and flags it, but never claims the object is gone', () => {
    deterministic();
    const h = buildHome();
    const passport = item(h.graph, 'Passport');
    see(h.graph, passport.id, h.topDrawer.id, T0);
    const later = hoursAfter(T0, 96);
    h.graph.commit([{ op: 'upsert', table: 'observations', row: buildAbsence(h.graph, passport.id, h.topDrawer.id, 'cap', later.toISOString()) }]);

    const b = computeBelief(h.graph, passport.id, hoursAfter(later, 0.1));
    expect(b.status).not.toBe('removed');
    expect(b.flags).toContain('not_detected_in_latest_scan');
    expect(b.primary!.observation.placement!.parentId).toBe(h.topDrawer.id);
    const a = answerForBelief(h.graph, b, hoursAfter(later, 0.1));
    expect(a.caveats.join(' ')).toMatch(/Not detected when you scanned the top drawer .* last confirmed sighting there remains September 22/);
    expect(a.headline + a.caveats.join(' ')).not.toMatch(/\bgone\b/i);
  });

  it('"That\'s no longer there" yields removed status with no invented location', () => {
    deterministic();
    const h = buildHome();
    const cam = item(h.graph, 'Camera');
    see(h.graph, cam.id, h.deskDrawer.id, T0);
    markNoLongerThere(h.graph, cam.id, hoursAfter(T0, 5).toISOString());
    const b = computeBelief(h.graph, cam.id, hoursAfter(T0, 6));
    expect(b.status).toBe('removed');
    expect(b.primary).toBeUndefined();
    expect(answerForBelief(h.graph, b).headline).toMatch(/no longer .* no newer sighting/i);
  });

  it('a loan overrides physical inference and reports the last sighting before lending', () => {
    const clock = deterministic();
    const h = buildHome();
    h.graph.commit([]);
    const cam = item(h.graph, 'Camera');
    see(h.graph, cam.id, h.desk.id, T0, { relation: 'ON_TOP_OF' });
    clock.set(hoursAfter(T0, 48));
    lendItem(h.graph, cam.id, 'Sarah');
    const b = computeBelief(h.graph, cam.id, hoursAfter(T0, 50));
    expect(b.status).toBe('lent');
    expect(answerForBelief(h.graph, b, hoursAfter(T0, 50)).headline).toMatch(/marked as lent to Sarah today\. Its last physical sighting before that was on the desk/);
    const a = answerForBelief(h.graph, b, hoursAfter(T0, 24 * 7));
    expect(a.headline).toMatch(/^Your camera was marked as lent to Sarah on September 24\. Its last physical sighting before that was on the desk, in the office \(September 22 at 8:14 PM\)\.$/);

    returnLoan(h.graph, b.loan!.id, { parentId: h.deskDrawer.id });
    expect(computeBelief(h.graph, cam.id, hoursAfter(T0, 51)).status).toBe('located');
  });

  it('items inside a moved storage box follow the box, and say so', () => {
    const clock = deterministic();
    const h = buildHome();
    const box = createStorageBox(h.graph, { parentId: h.bedroom.id, category: 'Kitchen' });
    const grinder = item(h.graph, 'Coffee grinder');
    see(h.graph, grinder.id, box.id, T0, { source: 'box_scan' });
    clock.set(hoursAfter(T0, 10));
    moveEntity(h.graph, box.id, h.shelf.id, 'qr_scan');

    const b = computeBelief(h.graph, grinder.id, hoursAfter(T0, 11));
    expect(b.primary!.currentChain.map((id) => h.graph.entity(id)!.name)).toEqual(['Box 1', 'Metal shelf', 'Garage', 'Home']);
    expect(b.primary!.recordedChain).toContain(h.bedroom.id);
    expect(b.flags).toContain('container_moved_since');
    expect(answerForBelief(h.graph, b, hoursAfter(T0, 11)).headline).toMatch(/in Box 1, in the metal shelf, in the garage/);
  });

  it('learning structure later (box placed on a shelf afterwards) is NOT reported as a move', () => {
    const clock = deterministic();
    const h = buildHome();
    const box = createStorageBox(h.graph, { parentId: h.shelf.id });
    const grinder = item(h.graph, 'Coffee grinder');
    // Item sighted in the box BEFORE the box's own placement was recorded.
    see(h.graph, grinder.id, box.id, hoursAfter(clock.now, -48), { source: 'box_scan' });
    const b = computeBelief(h.graph, grinder.id, hoursAfter(clock.now, 1));
    expect(b.flags).not.toContain('container_moved_since');
  });

  it('labelled units read without an article ("on Shelf B")', () => {
    deterministic();
    const h = buildHome();
    const shelfB = ensurePlace(h.graph, h.garage.id, 'Shelf B', 'fixture');
    const x = item(h.graph, 'Drill');
    see(h.graph, x.id, shelfB.id, T0, { relation: 'ON_TOP_OF' });
    expect(answerForBelief(h.graph, computeBelief(h.graph, x.id, hoursAfter(T0, 1)), hoursAfter(T0, 1)).headline).toMatch(/^Last seen on Shelf B, in the garage/);
  });

  it('user-stated only evidence is flagged as not photographed', () => {
    deterministic();
    const h = buildHome();
    const charger = item(h.graph, 'Travel charger');
    see(h.graph, charger.id, h.deskDrawer.id, T0, { source: 'voice_statement', evidence: 'user_stated' });
    const b = computeBelief(h.graph, charger.id, hoursAfter(T0, 1));
    expect(b.flags).toContain('user_stated_only');
  });

  it('rejected (mis-identified) observations are ignored', () => {
    deterministic();
    const h = buildHome();
    const p = item(h.graph, 'Passport');
    see(h.graph, p.id, h.topDrawer.id, T0);
    see(h.graph, p.id, h.shelf.id, hoursAfter(T0, 2), { verification: 'rejected' });
    expect(computeBelief(h.graph, p.id, hoursAfter(T0, 3)).primary!.observation.placement!.parentId).toBe(h.topDrawer.id);
  });

  it('maps scores to levels', () => {
    expect(levelFor(0.9)).toBe('high');
    expect(levelFor(0.5)).toBe('medium');
    expect(levelFor(0.2)).toBe('low');
    expect(levelFor(0.05)).toBe('unknown');
  });

  it('with no sightings, says so plainly', () => {
    deterministic();
    const h = buildHome();
    const x = item(h.graph, 'Drill');
    const b = computeBelief(h.graph, x.id);
    expect(b.status).toBe('unknown');
    expect(answerForBelief(h.graph, b).headline).toBe("I don't have any sightings of your drill yet.");
  });
});

describe('container-level reasoning', () => {
  afterEach(resetDeterminism);

  it('rescanning the drawer without the pouch casts doubt on the passport inside it — honestly', () => {
    const clock = deterministic();
    const h = buildHome();
    const pouch = item(h.graph, 'Blue document pouch', { colors: ['blue'] }, { isContainer: true });
    const passport = item(h.graph, 'Passport');
    const bag = item(h.graph, 'Travel backpack', {}, { isContainer: true });
    see(h.graph, bag.id, h.bedroom.id, hoursAfter(T0, -48));
    see(h.graph, passport.id, bag.id, hoursAfter(T0, -24));
    see(h.graph, pouch.id, h.topDrawer.id, T0);
    see(h.graph, passport.id, pouch.id, T0, { verification: 'confirmed' });
    const scanAt = hoursAfter(T0, 72);
    clock.set(scanAt);
    h.graph.commit([{ op: 'upsert', table: 'observations', row: buildAbsence(h.graph, pouch.id, h.topDrawer.id, 'scan', scanAt.toISOString()) }]);

    const before = computeBelief(h.graph, passport.id, hoursAfter(scanAt, -1));
    const after = computeBelief(h.graph, passport.id, hoursAfter(scanAt, 0.1));
    expect(after.flags).toContain('container_not_detected');
    expect(after.score).toBeLessThan(before.score);
    expect(after.primary!.observation.placement!.parentId).toBe(pouch.id); // still the last confirmed place
    // The superseded backpack sighting is history, not an "other possible place".
    expect(before.alternatives.map((a) => a.observation.placement!.parentId)).not.toContain(bag.id);
    const a = answerForBelief(h.graph, after, hoursAfter(scanAt, 0.1));
    expect(a.caveats.join(' ')).toMatch(/^The blue document pouch it was in wasn’t detected when you scanned the top drawer today at .* Its last confirmed sighting remains September 22 at 8:14 PM\./);
    expect(a.headline + a.caveats.join(' ')).not.toMatch(/\bgone\b|\bmissing\b/i);
  });
});

describe('phrasing', () => {
  afterEach(resetDeterminism);
  it('never says "on the bedroom"', () => {
    deterministic();
    const h = buildHome();
    const bag = item(h.graph, 'Travel backpack', {}, { isContainer: true });
    see(h.graph, bag.id, h.bedroom.id, T0, { relation: 'ON_TOP_OF' });
    const a = answerForBelief(h.graph, computeBelief(h.graph, bag.id, hoursAfter(T0, 1)), hoursAfter(T0, 1));
    expect(a.headline).toMatch(/^Last seen in the bedroom/);
  });
});
