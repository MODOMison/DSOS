# Shadow voice/TTS

## Goal

Shadow speaks chat responses aloud using the browser's `SpeechSynthesis` API. The avatar's mouth syncs to speech. User can enable/disable in settings and pick a voice.

## Acceptance criteria

When user toggles voice ON in settings and sends a chat:

1. As Shadow streams a response, sentences are spoken **one at a time as they complete** (don't wait for the full response — speak sentence-by-sentence).
2. While Shadow is speaking, the VRM avatar's mouth opens/closes in time with the speech (rough jaw-flap based on word boundaries is fine — no need for true phoneme-level lipsync).
3. While Shadow is speaking, `useCharacter.getState().isSpeaking === true`. When the queue drains, it flips to `false`.
4. If the user sends a new chat mid-speech, the current speech queue is cancelled before the new response starts.
5. The settings panel lets the user:
   - Toggle voice ON/OFF (persisted to localStorage under `dsos.tts.enabled`)
   - Select a voice from `speechSynthesis.getVoices()` filtered to English male voices when possible (persisted to `dsos.tts.voiceURI`)
   - Adjust rate (0.5–2x, default 1.0) and pitch (0–2, default 0.9 for a slightly-deep Shadow)
6. Voice OFF = no TTS, no lipsync, mouth stays closed. Default is OFF on first run (don't surprise users with sound).

## Files

### NEW: `frontend/src/lib/tts.ts`

Self-contained TTS controller. Exports:

```typescript
export interface TtsSettings {
  enabled: boolean;
  voiceURI: string | null;  // null = browser default
  rate: number;              // 0.5–2
  pitch: number;             // 0–2
}

export const DEFAULT_TTS_SETTINGS: TtsSettings;

// Speak a chunk of text. Queues if something is already speaking.
// Returns a promise that resolves when this chunk finishes.
export function speak(text: string, settings: TtsSettings): Promise<void>;

// Cancel everything currently queued/speaking.
export function cancelSpeech(): void;

// Subscribe to mouth-open amplitude (0..1). Called on every `boundary` event
// while speech is active. Subscriber should drive VRM mouthOpenRef.
export function onMouthAmplitude(cb: (amp: number) => void): () => void;

// Get available voices, refreshed if browser hasn't loaded them yet.
export function getAvailableVoices(): Promise<SpeechSynthesisVoice[]>;

// Persist + restore from localStorage under "dsos.tts".
export function loadTtsSettings(): TtsSettings;
export function saveTtsSettings(s: TtsSettings): void;
```

Implementation notes:
- Use `SpeechSynthesisUtterance`. Each `speak()` creates one utterance, attaches `onboundary` to emit mouth amplitudes, attaches `onend` to resolve the promise.
- For mouth amplitude on `onboundary`: alternate between ~0.7 (open) and ~0.2 (close) on each word boundary. Reset to 0 on `onend`. Crude but reads as talking.
- `speechSynthesis.getVoices()` returns `[]` until voices load asynchronously — wait for the `voiceschanged` event before resolving `getAvailableVoices()`.
- Cancel any current utterance with `speechSynthesis.cancel()` before starting a new chunk if `cancelSpeech()` was called.

### MODIFY: `frontend/src/apps/ShadowsAI.tsx`

Where the AI response stream is consumed (look for `api.ai.stream` and the `onTextStream`/`onResponseDone` lifecycle calls):

- Maintain a `sentenceBuffer` string as text deltas arrive.
- When the buffer contains a sentence terminator (`.`, `!`, `?`, or newline) followed by space/EOF, peel off the completed sentence, call `tts.speak(sentence, settings)`, leave the rest in buffer.
- On stream done, flush any remaining buffer through `tts.speak`.
- On `onSend` (new user message), call `tts.cancelSpeech()` first.

Pull TTS settings from `useTtsSettings` (a new tiny hook in `frontend/src/store/ttsStore.ts` — Zustand store mirroring localStorage).

### MODIFY: `frontend/src/store/characterStore.ts`

- The existing `setSpeaking(b)` already drives `isSpeaking`. TTS controller should call it: `true` on first utterance start, `false` when the queue empties (subscribe to TTS state in the ShadowsAI component).
- No structural changes to the store needed.

### MODIFY: `frontend/src/components/VrmCharacter.tsx`

- The `Character` component already accepts `mouthOpenRef`. Currently it's not driven by anything visible. Wire it: subscribe to `tts.onMouthAmplitude` in a `useEffect` and write the value into `mouthOpenRef.current`.
- The VRM expression for jaw open is typically `VRMExpressionPresetName.Aa`. Apply it via `vrm.expressionManager?.setValue("aa", mouthOpenRef.current)` in the `useFrame` loop (right where the mixer updates).
- Decay mouth amplitude over ~80ms so it doesn't snap-close between boundaries (smooth lerp toward 0).

### MODIFY: `frontend/src/components/ShadowsSettingsMenu.tsx`

Add a new section "Voice" below the existing settings:

- Checkbox: "Speak responses aloud" → toggles `enabled`
- When enabled, show:
  - Dropdown: voice picker (filter to English voices, prefer male — `voice.lang.startsWith("en")` and `voice.name.toLowerCase().includes("male") || !voice.name.toLowerCase().includes("female")`)
  - Slider: Rate (0.5–2, step 0.1)
  - Slider: Pitch (0–2, step 0.1)
- Calls `saveTtsSettings` on every change.

## Out of scope

- Phoneme-level lipsync (jaw flap on word boundaries is good enough for v1)
- ElevenLabs / premium voice integration (future feature)
- Backend TTS (everything client-side)
- Recording / saving audio
- Multi-language voice support (English-only filter)

## Testing

After implementation, verify:

1. Toggle voice OFF → send chat → no audio, mouth stays closed. ✓
2. Toggle voice ON → send chat → audio plays, mouth animates, `isSpeaking` true during speech.
3. Send a second chat mid-speech → first chat stops mid-sentence, second chat speaks.
4. Refresh page → settings persist (voice still ON, same voice selected).
5. Long response → sentences are spoken as they stream, not all at the end.

## Code style

- Match existing patterns: Tailwind for styling, Zustand for state, TypeScript strict mode.
- No comments explaining what the code does — only WHY (non-obvious constraints, browser quirks, etc.).
- New files include a 2–3 line file header comment summarizing their purpose.

## Branch + commit

Work on a new branch from `avatar/male`: `feature/shadow-tts`. Single commit when done, message format:

```
Add Shadow voice/TTS

* New tts.ts wrapping SpeechSynthesis with queue + boundary-based
  mouth amplitudes; settings persisted under dsos.tts.
* ShadowsAI peels sentences from the response stream as they
  complete and speaks them; cancels on new user message.
* VrmCharacter drives jaw-open via expressionManager from the TTS
  amplitude stream with ~80ms smoothing.
* Settings panel adds Voice section: toggle, voice picker (English
  male preferred), rate/pitch sliders.
* Default OFF on first run.
```
