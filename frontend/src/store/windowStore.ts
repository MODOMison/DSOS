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
  | "shadows"
  | "pricing"
  | "account"
  | "cipher"
  | "seal"
  | "sigil"
  | "whisper"
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
  shadows: "Shadows",
  pricing: "Pricing",
  account: "Account",
  cipher: "Cipher Cellar",
  seal: "Seal Breaker",
  sigil: "Sigil Reader",
  whisper: "Whisper Reader",
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
  shadows: { w: 460, h: 600 },
  pricing: { w: 620, h: 540 },
  account: { w: 520, h: 600 },
  cipher: { w: 640, h: 560 },
  seal: { w: 760, h: 680 },
  sigil: { w: 700, h: 720 },
  whisper: { w: 900, h: 700 },
  animator: { w: 540, h: 680 },
};

let idCounter = 0;
const nextId = () => `w${++idCounter}`;

// Report the focused (top-most, non-minimized) window to the Shadow companion
// so it can perch on the active panel. Runs only in the main desktop window
// (never the companion, whose window list is empty) and no-ops in the browser.
function pushFocusedPanel(windows: WindowState[]) {
  if (
    typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("mode") === "companion"
  ) {
    return;
  }
  const w = window as unknown as {
    dsos?: {
      reportPanel?: (
        rect: {
          x: number;
          y: number;
          w: number;
          h: number;
          appId: string;
          title: string;
        } | null
      ) => void;
      debug?: (m: string) => void;
    };
  };
  if (!w.dsos?.reportPanel) return;
  const open = windows.filter((x) => !x.minimized);
  w.dsos.debug?.(`reportPanel: ${open.length} open window(s)`);
  if (open.length === 0) {
    w.dsos.reportPanel(null);
    return;
  }
  const top = open.reduce((a, b) => (b.z > a.z ? b : a));
  w.dsos.reportPanel({
    x: top.x,
    y: top.y,
    w: top.w,
    h: top.h,
    appId: top.appId,
    title: top.title,
  });
}

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
    // Tell the Shadow companion what just opened so it can react in-character.
    // No-op outside Electron (browser) or when the companion isn't running.
    try {
      const w = window as unknown as {
        dsos?: { notifyAppOpen?: (appId: string, title?: string) => void };
      };
      w.dsos?.notifyAppOpen?.(appId, opts?.title ?? titles[appId]);
    } catch {
      /* bridge missing — fine, reactions are best-effort */
    }
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

// Keep the Shadow companion informed of the focused panel on every change
// (open / focus / move / resize / minimize / close) so it can ride it.
useWindowStore.subscribe((state) => pushFocusedPanel(state.windows));

export const APP_TITLES = titles;

export type AppRenderer = (win: WindowState) => ReactNode;
