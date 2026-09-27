import { MemoryGraph } from '../graph';
import { setClock, setIdGenerator } from '../ids';
import { createEntity, ensurePlace, recordSighting, type SightingInput } from '../operations';
import type { Entity, VisualAttributes } from '../types';

export const T0 = new Date('2026-09-22T20:14:00');

let seq = 0;
export function deterministic(start: Date = T0) {
  seq = 0;
  let current = start;
  setIdGenerator(() => `id-${++seq}`);
  setClock(() => current);
  return {
    set(d: Date) {
      current = d;
    },
    advanceHours(h: number) {
      current = new Date(current.getTime() + h * 3600e3);
      return current;
    },
    get now() {
      return current;
    },
  };
}

export const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3600e3);
export const iso = (d: Date) => d.toISOString();

export interface Home {
  graph: MemoryGraph;
  home: Entity;
  bedroom: Entity;
  office: Entity;
  garage: Entity;
  dresser: Entity;
  topDrawer: Entity;
  middleDrawer: Entity;
  desk: Entity;
  deskDrawer: Entity;
  shelf: Entity;
}

/** Home › Bedroom › Black dresser › Top drawer … the canonical test apartment. */
export function buildHome(): Home {
  const graph = new MemoryGraph();
  const home = createEntity(graph, { kind: 'space', name: 'Home', spaceType: 'home' });
  const bedroom = ensurePlace(graph, home.id, 'Bedroom', 'room');
  const office = ensurePlace(graph, home.id, 'Office', 'room');
  const garage = ensurePlace(graph, home.id, 'Garage', 'room');
  const dresser = ensurePlace(graph, bedroom.id, 'Black dresser', 'fixture');
  const topDrawer = ensurePlace(graph, dresser.id, 'Top drawer', 'container');
  const middleDrawer = ensurePlace(graph, dresser.id, 'Middle drawer', 'container');
  const desk = ensurePlace(graph, office.id, 'Desk', 'fixture');
  const deskDrawer = ensurePlace(graph, desk.id, 'Left drawer', 'container');
  const shelf = ensurePlace(graph, garage.id, 'Metal shelf', 'fixture');
  return { graph, home, bedroom, office, garage, dresser, topDrawer, middleDrawer, desk, deskDrawer, shelf };
}

export function item(graph: MemoryGraph, name: string, attrs: Partial<VisualAttributes> = {}, extra: Partial<Entity> = {}): Entity {
  return createEntity(graph, { kind: 'item', name, attributes: attrs, category: extra.category, description: extra.description, isContainer: extra.isContainer, sensitive: extra.sensitive });
}

export function see(graph: MemoryGraph, subjectId: string, parentId: string, at: Date, extra: Partial<SightingInput> = {}) {
  return recordSighting(graph, { subjectId, parentId, source: 'camera_capture', observedAt: at.toISOString(), ...extra });
}
