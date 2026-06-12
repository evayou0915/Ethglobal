"use client";

/**
 * Session-token store for the self-issued SIWE JWT.
 *
 * The token lives in localStorage (key `aurasci.jwt`) so sessions survive
 * page reloads, and is mirrored into a zustand store so React components
 * can subscribe to login/logout transitions. `jsonFetch` in api.ts reads
 * it synchronously via `authToken.current()` when building the
 * Authorization header — no React context required.
 *
 * `ready` starts false and flips true after the first client-side mount
 * reads localStorage. Gate any "show Login button?" UI on it to avoid a
 * hydration flash for users who are already signed in.
 */
import { useEffect } from "react";
import { create } from "zustand";

const STORAGE_KEY = "aurasci.jwt";

type AuthState = {
  ready: boolean;
  token: string | null;
  hydrate: () => void;
  setToken: (token: string | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  ready: false,
  token: null,
  hydrate: () => {
    let token: string | null = null;
    try { token = localStorage.getItem(STORAGE_KEY); } catch { /* SSR / private mode */ }
    set({ ready: true, token });
  },
  setToken: (token) => {
    try {
      if (token) localStorage.setItem(STORAGE_KEY, token);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    set({ token });
  },
}));

/** Non-React accessor for the current token (used by api.ts). Falls back
 *  to localStorage directly so requests fired before hydration still
 *  carry the header. */
export const authToken = {
  current(): string | null {
    const s = useAuthStore.getState();
    if (s.ready) return s.token;
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  },
  set(token: string | null) {
    useAuthStore.getState().setToken(token);
  },
  clear() {
    useAuthStore.getState().setToken(null);
  },
};

/** Auth state for components: `ready` (localStorage read), `authenticated`
 *  (a session token is present). The pinned wallet / role come from the
 *  /me query — see useSession() in hooks.ts. */
export function useAuth(): { ready: boolean; authenticated: boolean } {
  const ready = useAuthStore((s) => s.ready);
  const token = useAuthStore((s) => s.token);
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    if (!useAuthStore.getState().ready) hydrate();
  }, [hydrate]);
  return { ready, authenticated: Boolean(token) };
}
