import { ask } from '../ask';
import { resetDeterminism } from '../ids';
import { gate, FREE_LIMITS } from '../plan';
import { createStorageBox, ensurePerson, lendItem, moveEntity, setOwner, buildAbsence, createTrip, setTripItemState } from '../operations';
import { parseQuery, parseVoiceCommand } from '../query';
import { tripStatus, computeInsights } from '../insights';
import { usualLocation } from '../queries';
import { buildHome, deterministic, hoursAfter, item, see, T0 } from './fixtures';

afterEach(resetDeterminism);

describe('query parser', () => {
  it.each([
    ['Where is my passport?', 'find', 'passport'],
    ['Where did I put my AirPods?', 'find', 'AirPods'],
    ['Find my travel charger.', 'find', 'travel charger'],
    ["Where's my camera", 'find', 'camera'],
    ['Where do I usually keep my passport?', 'usual', 'passport'],
    ['When did I last see my passport?', 'last_seen_time', 'passport'],
    ['Where was my passport before this?', 'previous', 'passport'],
  ])('%s → %s(%s)', (q, intent, subject) => {
    const p = parseQuery(q);
    expect(p.intent).toBe(intent);
    expect(p.subject).toBe(subject);
  });

  it('parses container questions', () => {
    expect(parseQuery('Which drawer has my documents?')).toMatchObject({ intent: 'find', containerType: 'drawer', subject: 'documents' });
    expect(parseQuery('What box has the coffee grinder?')).toMatchObject({ intent: 'find', containerType: 'box', subject: 'coffee grinder' });
    expect(parseQuery("What's inside Box 17?")).toMatchObject({ intent: 'contents', place: 'Box 17' });
    expect(parseQuery('Which things are in the attic?')).toMatchObject({ intent: 'contents', place: 'attic' });
    expect(parseQuery('Was my passport ever in my backpack?')).toMatchObject({ intent: 'was_ever_in', subject: 'passport', place: 'backpack' });
  });

  it('parses ownership and meta questions', () => {
    expect(parseQuery("Where is Revanth's charger?")).toMatchObject({ intent: 'find', person: 'Revanth', subject: 'charger' });
    expect(parseQuery('What things are currently lent out?').intent).toBe('lent_list');
    expect(parseQuery('How many USB-C chargers do I have?')).toMatchObject({ intent: 'inventory', subject: 'USB-C chargers' });
    expect(parseQuery('Do I already own a screwdriver set?')).toMatchObject({ intent: 'inventory', subject: 'screwdriver set' });
    expect(parseQuery("Which objects haven't been observed in more than a year?")).toMatchObject({ intent: 'stale', sinceDays: 365 });
    expect(parseQuery('What objects have uncertain locations?').intent).toBe('uncertain');
    expect(parseQuery('What changed in my bedroom this week?')).toMatchObject({ intent: 'changes', place: 'bedroom', sinceDays: 7 });
    expect(parseQuery('What did I move yesterday?').intent).toBe('moves');
  });

  it('parses voice commands into structured actions', () => {
    expect(parseVoiceCommand("Remember I'm putting this charger in the second desk drawer.")).toEqual({ action: 'remember', item: 'charger', place: 'second desk drawer' });
    expect(parseVoiceCommand("Remember where I'm putting my passport")).toEqual({ action: 'remember', item: 'passport', place: undefined });
    expect(parseVoiceCommand('Call this my travel adapter')).toEqual({ action: 'alias', alias: 'travel adapter' });
    expect(parseVoiceCommand('I lent this camera to Sarah')).toEqual({ action: 'lend', item: 'camera', person: 'Sarah' });
    expect(parseVoiceCommand('This box goes into the garage')).toEqual({ action: 'move_box', box: 'box', place: 'garage' });
    expect(parseVoiceCommand('These are my winter clothes')).toEqual({ action: 'label', name: 'winter clothes' });
    expect(parseVoiceCommand('Where are my AirPods?')).toMatchObject({ action: 'ask' });
  });
});

