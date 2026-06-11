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
  | "laughing"
  | "annoyed";

// Where on the body the user poked. Drives which quip/reaction plays.
export type PokeRegion = "head" | "body" | "legs";

// A one-shot reaction surfaced to the UI (floating bubble + emote + voice).
// `id` increments every poke so subscribers re-fire even when the same line
// repeats.
export interface Reaction {
  id: number;
  text: string;
  emote: string;
}

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

// ── Poke reaction lines — Matt's Shadow persona: dry, a little dangerous,
// never actually mad at you. Keyed by escalation tier so spamming pokes
// walks him from amused → done-with-it. {emote} pops above his head.
interface Quip {
  text: string;
  emote: string;
}
const POKE_LINES: {
  head: Quip[];
  body: Quip[];
  legs: Quip[];
  tickled: Quip[];
  annoyed: Quip[];
  enough: Quip[];
} = {
  head: [
    { text: "Hey — watch the hair.", emote: "!" },
    { text: "Poke the brain, get a bite back.", emote: "!" },
    { text: "That's where I keep the secrets.", emote: "?" },
  ],
  body: [
    { text: "Easy. I'm made of shadow, not stone.", emote: "!" },
    { text: "You looking for something?", emote: "?" },
    { text: "I felt that. Barely.", emote: "!" },
  ],
  legs: [
    { text: "Down there? Bold move.", emote: "?" },
    { text: "Careful, I bite below the knee.", emote: "!" },
  ],
  tickled: [
    { text: "Okay, okay — I'm awake.", emote: "♪" },
    { text: "Ha — stop, that actually tickles.", emote: "♪" },
    { text: "You're enjoying this way too much.", emote: "♪" },
  ],
  annoyed: [
    { text: "You really don't have an exploit to write?", emote: "…" },
    { text: "I have infinite patience. You're testing the theory.", emote: "…" },
  ],
  enough: [
    { text: "...Fine. Poke the void. See what pokes back.", emote: "⚡" },
    { text: "Enough. I'm logging this as a brute-force attempt.", emote: "⚡" },
  ],
};

// ── Physical-interaction lines. Same Shadow persona: dry, a little dangerous,
// secretly enjoying the attention. Surfaced as a floating bubble + voice.
const GRAB_LINES: Quip[] = [
  { text: "Hey — hands. Gentle.", emote: "!" },
  { text: "Put me down... or don't.", emote: "!" },
  { text: "Whoa — careful with the merchandise.", emote: "!" },
  { text: "Manhandling the void. Bold.", emote: "!" },
];
const PERCH_LINES: Quip[] = [
  { text: "Good spot. I'll keep watch from here.", emote: "♪" },
  { text: "Perched. Don't mind me.", emote: "♪" },
  { text: "I like this view of your mess.", emote: "♪" },
  { text: "Set. Wake me when something breaks.", emote: "♪" },
];
const THROW_LINES: Quip[] = [
  { text: "Wheee — rude, but fun.", emote: "⚡" },
  { text: "You throw me, I land. Always.", emote: "⚡" },
  { text: "...We're doing this, huh.", emote: "⚡" },
];
// Per-app one-liners. Keyed by windowStore AppId; falls back to `_default`.
const APP_LINES: Record<string, string> = {
  terminal: "The terminal. Now we're talking.",
  recon: "Recon. Let's see what's hiding.",
  cve: "Hunting CVEs? I'll hold the light.",
  brimstone: "Brimstone. Bring the heat.",
  soulreader: "Reading souls again. Voyeur.",
  armory: "Pick a weapon. I'll judge your choice.",
  cipher: "Secrets. My favorite flavor.",
  seal: "Breaking seals. Careful.",
  sigil: "Sigils. Mind what you summon.",
  whisper: "I'm listening.",
  animator: "Making me dance? Fine.",
  account: "Checking the books?",
  pricing: "Worth every coin. Obviously.",
  about: "Reading about me? Flattering.",
  shadows: "You rang?",
  _default: "Opening that, are we?",
};

interface CharacterStore {
  mood: Mood;
  pose: Pose;
  isSpeaking: boolean;

  // Latest poke reaction for the UI to surface (bubble + emote + voice).
  reaction: Reaction | null;
  // Internal poke-spam tracking — how many quick taps in a row, and when.
  pokeCount: number;
  lastPokeAt: number;
  // Called by VrmCharacter when the user clicks the character body.
  pokeReaction: (region: PokeRegion) => void;

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

  // Physical-interaction hooks (called by companionControl).
  onGrabbed: () => void; // picked up and dragged
  onPerch: () => void; // snapped to a screen edge / sat down
  onLanded: () => void; // thrown and landed (no edge)
  // App-awareness: the desktop opened an app; Shadow comments on it.
  appReaction: (appId: string) => void;
  // Riding: he just hopped onto / switched to a focused panel — sit + comment.
  onRidePanel: (appId: string) => void;

