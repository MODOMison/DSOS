import { create } from "zustand";
import type { ReactNode } from "react";

export type AppId =
  | "about"
  | "recon"
  | "cve"
  | "brimstone"
  | "soulreader"
  | "armory"
  | "terminal"
  | "oracle"
  | "pricing"
  | "account"
  | "cipher"
  | "seal"
  | "sigil"
  | "animator";

export interface WindowState {
  id: string;
  appId: AppId;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  prevRect?: { x: number; y: number; w: number; h: number };
}

interface WindowStore {
  windows: WindowState[];
  topZ: number;
  open: (appId: AppId, opts?: { title?: string; w?: number; h?: number }) => string;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string, viewportW: number, viewportH: number) => void;
  restoreOrFocus: (appId: AppId) => string;
}

const titles: Record<AppId, string> = {
  about: "About DSOS",
  recon: "Inferno Recon",
  cve: "CVE Oracle",
  brimstone: "Brimstone",
  soulreader: "Soulreader",
  armory: "Armory",
  terminal: "Hellfire Terminal",
  oracle: "Oracle",
  pricing: "Pricing",
  account: "Account",
  cipher: "Cipher Cellar",
  seal: "Seal Breaker",
  sigil: "Sigil Reader",
  animator: "Animator",
};

const defaultSize: Record<AppId, { w: number; h: number }> = {
  about: { w: 520, h: 420 },
  recon: { w: 880, h: 600 },
  cve: { w: 820, h: 600 },
  brimstone: { w: 700, h: 560 },
  soulreader: { w: 780, h: 600 },
  armory: { w: 860, h: 620 },
  terminal: { w: 760, h: 480 },
  oracle: { w: 460, h: 600 },
  pricing: { w: 620, h: 540 },
  account: { w: 520, h: 600 },
  cipher: { w: 640, h: 560 },
  seal: { w: 760, h: 680 },
  sigil: { w: 700, h: 720 },
  animator: { w: 540, h: 680 },
};

let idCounter = 0;
const nextId = () => `w${++idCounter}`;

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  topZ: 10,
  open: (appId, opts) => {
    const id = nextId();
    const size = {
      w: opts?.w ?? defaultSize[appId].w,
      h: opts?.h ?? defaultSize[appId].h,
    };
    const count = get().windows.length;
    const x = 80 + (count % 6) * 36;
    const y = 60 + (count % 6) * 28;
    const z = get().topZ + 1;
    set((s) => ({
      windows: [
        ...s.windows,
        {
          id,
          appId,
          title: opts?.title ?? titles[appId],
          x,
          y,
          w: size.w,
          h: size.h,
          z,
          minimized: false,
          maximized: false,
        },
      ],
      topZ: z,
    }));
    return id;
  },
  close: (id) =>
    set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),
  focus: (id) => {
    const z = get().topZ + 1;
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, z, minimized: false } : w
      ),
      topZ: z,
    }));
  },
  move: (id, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
    })),
  resize: (id, w, h) =>
    set((s) => ({
      windows: s.windows.map((win) =>
        win.id === id ? { ...win, w, h } : win
      ),
    })),
  minimize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w
      ),
    })),
  toggleMaximize: (id, viewportW, viewportH) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.prevRect) {
          return {
            ...w,
            maximized: false,
            x: w.prevRect.x,
            y: w.prevRect.y,
            w: w.prevRect.w,
            h: w.prevRect.h,
            prevRect: undefined,
          };
        }
        return {
          ...w,
          maximized: true,
          prevRect: { x: w.x, y: w.y, w: w.w, h: w.h },
          x: 0,
          y: 0,
          w: viewportW,
          h: viewportH - 56,
        };
      }),
    })),
  restoreOrFocus: (appId) => {
    const existing = get().windows.find((w) => w.appId === appId);
    if (existing) {
      get().focus(existing.id);
      return existing.id;
    }
    return get().open(appId);
  },
}));

export const APP_TITLES = titles;

export type AppRenderer = (win: WindowState) => ReactNode;
