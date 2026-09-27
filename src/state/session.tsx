import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Network from 'expo-network';
import { ensureSession } from '@/services/supabase';
import { features } from '@/services/env';

/** Cloud session (anonymous by default) + connectivity. The app is fully usable without either. */
interface SessionCtx {
  userId: string | null;
  online: boolean;
  backend: boolean;
}

const Ctx = createContext<SessionCtx>({ userId: null, online: true, backend: false });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false));
    Network.getNetworkStateAsync().then((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!features.backend || !online || userId) return;
    ensureSession()
      .then(setUserId)
      .catch(() => undefined);
  }, [online, userId]);

  return <Ctx.Provider value={{ userId, online, backend: features.backend }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
