import { useEffect, useRef, useState } from "react";
import { ShadowsAI } from "../apps/ShadowsAI";
import { ShadowsSettingsMenu } from "./ShadowsSettingsMenu";
import { VrmCharacter } from "./VrmCharacter";
import type { VRMExpressionPresetName } from "@pixiv/three-vrm";
import { useCharacter, type Reaction } from "../store/characterStore";
import { useTtsSettings } from "../store/ttsStore";
import { isSpeechSupported, isTtsSpeaking, speakWarm } from "../lib/tts";
import {
  nudgeCompanionScale,
  onPanelRect,
  setRidePanels,
  isRidingPanels,
  type PanelRect,
} from "../lib/companionControl";

// CompanionShell — the Shadow as an edgeless desktop pet.
//
// Edgeless: the Electron window is frameless + transparent, so this component
// paints NO background box. Only the character, floating bubbles, and a
// translucent floating chat card render — everything else is see-through,
// letting the Shadow sit over your real desktop. Chrome (title + buttons)
// hides until you hover. Grab his body to drag/throw, scroll to resize.

export function CompanionShell() {
  const [chatOpen, setChatOpen] = useState(false);
  const [riding, setRiding] = useState(false); // perch-on-active-panel: opt-in
  // Refs that VrmCharacter reads each frame for TTS lipsync + expressions.
  const mouthOpenRef = useRef(0);
  const expressionRef = useRef<VRMExpressionPresetName | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("companion-mode");
    document.body.classList.add("companion-mode");
    return () => {
      document.documentElement.classList.remove("companion-mode");
      document.body.classList.remove("companion-mode");
    };
  }, []);

  // App-awareness: when the main desktop opens an app, the Shadow comments.
  // The preload bridge relays a `dsos:app-event` from the desktop renderer.
  useEffect(() => {
    const w = window as unknown as {
      dsos?: { onAppEvent?: (cb: (d: unknown) => void) => () => void };
    };
    const off = w.dsos?.onAppEvent?.((data) => {
      const d = data as { type?: string; appId?: string } | null;
      // While riding panels, onRidePanel already comments on the focused app —
      // skip the duplicate here so he doesn't talk over himself.
      if (d?.type === "app-open" && d.appId && !isRidingPanels()) {
        useCharacter.getState().appReaction(String(d.appId));
      }
    });
    return () => off?.();
  }, []);

  // Panel riding: receive the focused panel's screen rect and perch on it.
  useEffect(() => {
    const w = window as unknown as {
      dsos?: { onPanel?: (cb: (d: PanelRect | null) => void) => () => void };
    };
    const off = w.dsos?.onPanel?.((rect) => onPanelRect(rect));
    return () => off?.();
  }, []);

  function close() {
    const w = window as unknown as { dsos?: { hideCompanion?: () => void } };
    w.dsos?.hideCompanion?.();
  }

  return (
    <div
      className="group relative h-screen w-screen overflow-hidden bg-transparent select-none"
      // Scroll anywhere over the Shadow to scale him up/down.
      onWheel={(e) => nudgeCompanionScale(e.deltaY)}
    >
      {/* Character canvas — transparent, fills the window, sits over your desktop. */}
      <VrmCharacter mouthOpenRef={mouthOpenRef} expressionRef={expressionRef} />

      {/* Poke reaction bubble — floats above the head, speaks the quip. */}
      <ReactionBubble />

      {/* Hover-reveal control cluster, top-right only. No logo, no label, no
          bar — the resting state is pure character; the controls fade in on
          hover. The whole strip is an OS drag handle (move via empty space). */}
      <div
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-end px-2 py-2
                   opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <ShadowsSettingsMenu />
          <button
            onClick={() => {
              const next = !riding;
              setRiding(next);
              setRidePanels(next);
            }}
            className={`text-xs h-6 w-6 grid place-items-center rounded-full border backdrop-blur transition-colors ${
              riding
                ? "text-dsos-glow border-dsos-flame/60 bg-dsos-flame/25"
                : "text-dsos-ghost border-dsos-flame/30 bg-black/45 hover:text-dsos-glow"
            }`}
            title={
              riding
                ? "Riding panels — click to free-float"
                : "Free-floating — click to ride the active panel"
            }
          >
            📌
          </button>
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="text-dsos-ghost hover:text-dsos-glow text-xs h-6 w-6 grid place-items-center rounded-full
                       border border-dsos-flame/30 bg-black/45 backdrop-blur transition-colors"
            title="Toggle chat"
          >
            {chatOpen ? "▾" : "▴"}
          </button>
          <button
            onClick={close}
            className="text-dsos-ghost hover:text-dsos-flame text-xs h-6 w-6 grid place-items-center rounded-full
                       border border-dsos-flame/30 bg-black/45 backdrop-blur transition-colors"
            title="Hide (Ctrl+Shift+O to summon again)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Floating chat card — only when opened. Sits inset from the edges with
          rounded corners + soft glow so it reads as a panel floating over the
          desktop, not a window pinned to a frame. */}
      {chatOpen && (
        <div
          className="absolute bottom-3 left-3 right-3 z-20 h-[52%]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div
            className="h-full flex flex-col min-h-0 rounded-2xl border border-dsos-flame/45 overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg, rgba(18,7,9,0.82), rgba(10,5,6,0.92))",
              backdropFilter: "blur(14px) saturate(150%)",
              WebkitBackdropFilter: "blur(14px) saturate(150%)",
              boxShadow:
                "0 12px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,138,42,0.10), inset 0 1px 0 rgba(255,184,106,0.14)",
            }}
          >
            <ShadowsAI />
          </div>
        </div>
      )}
    </div>
  );
}

// Floating speech bubble for poke / interaction reactions. Pops above the
// character's head, speaks the quip via TTS (never over an in-flight AI
// reply), and fades out after a few seconds.
function ReactionBubble() {
  const reaction = useCharacter((s) => s.reaction);
  const ttsSettings = useTtsSettings((s) => s.settings);
  const [shown, setShown] = useState<Reaction | null>(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    if (!reaction || reaction.id === lastIdRef.current) return;
    lastIdRef.current = reaction.id;
    setShown(reaction);
    if (ttsSettings.enabled && isSpeechSupported() && !isTtsSpeaking()) {
      speakWarm(reaction.text, ttsSettings);
    }
    const t = setTimeout(
      () => setShown((cur) => (cur?.id === reaction.id ? null : cur)),
      3200
    );
    return () => clearTimeout(t);
  }, [reaction, ttsSettings]);

  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[12%] z-40 -translate-x-1/2 flex flex-col items-center">
      <div
        key={shown.id}
        className="reaction-pop text-2xl mb-1 text-dsos-glow text-glow"
      >
        {shown.emote}
      </div>
      <div
        className="reaction-pop max-w-[16rem] rounded-2xl border border-dsos-flame/55 px-3 py-1.5 text-center text-[13px] text-dsos-bone shadow-2xl"
        style={{
          background:
            "linear-gradient(180deg, rgba(24,9,11,0.92), rgba(12,6,7,0.96))",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        {shown.text}
      </div>
    </div>
  );
}
