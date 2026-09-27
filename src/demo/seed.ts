import type { MemoryGraph } from '@/core/graph';
import { buildAbsence, createEntity, createStorageBox, ensurePlace, lendItem, recordSighting } from '@/core/operations';

/**
 * DEV-ONLY demo scenario mirroring the Shipaton script (no photos; clearly marked).
 * Real demos use real captures — this exists so UI states can be reviewed without a camera,
 * and it's exercised by tests so the scenario can't silently rot.
 */
export function seedDemo(graph: MemoryGraph, now: Date = new Date()) {
  const at = (daysAgo: number, hour = 20, min = 14) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };
  const home = graph.spaces()[0] ?? createEntity(graph, { kind: 'space', name: 'Home', spaceType: 'home' });
  const bedroom = ensurePlace(graph, home.id, 'Bedroom', 'room');
  const office = ensurePlace(graph, home.id, 'Office', 'room');
  const storage = ensurePlace(graph, home.id, 'Storage room', 'room');
  const dresser = ensurePlace(graph, bedroom.id, 'Black dresser', 'fixture');
  const top = ensurePlace(graph, dresser.id, 'Top drawer', 'container');
  const desk = ensurePlace(graph, office.id, 'Desk', 'fixture');
  const shelf = ensurePlace(graph, storage.id, 'Shelf B', 'fixture');

  const pouch = createEntity(graph, { kind: 'item', name: 'Blue document pouch', isContainer: true, attributes: { colors: ['blue'] }, category: 'bags/pouch' });
  const passport = createEntity(graph, { kind: 'item', name: 'Passport', sensitive: true, category: 'documents' });
  const backpack = createEntity(graph, { kind: 'item', name: 'Travel backpack', isContainer: true, attributes: { colors: ['black'] }, category: 'bags' });
  const sunglasses = createEntity(graph, { kind: 'item', name: 'Sunglasses', attributes: { colors: ['black'] } });
  const watch = createEntity(graph, { kind: 'item', name: 'Watch', attributes: { colors: ['silver'] } });

  recordSighting(graph, { subjectId: backpack.id, parentId: bedroom.id, source: 'camera_capture', observedAt: at(25), relation: 'ON_TOP_OF' });
  recordSighting(graph, { subjectId: passport.id, parentId: desk.id, relation: 'ON_TOP_OF', source: 'camera_capture', observedAt: at(23, 10, 5) });
  recordSighting(graph, { subjectId: passport.id, parentId: top.id, source: 'camera_capture', observedAt: at(17, 21, 30) });
  recordSighting(graph, { subjectId: passport.id, parentId: backpack.id, source: 'camera_capture', observedAt: at(5, 9, 12) });
  recordSighting(graph, { subjectId: pouch.id, parentId: top.id, source: 'camera_capture', observedAt: at(4) });
  recordSighting(graph, { subjectId: passport.id, parentId: pouch.id, source: 'camera_capture', observedAt: at(4), verification: 'confirmed' });
  for (const x of [sunglasses, watch]) recordSighting(graph, { subjectId: x.id, parentId: top.id, source: 'area_scan', observedAt: at(4) });

  const box = createStorageBox(graph, { parentId: shelf.id, category: 'Electronics' });
  const items = ['Headphones', 'Laptop charger', 'Camera', 'HDMI adapter'].map((n) => createEntity(graph, { kind: 'item', name: n, category: 'electronics' }));
  for (const it of items) recordSighting(graph, { subjectId: it.id, parentId: box.id, source: 'box_scan', observedAt: at(3, 18, 40) });

  // Rescan of the drawer today without the passport → honest "not detected".
  const rescan = at(0, now.getHours(), Math.max(0, now.getMinutes() - 5));
  for (const x of [sunglasses, watch]) recordSighting(graph, { subjectId: x.id, parentId: top.id, source: 'area_scan', observedAt: rescan });
  graph.commit([{ op: 'upsert', table: 'observations', row: buildAbsence(graph, pouch.id, top.id, undefined, rescan) }]);

  lendItem(graph, items[0].id, 'Sarah', { at: at(22) });
  return { passport, box, camera: items[2] };
}
