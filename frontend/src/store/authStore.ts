import { create } from "zustand";
import { api, type AuthUser, type Subscription } from "../lib/api";

type Status = "loading" | "anon" | "authed";

interface AuthState {
  status: Status;
  user: AuthUser | null;
  subscription: Subscription | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  subscription: null,

  bootstrap: async () => {
    try {
      const { user, subscription } = await api.auth.me();
      set({ status: "authed", user, subscription });
    } catch {
      set({ status: "anon", user: null, subscription: null });
    }
  },

  login: async (email, password) => {
    const { user, subscription } = await api.auth.login(email, password);
    set({ status: "authed", user, subscription });
  },

  signup: async (email, password) => {
    const { user, subscription } = await api.auth.signup(email, password);
    set({ status: "authed", user, subscription });
  },

  logout: async () => {
    await api.auth.logout().catch(() => {});
    set({ status: "anon", user: null, subscription: null });
  },

  refresh: async () => {
    try {
      const { user, subscription } = await api.auth.me();
      set({ user, subscription });
    } catch {
      /* ignore */
    }
  },
}));
