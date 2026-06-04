// Browser SpeechSynthesis wrapper for Shadows voice.
// Owns queueing, persisted settings, voice discovery, and rough mouth amplitude
// events for the VRM jaw.

export interface TtsSettings {
  enabled: boolean;
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: false,
  voiceURI: null,
  rate: 1,
  pitch: 0.9,
};

const KEY_PREFIX = "dsos.tts";

type MouthSubscriber = (amp: number) => void;
type SpeakingSubscriber = (speaking: boolean) => void;

const mouthSubscribers = new Set<MouthSubscriber>();
const speakingSubscribers = new Set<SpeakingSubscriber>();

let queue: Promise<void> = Promise.resolve();
let pendingCount = 0;
let generation = 0;
let mouthOpen = false;
let speaking = false;
let keepAlive: number | null = null;

// Chrome on Windows stalls queued/long synthesis after ~15s and sometimes
// pauses mid-utterance; pumping resume() on an interval keeps it talking.
function startKeepAlive() {
  if (keepAlive !== null || typeof window === "undefined") return;
  keepAlive = window.setInterval(() => {
    const s = synth();
    if (s?.speaking) s.resume();
  }, 5000);
}

function stopKeepAlive() {
  if (keepAlive !== null) {
    window.clearInterval(keepAlive);
    keepAlive = null;
  }
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

export function isSpeechSupported(): boolean {
  return !!synth();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function emitMouthAmplitude(amp: number) {
  for (const cb of mouthSubscribers) cb(amp);
}

function emitSpeaking(speaking: boolean) {
  for (const cb of speakingSubscribers) cb(speaking);
}

function setSpeaking(next: boolean) {
  if (speaking === next) return;
  speaking = next;
  emitSpeaking(next);
}

function selectedVoice(voiceURI: string | null): SpeechSynthesisVoice | null {
  if (!voiceURI) return null;
  return synth()?.getVoices().find((voice) => voice.voiceURI === voiceURI) ?? null;
}

function normalizeSettings(settings: TtsSettings): TtsSettings {
  return {
    enabled: !!settings.enabled,
    voiceURI: settings.voiceURI || null,
    rate: clamp(Number(settings.rate) || DEFAULT_TTS_SETTINGS.rate, 0.5, 2),
    pitch: clamp(Number(settings.pitch) || DEFAULT_TTS_SETTINGS.pitch, 0, 2),
  };
}

function runUtterance(
  text: string,
  settings: TtsSettings,
  utteranceGeneration: number
): Promise<void> {
  const speech = synth();
  if (!speech || !settings.enabled || !text.trim()) return Promise.resolve();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    const voice = selectedVoice(settings.voiceURI);
    if (voice) utterance.voice = voice;

    let closeTimer: number | null = null;
    const closeMouthSoon = () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (utteranceGeneration === generation) emitMouthAmplitude(0.2);
      }, 80);
    };

    utterance.onboundary = (event) => {
      if (utteranceGeneration !== generation) return;
      if (event.name && event.name !== "word" && event.name !== "sentence") return;
      mouthOpen = !mouthOpen;
      emitMouthAmplitude(mouthOpen ? 0.72 : 0.24);
      closeMouthSoon();
    };

    const finish = () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      if (utteranceGeneration === generation) emitMouthAmplitude(0);
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    // A short gap before speaking avoids Chrome's bug of clipping the first
    // word(s) of an utterance queued immediately after the previous one ends.
    window.setTimeout(() => {
      if (utteranceGeneration !== generation) {
        finish();
        return;
      }
      speech.resume();
      speech.speak(utterance);
    }, 90);
  });
}

export function speak(text: string, settings: TtsSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (!normalized.enabled || !text.trim() || !synth()) return Promise.resolve();

  const utteranceGeneration = generation;
  pendingCount += 1;
  setSpeaking(true);
  startKeepAlive();

  const job = queue
    .catch(() => undefined)
    .then(() => {
      if (utteranceGeneration !== generation) return;
      return runUtterance(text, normalized, utteranceGeneration);
    })
    .finally(() => {
      pendingCount = Math.max(0, pendingCount - 1);
      if (pendingCount === 0) {
        stopKeepAlive();
        emitMouthAmplitude(0);
        setSpeaking(false);
      }
    });

  queue = job.then(() => undefined, () => undefined);
  return job;
}

export function cancelSpeech(): void {
  generation += 1;
  pendingCount = 0;
  queue = Promise.resolve();
  mouthOpen = false;
  stopKeepAlive();
  synth()?.cancel();
  emitMouthAmplitude(0);
  setSpeaking(false);
}

export function onMouthAmplitude(cb: MouthSubscriber): () => void {
  mouthSubscribers.add(cb);
  return () => mouthSubscribers.delete(cb);
}

export function onSpeakingChange(cb: SpeakingSubscriber): () => void {
  speakingSubscribers.add(cb);
  return () => speakingSubscribers.delete(cb);
}

export function isTtsSpeaking(): boolean {
  return speaking;
}

export function getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
  const speech = synth();
  if (!speech) return Promise.resolve([]);

  const voices = speech.getVoices();
  if (voices.length > 0) return Promise.resolve(sortPreferredVoices(voices));

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      speech.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(sortPreferredVoices(speech.getVoices()));
    }, 1200);
    const handleVoicesChanged = () => {
      window.clearTimeout(timeout);
      speech.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(sortPreferredVoices(speech.getVoices()));
    };
    speech.addEventListener("voiceschanged", handleVoicesChanged);
  });
}

function sortPreferredVoices(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => voiceScore(b) - voiceScore(a));
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (voice.lang.toLowerCase().startsWith("en")) score += 100;
  if (name.includes("male")) score += 20;
  if (!name.includes("female")) score += 5;
  if (voice.default) score += 3;
  return score;
}

export function loadTtsSettings(): TtsSettings {
  try {
    const enabled = localStorage.getItem(`${KEY_PREFIX}.enabled`);
    const voiceURI = localStorage.getItem(`${KEY_PREFIX}.voiceURI`);
    const rate = localStorage.getItem(`${KEY_PREFIX}.rate`);
    const pitch = localStorage.getItem(`${KEY_PREFIX}.pitch`);
    return normalizeSettings({
      enabled: enabled === "true",
      voiceURI: voiceURI || null,
      rate: rate ? Number(rate) : DEFAULT_TTS_SETTINGS.rate,
      pitch: pitch ? Number(pitch) : DEFAULT_TTS_SETTINGS.pitch,
    });
  } catch {
    return { ...DEFAULT_TTS_SETTINGS };
  }
}

export function saveTtsSettings(settings: TtsSettings): void {
  const normalized = normalizeSettings(settings);
  try {
    localStorage.setItem(`${KEY_PREFIX}.enabled`, String(normalized.enabled));
    if (normalized.voiceURI) {
      localStorage.setItem(`${KEY_PREFIX}.voiceURI`, normalized.voiceURI);
    } else {
      localStorage.removeItem(`${KEY_PREFIX}.voiceURI`);
    }
    localStorage.setItem(`${KEY_PREFIX}.rate`, String(normalized.rate));
    localStorage.setItem(`${KEY_PREFIX}.pitch`, String(normalized.pitch));
  } catch {
    /* localStorage can fail in hardened or private browser contexts. */
  }
}