describe('ask / retrieval', () => {
  function world() {
    const clock = deterministic();
    const h = buildHome();
    const passport = item(h.graph, 'Passport', {}, { sensitive: true, category: 'documents' });
    const adapter = item(h.graph, 'HDMI adapter', { colors: ['black'] }, { description: 'small black USB-C to HDMI adapter used with the MacBook and monitor', category: 'electronics' });
    const airpods = item(h.graph, 'AirPods case', { colors: ['white'] }, { category: 'electronics' });
    const box = createStorageBox(h.graph, { parentId: h.shelf.id, category: 'Kitchen' });
    const grinder = item(h.graph, 'Coffee grinder', { colors: ['silver'] });
    const cam = item(h.graph, 'Camera', { colors: ['black'], brand: 'Sony' });
    see(h.graph, passport.id, h.topDrawer.id, T0);
    see(h.graph, adapter.id, h.deskDrawer.id, T0);
    see(h.graph, airpods.id, h.desk.id, T0, { relation: 'ON_TOP_OF' });
    see(h.graph, grinder.id, box.id, T0, { source: 'box_scan' });
    see(h.graph, cam.id, box.id, T0, { source: 'box_scan' });
    clock.set(hoursAfter(T0, 2));
    return { ...h, clock, passport, adapter, airpods, box, grinder, cam };
  }

  it('"Where is my passport?" returns the item with evidence', () => {
    const w = world();
    const r = ask(w.graph, 'Where is my passport?', { now: w.clock.now });
    expect(r.type).toBe('item');
    if (r.type === 'item') {
      expect(r.entity.id).toBe(w.passport.id);
      expect(r.belief.level).toBe('high');
      expect(r.answer.headline).toMatch(/^Last seen in the top drawer of the black dresser, in the bedroom — today at 8:14 PM\.$/);
    }
  });

  it('fuzzy description: "that little black adapter I use with my MacBook" → HDMI adapter', () => {
    const w = world();
    const r = ask(w.graph, 'Where is that little black adapter I use with my MacBook?', { now: w.clock.now });
    const top = r.type === 'item' ? r.entity : r.type === 'candidates' ? r.hits[0].entity : undefined;
    expect(top?.id).toBe(w.adapter.id);
  });

  it('synonyms: "Where are my earbuds?" finds the AirPods case', () => {
    const w = world();
    const r = ask(w.graph, 'Where are my earbuds?', { now: w.clock.now });
    const top = r.type === 'item' ? r.entity : r.type === 'candidates' ? r.hits[0].entity : undefined;
    expect(top?.id).toBe(w.airpods.id);
  });

  it('"What box has the coffee grinder?" names the box and where it is', () => {
    const w = world();
    const r = ask(w.graph, 'What box has the coffee grinder?', { now: w.clock.now });
    expect(r.type).toBe('item');
    if (r.type === 'item') expect(r.note).toMatch(/^Box 1 — in the metal shelf, garage$/);
  });

  it('"What\'s inside Box 1?" lists contents', () => {
    const w = world();
    const r = ask(w.graph, "What's inside Box 1?", { now: w.clock.now });
    expect(r.type).toBe('contents');
    if (r.type === 'contents') expect(r.entries.map((e) => e.entity.name).sort()).toEqual(['Camera', 'Coffee grinder']);
  });

  it('camera lent to Sarah answers with the loan rather than a physical location', () => {
    const w = world();
    lendItem(w.graph, w.cam.id, 'Sarah');
    const r = ask(w.graph, 'Where is my camera?', { now: w.clock.now });
    expect(r.type).toBe('item');
    if (r.type === 'item') {
      expect(r.belief.status).toBe('lent');
      expect(r.answer.headline).toMatch(/lent to Sarah today\. Its last physical sighting before that was in Box 1/);
    }
    const lent = ask(w.graph, 'What things are lent out?', { now: w.clock.now });
    expect(lent.type === 'list' && lent.rows.map((x) => x.entity.name)).toEqual(['Camera']);
  });

  it('unknown object → honest "no memory" instead of a guess', () => {
    const w = world();
    const r = ask(w.graph, 'Where is my snorkel?', { now: w.clock.now });
    expect(r.type).toBe('none');
  });

  it('two identical chargers → returns both, never a single guess', () => {
    const w = world();
    const a = item(w.graph, 'Charger', { colors: ['white'] });
    const b = item(w.graph, 'Charger', { colors: ['white'] });
    see(w.graph, a.id, w.deskDrawer.id, T0);
    see(w.graph, b.id, w.topDrawer.id, T0);
    const r = ask(w.graph, 'Where is my charger?', { now: w.clock.now });
    expect(r.type).toBe('candidates');
    if (r.type === 'candidates') expect(r.hits.slice(0, 2).map((h) => h.entity.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('ownership filter: "Where is Revanth\'s charger?"', () => {
    const w = world();
    const mine = item(w.graph, 'Charger', { colors: ['white'] });
    const his = item(w.graph, 'Charger', { colors: ['black'] });
    see(w.graph, mine.id, w.deskDrawer.id, T0);
    see(w.graph, his.id, w.topDrawer.id, T0);
    const revanth = ensurePerson(w.graph, 'Revanth', 'roommate');
    setOwner(w.graph, his.id, revanth.id);
    const r = ask(w.graph, "Where is Revanth's charger?", { now: w.clock.now });
    expect(r.type === 'item' && r.entity.id).toBe(his.id);
  });

  it('box moved → "Where is my coffee grinder?" follows the box', () => {
    const w = world();
    const unit = w.graph.entities((e) => e.name === 'Office')[0];
    moveEntity(w.graph, w.box.id, unit.id, 'qr_scan');
    const r = ask(w.graph, 'Where is my coffee grinder?', { now: w.clock.now });
    expect(r.type === 'item' && r.answer.headline).toMatch(/in Box 1, in the office/);
  });

  it('usual location weighs dwell time', () => {
    const w = world();
    const bag = item(w.graph, 'Travel backpack', {}, { isContainer: true });
    see(w.graph, bag.id, w.bedroom.id, T0);
    see(w.graph, w.passport.id, bag.id, hoursAfter(T0, 24 * 20));
    see(w.graph, w.passport.id, w.topDrawer.id, hoursAfter(T0, 24 * 22));
    const u = usualLocation(w.graph, w.passport.id, hoursAfter(T0, 24 * 40));
    expect(u?.placeId).toBe(w.topDrawer.id);
    const r = ask(w.graph, 'Was my passport ever in my backpack?', { now: hoursAfter(T0, 24 * 40) });
    expect(r.type === 'history' && r.message).toMatch(/^Yes — Passport was recorded in Travel backpack 1 time/);
  });

  it('uncertain-location question includes items not detected in a rescan', () => {
    const w = world();
    w.graph.commit([{ op: 'upsert', table: 'observations', row: buildAbsence(w.graph, w.passport.id, w.topDrawer.id, 'c', hoursAfter(T0, 1).toISOString()) }]);
    const r = ask(w.graph, 'What objects have uncertain locations?', { now: w.clock.now });
    expect(r.type === 'list' && r.rows.map((x) => x.entity.name)).toContain('Passport');
  });
});

describe('free vs pro gating', () => {
  const usage = { items: 0, storageBoxes: 0, aiScansThisMonth: 0 };
  it('free tier has limits, pro does not', () => {
    expect(gate('remember_item', { ...usage, items: FREE_LIMITS.items - 1 }, false).allowed).toBe(true);
    expect(gate('remember_item', { ...usage, items: FREE_LIMITS.items }, false).allowed).toBe(false);
    expect(gate('remember_item', { ...usage, items: 10_000 }, true).allowed).toBe(true);
    expect(gate('create_box', { ...usage, storageBoxes: FREE_LIMITS.storageBoxes }, false).allowed).toBe(false);
    expect(gate('travel_mode', usage, false).allowed).toBe(false);
    expect(gate('travel_mode', usage, true).allowed).toBe(true);
  });
});

describe('travel mode & insights', () => {
  it('ticked "packed" without a sighting in the bag → needs confirmation; seen in bag → packed', () => {
    const clock = deterministic();
    const h = buildHome();
    const bag = item(h.graph, 'Suitcase', {}, { isContainer: true });
    const passport = item(h.graph, 'Passport');
    const charger = item(h.graph, 'Charger');
    see(h.graph, bag.id, h.bedroom.id, T0);
    const trip = createTrip(h.graph, 'Tokyo', [passport.id, charger.id], [bag.id], hoursAfter(T0, 24).toISOString());
    clock.set(hoursAfter(T0, 1));
    setTripItemState(h.graph, trip.id, passport.id, 'packed');
    see(h.graph, charger.id, bag.id, hoursAfter(T0, 2));
    const s = tripStatus(h.graph, trip, hoursAfter(T0, 3));
    expect(s.find((x) => x.itemId === passport.id)!.state).toBe('needs_confirmation');
    expect(s.find((x) => x.itemId === charger.id)!.state).toBe('packed');
    const insights = computeInsights(h.graph, hoursAfter(T0, 3));
    expect(insights.some((i) => i.kind === 'trip_unconfirmed' && i.entityId === passport.id)).toBe(true);
  });

  it('loan older than three weeks produces a reminder', () => {
    const clock = deterministic();
    const h = buildHome();
    const cam = item(h.graph, 'Camera');
    lendItem(h.graph, cam.id, 'Sarah');
    expect(computeInsights(h.graph, hoursAfter(clock.now, 24 * 7)).filter((i) => i.kind === 'loan_overdue')).toHaveLength(0);
    expect(computeInsights(h.graph, hoursAfter(clock.now, 24 * 22)).filter((i) => i.kind === 'loan_overdue')).toHaveLength(1);
  });
});

describe('family questions', () => {
  afterEach(resetDeterminism);
  it('"Where did Dad put the drill?" finds the drill Dad recorded, not mine', () => {
    deterministic();
    const h = buildHome();
    const mine = item(h.graph, 'Drill', { colors: ['yellow'] });
    const dads = item(h.graph, 'Drill', { colors: ['black'] });
    see(h.graph, mine.id, h.deskDrawer.id, T0);
    const o = see(h.graph, dads.id, h.shelf.id, T0);
    h.graph.commit([{ op: 'upsert', table: 'observations', row: { ...o, createdBy: 'dad-uid' } }]);
    expect(parseQuery('Where did Dad put the drill?')).toMatchObject({ intent: 'find', subject: 'drill', addedBy: 'Dad' });
    const r = ask(h.graph, 'Where did Dad put the drill?', { now: hoursAfter(T0, 1), resolveMember: (n) => (n.toLowerCase() === 'dad' ? ['dad-uid'] : null) });
    expect(r.type === 'item' && r.entity.id).toBe(dads.id);
    const unknown = ask(h.graph, 'Where did Grandma put the drill?', { now: hoursAfter(T0, 1), resolveMember: () => null });
    expect(unknown.type).toBe('none');
  });
});
