// Shadows voice controller. Two engines behind one interface:
//   - "piper": neural TTS synthesized in-browser (vits-web / ONNX). Real PCM
//     audio played through Web Audio, so there is no Windows SAPI cold-start
//     that eats the first word. Mouth amplitude comes off an AnalyserNode.
//   - "browser": the OS SpeechSynthesis API. Kept as a fallback; on some
//     Windows boxes it clips the first word of every utterance (cold-start),
//     which is exactly why piper is the default.
// Owns queueing, persisted settings, voice discovery, and mouth amplitude
// events for the VRM jaw.

import * as piper from "@diffusionstudio/vits-web";

export type TtsEngine = "piper" | "browser";

export interface TtsSettings {
  enabled: boolean;
  engine: TtsEngine;
  voiceURI: string | null; // browser engine voice
  piperVoiceId: string; // piper engine voice (vits-web VoiceId)
  rate: number;
  pitch: number;
}

// Curated deep / characterful English Piper voices. Default leans menacing for
// the Shadow persona. Full catalog is huge; this is the useful English subset.
export interface PiperVoiceOption {
  id: string;
  label: string;
}

export const PIPER_VOICES: PiperVoiceOption[] = [
  { id: "en_GB-alan-medium", label: "Alan — British male (deep, default)" },
  { id: "en_GB-northern_english_male-medium", label: "Northern English male" },
  { id: "en_US-ryan-high", label: "Ryan — US male (crisp)" },
  { id: "en_US-joe-medium", label: "Joe — US male" },
  { id: "en_US-hfc_male-medium", label: "HFC — US male" },
  { id: "en_GB-alba-medium", label: "Alba — Scottish female" },
  { id: "en_US-hfc_female-medium", label: "HFC — US female" },
  { id: "en_US-amy-medium", label: "Amy — US female" },
];

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: false,
  engine: "piper",
  voiceURI: null,
  piperVoiceId: "en_GB-alan-medium",
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
    engine: settings.engine === "browser" ? "browser" : "piper",
    voiceURI: settings.voiceURI || null,
    piperVoiceId: settings.piperVoiceId || DEFAULT_TTS_SETTINGS.piperVoiceId,
    rate: clamp(Number(settings.rate) || DEFAULT_TTS_SETTINGS.rate, 0.5, 2),
    pitch: clamp(Number(settings.pitch) || DEFAULT_TTS_SETTINGS.pitch, 0, 2),
  };
}

// ---- Piper (neural) engine --------------------------------------------------

let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let mouthRaf: number | null = null;
// In-flight / completed model preloads, keyed by voiceId, so we never kick off
// the same download twice.
const piperPrep = new Map<string, Promise<void>>();

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

// Make sure the chosen Piper model is downloaded/cached and the AudioContext is
// running. Safe to call repeatedly (e.g. on every send) — the download only
// happens once and is memoized. Must be reachable from a user gesture so the
// AudioContext can resume.
export async function prepareVoice(settings: TtsSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (!normalized.enabled || normalized.engine !== "piper") return;
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* resume can reject if not from a gesture; the next play retries */
    }
  }
  const voiceId = normalized.piperVoiceId;
  let prep = piperPrep.get(voiceId);
  if (!prep) {
    prep = (async () => {
      const stored = await piper.stored();
      if (!stored.includes(voiceId as piper.VoiceId)) {
        await piper.download(voiceId as piper.VoiceId);
      }
    })();
    // If the download fails, drop the memo so a later send can retry.
    prep.catch(() => piperPrep.delete(voiceId));
    piperPrep.set(voiceId, prep);
  }
  await prep;
}

function runPiperUtterance(
  text: string,
  settings: TtsSettings,
  utteranceGeneration: number
): Promise<void> {
  const trimmed = text.trim();
  if (!settings.enabled || !trimmed) return Promise.resolve();

  return (async () => {
    let wav: Blob;
    try {
      await prepareVoice(settings);
      if (utteranceGeneration !== generation) return;
      wav = await piper.predict({
        text: trimmed,
        voiceId: settings.piperVoiceId as piper.VoiceId,
      });
    } catch (err) {
      console.error("[piper] synthesis failed", err);
      return;
    }
    if (utteranceGeneration !== generation) return;

    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }

    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await wav.arrayBuffer());
    } catch (err) {
      console.error("[piper] decode failed", err);
      return;
    }
    if (utteranceGeneration !== generation) return;

    await new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = settings.rate;
      // Pitch < 1 drops the voice (darker/menacing). detune also slows slightly,
      // which suits the persona. ~±600 cents over the 0–2 pitch range.
      source.detune.value = (settings.pitch - 1) * 600;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      currentSource = source;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const pump = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        if (utteranceGeneration === generation) {
          emitMouthAmplitude(clamp(rms * 3.2, 0, 1));
        }
        mouthRaf = requestAnimationFrame(pump);
      };

      const finish = () => {
        if (mouthRaf !== null) {
          cancelAnimationFrame(mouthRaf);
          mouthRaf = null;
        }
        if (currentSource === source) currentSource = null;
        if (utteranceGeneration === generation) emitMouthAmplitude(0);
        resolve();
      };

      source.onended = finish;
      pump();
      try {
        source.start();
      } catch {
        finish();
      }
    });
  })();
}

