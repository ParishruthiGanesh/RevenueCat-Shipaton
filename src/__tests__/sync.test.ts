import { MemoryGraph } from '@/core/graph';
import { resetDeterminism } from '@/core/ids';
import { buildHome, deterministic, item, see, T0 } from '@/core/__tests__/fixtures';

const mockCalls: { table: string; rows: Record<string, unknown>[] }[] = [];
let mockOutbox: { id: number; tbl: string; key: string; op: 'upsert' | 'delete'; data: string | null; attempts: number }[] = [];

jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('@/services/supabase', () => ({
  supabase: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    from: (table: string) => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        mockCalls.push({ table, rows });
        return { error: null };
      },
      delete: () => ({ eq: () => ({ error: null }) }),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
  }),
}));
jest.mock('@/data/db', () => ({
  peekOutbox: async () => mockOutbox,
  ackOutbox: async (ids: number[]) => {
    mockOutbox = mockOutbox.filter((r) => !ids.includes(r.id));
  },
  failOutbox: async () => undefined,
  persistMutations: async () => undefined,
}));

// eslint-disable-next-line import/first -- must load after the jest.mock() calls above
import { pushOutbox } from '@/data/sync';

afterEach(() => {
  resetDeterminism();
  mockCalls.length = 0;
  mockOutbox = [];
});

describe('sync push', () => {
  it('uploads the subject item and its places together with a sighting queued alone', async () => {
    deterministic();
    const h = buildHome();
    const charger = item(h.graph, 'Charger');
    const o = see(h.graph, charger.id, h.deskDrawer.id, T0);
    // Only the sighting is in the mockOutbox (its entity was queued earlier / in a later batch).
    mockOutbox = [{ id: 1, tbl: 'observations', key: o.id, op: 'upsert', data: JSON.stringify(o), attempts: 0 }];
    const r = await pushOutbox(h.graph as MemoryGraph);
    expect(r.error).toBeUndefined();
    const ents = mockCalls.find((c) => c.table === 'entities');
    const obs = mockCalls.find((c) => c.table === 'observations');
    expect(ents?.rows.map((x) => x.id)).toEqual(expect.arrayContaining([charger.id, h.deskDrawer.id, h.desk.id, h.office.id, h.home.id]));
    expect(mockCalls.findIndex((c) => c.table === 'entities')).toBeLessThan(mockCalls.findIndex((c) => c.table === 'observations'));
    // The rooms/furniture/compartments carry their own placements so the chain resolves remotely.
    const subjects = obs!.rows.map((x) => x.subject_id);
    expect(subjects).toEqual(expect.arrayContaining([charger.id, h.deskDrawer.id, h.desk.id, h.office.id]));
  });
});
