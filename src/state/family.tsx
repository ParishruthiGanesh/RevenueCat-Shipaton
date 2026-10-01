import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadFamily, type Family } from '@/services/family';
import { useSession } from './session';

/** The signed-in user's family (if any), plus a userId → name map for "added by Dad". */
interface FamilyCtx {
  family: Family | null;
  loading: boolean;
  error: string | null;
  members: Map<string, string>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<FamilyCtx>({ family: null, loading: false, error: null, members: new Map(), refresh: async () => undefined });

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const { signedIn, userId } = useSession();
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setFamily(null);
      return;
    }
    setLoading(true);
    try {
      setFamily(await loadFamily());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    let live = true;
    if (!signedIn) return;
    loadFamily()
      .then((f) => live && setFamily(f))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [signedIn, userId]);

  const members = useMemo(() => new Map((family?.members ?? []).map((m) => [m.userId, m.isMe ? 'you' : m.name])), [family]);
  const value = useMemo(() => ({ family: signedIn ? family : null, loading, error, members, refresh }), [family, signedIn, loading, error, members, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFamily = () => useContext(Ctx);