function stopPiperPlayback() {
  if (mouthRaf !== null) {
    cancelAnimationFrame(mouthRaf);
    mouthRaf = null;
  }
  if (currentSource) {
    try {
      currentSource.onended = null;
      currentSource.stop();
    } catch {
      /* already stopped */
    }
    currentSource = null;
  }
}

// ---- Browser (SpeechSynthesis) engine ---------------------------------------

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
  if (!normalized.enabled || !text.trim()) return Promise.resolve();
  // The browser engine needs SpeechSynthesis; piper only needs Web Audio.
  if (normalized.engine === "browser" && !synth()) return Promise.resolve();

  const utteranceGeneration = generation;
  pendingCount += 1;
  setSpeaking(true);
  if (normalized.engine === "browser") startKeepAlive();

  const job = queue
    .catch(() => undefined)
    .then(() => {
      if (utteranceGeneration !== generation) return;
      return normalized.engine === "piper"
        ? runPiperUtterance(text, normalized, utteranceGeneration)
        : runUtterance(text, normalized, utteranceGeneration);
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
  stopWarmup();
  stopPiperPlayback();
  synth()?.cancel();
  emitMouthAmplitude(0);
  setSpeaking(false);
}

let warmupTimer: number | null = null;

// Keep the Windows SAPI / Web Speech engine spun up while the model is still
// generating its reply. Cold-start latency (~1s, variable) eats the first word
// of the first utterance after the engine has gone idle; firing silent
// throwaway utterances on an interval keeps it hot so the real reply starts
// cleanly. Call on send, pair with speakWarm() / stopWarmup() when the reply
// is ready.
export function startWarmup(settings: TtsSettings): void {
  const normalized = normalizeSettings(settings);
  // Piper synthesizes real audio — no SAPI cold-start to warm around.
  if (normalized.engine !== "browser") return;
  if (!normalized.enabled || !synth()) return;
  stopWarmup();
  const tick = () => {
    const s = synth();
    if (!s) return;
    if (s.speaking || s.pending) {
      s.resume();
      return;
    }
    const u = new SpeechSynthesisUtterance(" "); // thin space — inaudible
    u.volume = 0;
    const voice = selectedVoice(normalized.voiceURI);
    if (voice) u.voice = voice;
    s.speak(u);
  };
  tick();
  warmupTimer = window.setInterval(tick, 2500);
}

export function stopWarmup(): void {
  if (warmupTimer !== null) {
    window.clearInterval(warmupTimer);
    warmupTimer = null;
  }
}

// Speak the real reply off the back of the warm-up pump: stop priming, flush
// any in-flight silent utterance (so the reply isn't queued back-to-back behind
// one — which itself clips), then speak after a short gap. The gap is long
// enough to escape the back-to-back clip yet short enough that the engine is
// still warm from the just-stopped pump.
export function speakWarm(text: string, settings: TtsSettings): void {
  const normalized = normalizeSettings(settings);
  const trimmed = text.trim();
  if (!trimmed || !normalized.enabled) return;
  // Piper has no cold-start clip — speak straight away.
  if (normalized.engine === "piper") {
    void speak(trimmed, normalized);
    return;
  }
  if (!synth()) return;
  stopWarmup();
  synth()?.cancel();
  window.setTimeout(() => void speak(trimmed, normalized), 220);
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
    const engine = localStorage.getItem(`${KEY_PREFIX}.engine`);
    const voiceURI = localStorage.getItem(`${KEY_PREFIX}.voiceURI`);
    const piperVoiceId = localStorage.getItem(`${KEY_PREFIX}.piperVoiceId`);
    const rate = localStorage.getItem(`${KEY_PREFIX}.rate`);
    const pitch = localStorage.getItem(`${KEY_PREFIX}.pitch`);
    return normalizeSettings({
      enabled: enabled === "true",
      engine: engine === "browser" ? "browser" : "piper",
      voiceURI: voiceURI || null,
      piperVoiceId: piperVoiceId || DEFAULT_TTS_SETTINGS.piperVoiceId,
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
    localStorage.setItem(`${KEY_PREFIX}.engine`, normalized.engine);
    localStorage.setItem(`${KEY_PREFIX}.piperVoiceId`, normalized.piperVoiceId);
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