  // Chat lifecycle hooks (called by ShadowsAI)
  onSend: () => void;
  onToolStart: () => void;
  onToolEnd: () => void;
  onTextStream: () => void;
  onResponseDone: (keepSpeaking?: boolean) => void;
  onError: () => void;

  // Long-idle dance check (called from VrmCharacter useFrame).
  checkAutoDance: () => void;
}

// Monotonic id so the UI re-fires a reaction even when the quip text repeats.
let reactionSeq = 0;
function nextReactionId(): number {
  return ++reactionSeq;
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
  reaction: null,
  pokeCount: 0,
  lastPokeAt: 0,
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
  onResponseDone: (keepSpeaking = false) => {
    set({ isSpeaking: keepSpeaking, mood: "happy", lastActivity: Date.now() });
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

  onGrabbed: () => {
    const now = Date.now();
    const quip = randomFrom(GRAB_LINES);
    set({
      mood: "surprised",
      pose: "standing", // stand up when yanked off a perch
      lastActivity: now,
      reaction: { id: nextReactionId(), text: quip.text, emote: quip.emote },
      activeClip: { name: "male_surprised", mode: "once", startedAt: now },
    });
  },

  onPerch: () => {
    const now = Date.now();
    const quip = randomFrom(PERCH_LINES);
    set({
      mood: "idle",
      pose: "sitting", // VrmCharacter swaps to the sit idle for this pose
      lastActivity: now,
      reaction: { id: nextReactionId(), text: quip.text, emote: quip.emote },
      activeClip: null,
    });
  },

  onLanded: () => {
    const now = Date.now();
    const quip = randomFrom(THROW_LINES);
    set({
      mood: "happy",
      lastActivity: now,
      reaction: { id: nextReactionId(), text: quip.text, emote: quip.emote },
    });
    setTimeout(() => {
      if (get().mood === "happy") set({ mood: "idle" });
    }, 2000);
  },

  appReaction: (appId) => {
    const now = Date.now();
    const text = APP_LINES[appId] ?? APP_LINES._default;
    set({
      mood: "thinking",
      lastActivity: now,
      reaction: { id: nextReactionId(), text, emote: "…" },
      activeClip: {
        name: pickAllowed(GREETING_VARIANTS, get().banned),
        mode: "once",
        startedAt: now,
      },
    });
    setTimeout(() => {
      if (get().mood === "thinking") set({ mood: "idle" });
    }, 2200);
  },

  onRidePanel: (appId) => {
    const now = Date.now();
    const text = APP_LINES[appId] ?? APP_LINES._default;
    set({
      pose: "sitting", // perched on the panel's edge
      mood: "idle",
      lastActivity: now,
      reaction: { id: nextReactionId(), text, emote: "♪" },
      activeClip: null, // fall back to the sit idle for the sitting pose
    });
  },

  pokeReaction: (region) => {
    const now = Date.now();
    const s = get();
    // Pokes within 2.5s of each other count as a streak; otherwise reset.
    const streak = now - s.lastPokeAt < 2500 ? s.pokeCount + 1 : 1;

    let mood: Mood;
    let quip: Quip;
    let clip: AnimationName;
    if (streak >= 10) {
      mood = "annoyed";
      quip = randomFrom(POKE_LINES.enough);
      clip = "male_dismissing_2";
    } else if (streak >= 7) {
      mood = "annoyed";
      quip = randomFrom(POKE_LINES.annoyed);
      clip = "male_dismissing";
    } else if (streak >= 4) {
      // Getting tickled — he cracks and laughs.
      mood = "laughing";
      quip = randomFrom(POKE_LINES.tickled);
      clip = pickAllowed(HAPPY_VARIANTS, s.banned);
    } else {
      mood = "surprised";
      quip = randomFrom(POKE_LINES[region]);
      clip = "male_surprised";
    }

    set({
      mood,
      pokeCount: streak,
      lastPokeAt: now,
      lastActivity: now,
      reaction: { id: nextReactionId(), text: quip.text, emote: quip.emote },
      activeClip: { name: clip, mode: "once", startedAt: now },
    });

    // Settle back to idle once the moment passes (unless a newer poke or chat
    // event moved the mood on in the meantime).
    setTimeout(() => {
      if (get().mood === mood && get().lastPokeAt === now) {
        set({ mood: "idle" });
      }
    }, 2600);
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

// Helper: which idle clip to loop for a given pose. The sit/kneel/lay slots
// currently alias the standing idle in bvhLoader (no dedicated male clips yet),
// but routing through them means dropping a real sit_idle.fbx later instantly
// lights up edge-perching — no code change needed.
export function idleClipForPose(pose: Pose): AnimationName {
  switch (pose) {
    case "sitting":
      return "sit_idle";
    case "kneeling":
      return "kneel_idle";
    case "laying":
      return "laying_idle";
    default:
      return "male_idle_2";
  }
}
