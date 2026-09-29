import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Network from 'expo-network';
import { router } from 'expo-router';
import { supabase } from '@/services/supabase';
import { features } from '@/services/env';

/**
 * Account session + connectivity.
 *
 * Browsing works without an account. Anything that stores information or costs money —
 * capturing/scanning, saving places, loans, trips, purchases, cloud backup — requires signing
 * in with Apple or Google, so data is tied to a real, recoverable account.
 */

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
  provider?: string;
}

export type SignInReason = 'capture' | 'save' | 'purchase' | 'sync' | 'general';

export interface NextRoute {
  pathname: string;
  params?: Record<string, string>;
}

interface SessionCtx {
  user: SessionUser | null;
  userId: string | null;
  signedIn: boolean;
  /** False until the stored session has been read (avoid flashing the sign-in screen). */
  authReady: boolean;
  online: boolean;
  backend: boolean;
  /**
   * Returns true if the action may proceed. Otherwise opens the sign-in screen, which returns
   * to `next` after a successful sign-in, and returns false.
   */
  requireSignIn: (reason: SignInReason, next?: NextRoute) => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(!features.backend);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false));
    Network.getNetworkStateAsync().then((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    const toUser = (u: { id: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null | undefined): SessionUser | null =>
      u && !(u as { is_anonymous?: boolean }).is_anonymous
        ? { id: u.id, email: u.email, name: (u.user_metadata?.full_name ?? u.user_metadata?.name) as string | undefined, provider: u.app_metadata?.provider as string | undefined }
        : null;
    sb.auth.getSession().then(({ data }) => {
      setUser(toUser(data.session?.user));
      setAuthReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_event, session) => setUser(toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  }, []);

  const signedIn = !!user;

  const requireSignIn = useCallback(
    (reason: SignInReason, next?: NextRoute) => {
      // Builds without a backend (local development) have no accounts to sign in to.
      if (!features.backend || signedIn) return true;
      router.push({ pathname: '/sign-in', params: { reason, ...(next ? { next: JSON.stringify(next) } : {}) } });
      return false;
    },
    [signedIn],
  );

  const value = useMemo<SessionCtx>(
    () => ({ user, userId: user?.id ?? null, signedIn, authReady, online, backend: features.backend, requireSignIn }),
    [user, signedIn, authReady, online, requireSignIn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession must be used within SessionProvider');
  return c;
}
