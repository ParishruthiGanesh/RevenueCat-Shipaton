import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { MemoryGraph } from '@/core/graph';
import { setIdGenerator } from '@/core/ids';
import { loadGraph, persistMutations } from '@/data/db';

/**
 * Holds the single in-memory knowledge graph for the app, hydrated from SQLite and written
 * through on every commit. Components subscribe to `version` and recompute derived views.
 */

setIdGenerator(() => Crypto.randomUUID());

interface MemoryCtx {
  graph: MemoryGraph;
  ready: boolean;
  error?: string;
}

const Ctx = createContext<MemoryCtx | null>(null);

export function MemoryProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MemoryCtx>(() => ({ graph: new MemoryGraph(), ready: false }));

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let live = true;
    loadGraph()
      .then((data) => {
        if (!live) return;
        const g = new MemoryGraph(data);
        unsub = g.subscribe((mutations) => {
          persistMutations(mutations, { enqueueSync: true }).catch((e) => setState((s) => ({ ...s, error: String(e) })));
        });
        setState({ graph: g, ready: true });
      })
      .catch((e) => live && setState((s) => ({ ...s, ready: true, error: String(e) })));
    return () => {
      live = false;
      unsub?.();
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useMemory(): MemoryCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMemory must be used within MemoryProvider');
  return c;
}

/** Re-renders whenever the graph commits; returns the current version. */
export function useGraphVersion(): number {
  const { graph } = useMemory();
  return useSyncExternalStore(
    (cb) => graph.subscribe(cb),
    () => graph.version,
    () => graph.version,
  );
}

/** Memoised derived value that recomputes when the graph changes. */
export function useDerived<T>(fn: (g: MemoryGraph) => T, deps: unknown[] = []): T {
  const { graph } = useMemory();
  const version = useGraphVersion();
  const depsKey = deps.map(String).join('|');
  // `fn` is intentionally excluded: callers pass inline selectors keyed by `deps`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(graph), [graph, version, depsKey]);
}
