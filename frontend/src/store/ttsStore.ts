// Zustand mirror for Shadows voice settings.
// Keeps React controls in sync with the localStorage-backed SpeechSynthesis
// controller without involving the backend.

import { create } from "zustand";
import {
  loadTtsSettings,
  saveTtsSettings,
  type TtsSettings,
} from "../lib/tts";

interface TtsStore {
  settings: TtsSettings;
  patch: (patch: Partial<TtsSettings>) => void;
}

export const useTtsSettings = create<TtsStore>((set, get) => ({
  settings: loadTtsSettings(),
  patch: (patch) => {
    const next = { ...get().settings, ...patch };
    saveTtsSettings(next);
    set({ settings: next });
  },
}));
