import { create } from "zustand";
import {
  HAPPY_VARIANTS,
  SAD_VARIANTS,
  THINKING_VARIANTS,
  DANCE_VARIANTS,
  RARE_DANCE_VARIANTS,
  LIFE_VARIANTS,
  IDLE_VARIANTS,
  GREETING_VARIANTS,
  randomFrom,
  weightedPick,
  type AnimationName,
} from "../lib/bvhLoader";

// Central character state — read each frame by VrmCharacter, written by:
//   - ShadowsAI (chat lifecycle events drive mood + speaking + clip triggers)
//   - VrmCharacter itself (when a one-shot clip finishes, clears it)
//   - Future: TTS engine drives mouthAmplitude

export type Mood =
  | "idle"
  | "thinking"
  | "happy"
  | "sad"
  | "surprised"
  | "laughing";

export type Pose =
  | "standing"
  | "sitting"
  | "kneeling"
  | "laying";

export type ClipMode = "loop" | "once";

export interface ActiveClip {
  name: AnimationName;
  mode: ClipMode;
  startedAt: number; // ms epoch — used to avoid double-clearing
}

interface CharacterStore {
  mood: Mood;
  pose: Pose;
  isSpeaking: boolean;

  // What clip is currently requested. `null` means "play the default idle
  // for the current pose". The VrmCharacter component owns the actual
  // AnimationMixer and crossfades when this changes.
  activeClip: ActiveClip | null;

  // Wall-clock of the last user/chat activity. Drives the long-idle dance.
  lastActivity: number;

  // Banned animations — names the user has rated as bad. Read at every
  // random-pick to filter out broken/ugly clips. Persisted to localStorage.
  banned: Set<AnimationName>;
  banClip: (name: AnimationName) => void;
  unbanClip: (name: AnimationName) => void;

  setMood: (m: Mood) => void;
  setPose: (p: Pose) => void;
  setSpeaking: (b: boolean) => void;
  markActivity: () => void;

  // Play a clip. mode='once' clears activeClip when it finishes (via
  // clipFinished), returning to the pose's default idle. mode='loop'
  // sticks until something else replaces it.
  playClip: (name: AnimationName, mode?: ClipMode) => void;
  clipFinished: (name: AnimationName, startedAt: number) => void;

  // Chat lifecycle hooks (called by ShadowsAI)
  onSend: () => void;
  onToolStart: () => void;
  onToolEnd: () => void;
  onTextStream: () => void;
  onResponseDone: () => void;
  onError: () => void;

  // Long-idle dance check (called from VrmCharacter useFrame).
  checkAutoDance: () => void;
}

const BANNED_KEY = "dsos.bannedAnimations";

function loadBanned(): Set<AnimationName> {
  try {
    const raw = localStorage.getItem(BANNED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr as AnimationName[]);
  } catch {
    return new Set();
  }
}
function saveBanned(banned: Set<AnimationName>) {
  try {
    localStorage.setItem(BANNED_KEY, JSON.stringify([...banned]));
  } catch {
    /* localStorage full or unavailable — give up silently */
  }
}

// Random-pick that excludes the current banned set. Falls back to the
// unfiltered pool only if the user banned every clip in it.
function pickAllowed(
  pool: readonly AnimationName[],
  banned: Set<AnimationName>
): AnimationName {
  const allowed = pool.filter((n) => !banned.has(n));
  if (allowed.length === 0) return randomFrom(pool);
  return allowed[Math.floor(Math.random() * allowed.length)];
}

const AUTO_DANCE_AFTER_MS = 60_000; // 60s of no activity → spontaneous dance

export const useCharacter = create<CharacterStore>((set, get) => ({
  mood: "idle",
  pose: "standing",
  isSpeaking: false,
  activeClip: null,
  lastActivity: Date.now(),
  banned: loadBanned(),

  banClip: (name) => {
    set((s) => {
      const next = new Set(s.banned);
      next.add(name);
      saveBanned(next);
      return { banned: next };
    });
  },
  unbanClip: (name) => {
    set((s) => {
      const next = new Set(s.banned);
      next.delete(name);
      saveBanned(next);
      return { banned: next };
    });
  },

  setMood: (mood) => set({ mood }),
  setPose: (pose) => set({ pose, activeClip: null }), // pose change → idle reset
  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  markActivity: () => set({ lastActivity: Date.now() }),

  playClip: (name, mode = "once") => {
    set({
      activeClip: { name, mode, startedAt: Date.now() },
      lastActivity: Date.now(),
    });
  },

  clipFinished: (name, startedAt) => {
    // Only clear if the active clip is still the one that just finished.
    // Guards against a fast-fire sequence (joy → curiosity) where the
    // earlier "finished" event arrives after the next clip has started.
    const ac = get().activeClip;
    if (ac && ac.name === name && ac.startedAt === startedAt) {
      set({ activeClip: null });
    }
  },

  onSend: () => {
    set({ mood: "happy", lastActivity: Date.now() });
    get().playClip(pickAllowed(GREETING_VARIANTS, get().banned), "once");
  },
  onToolStart: () => {
    set({ mood: "thinking", lastActivity: Date.now() });
    get().playClip(pickAllowed(THINKING_VARIANTS, get().banned), "once");
  },
  onToolEnd: () => {
    if (get().mood === "thinking") set({ mood: "idle" });
    set({ lastActivity: Date.now() });
  },
  onTextStream: () => {
    if (!get().isSpeaking) set({ isSpeaking: true });
    set({ lastActivity: Date.now() });
  },
  onResponseDone: () => {
    set({ isSpeaking: false, mood: "happy", lastActivity: Date.now() });
    get().playClip(pickAllowed(HAPPY_VARIANTS, get().banned), "once");
    setTimeout(() => {
      if (get().mood === "happy") set({ mood: "idle" });
    }, 2500);
  },
  onError: () => {
    set({ isSpeaking: false, mood: "sad", lastActivity: Date.now() });
    get().playClip(pickAllowed(SAD_VARIANTS, get().banned), "once");
    setTimeout(() => {
      if (get().mood === "sad") set({ mood: "idle" });
    }, 3500);
  },

  checkAutoDance: () => {
    const { lastActivity, activeClip, banned } = get();
    if (activeClip) return;
    if (Date.now() - lastActivity < AUTO_DANCE_AFTER_MS) return;

    // Filter each pool before the weighted roll so banned clips never get a
    // weighted chance. If a whole category got banned, weightedPick will
    // still degrade gracefully (returns whatever's left).
    const filter = (pool: readonly AnimationName[]) =>
      pool.filter((n) => !banned.has(n));
    const dance = filter(DANCE_VARIANTS);
    const idle = filter(IDLE_VARIANTS);
    const life = filter(LIFE_VARIANTS);
    const rare = filter(RARE_DANCE_VARIANTS);
    if (dance.length + idle.length + life.length + rare.length === 0) return;

    const pick = weightedPick([
      [dance, 60],
      [idle, 20],
      [life, 15],
      [rare, 5],
    ]);
    get().playClip(pick, "once");
    set({ lastActivity: Date.now() });
  },
}));

// Helper: which idle clip to loop for a given pose. All non-standing
// poses currently fall back to the standing idle — no male sit/kneel/lay
// clips exist yet, and no UI path triggers those poses.
export function idleClipForPose(_pose: Pose): AnimationName {
  return "male_idle_2";
}
