import { useEffect, useRef, useState } from "react";
import { ShadowsAI } from "../apps/ShadowsAI";
import { LogoMark } from "../theme/Logo";
import { ShadowsSettingsMenu } from "./ShadowsSettingsMenu";
import { VrmCharacter } from "./VrmCharacter";
import type { VRMExpressionPresetName } from "@pixiv/three-vrm";

// CompanionShell — full-character with chat overlay.
// VRM fills the window; chat bubbles + input float at the bottom with
// backdrop-blur so they stay readable over the character.

export function CompanionShell() {
  const [chatOpen, setChatOpen] = useState(true);
  // Refs that VrmCharacter reads each frame. Lipsync + expressions will
  // hook in here once TTS lands.
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

  function close() {
    const w = window as unknown as {
      dsos?: { hideCompanion?: () => void };
    };
    w.dsos?.hideCompanion?.();
  }

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-dsos-night"
      style={{
        background:
          "radial-gradient(circle at 50% 35%, rgba(255,138,42,0.25), transparent 55%), radial-gradient(circle at 50% 90%, rgba(194,38,29,0.30), transparent 60%), #0a0506",
      }}
    >
      {/* Character canvas — fills the whole window, behind everything */}
      <VrmCharacter
        mouthOpenRef={mouthOpenRef}
        expressionRef={expressionRef}
      />

      {/* Drag-handle strip at the top. Transparent but click-and-drag moves the window. */}
      <div
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <LogoMark size={18} glow />
          <span className="script text-dsos-glow text-glow text-sm">
            Shadows
          </span>
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <ShadowsSettingsMenu />
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="text-dsos-ghost hover:text-dsos-glow text-xs px-2 py-0.5 rounded border border-dsos-flame/30 bg-black/40 backdrop-blur"
            title="Toggle chat panel"
          >
            {chatOpen ? "▾" : "▴"}
          </button>
          <button
            onClick={close}
            className="text-dsos-ghost hover:text-dsos-flame text-xs px-2 py-0.5 rounded border border-dsos-flame/30 bg-black/40 backdrop-blur"
            title="Hide (Ctrl+Shift+O to summon again)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Chat overlay — pinned to the bottom. Open: 55% of window with full
          chat. Collapsed: ~80px tall, still enough for ShadowsAI's input form
          so the user can type without re-opening. Always visible. */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-200 ${
          chatOpen ? "h-[55%]" : "h-20"
        }`}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="h-full flex flex-col p-2">
          <div
            className="flex-1 flex flex-col min-h-0 rounded-lg border border-dsos-flame/55 overflow-hidden shadow-2xl"
            style={{
              background:
                "linear-gradient(180deg, rgba(18,7,9,0.88), rgba(10,5,6,0.96))",
              backdropFilter: "blur(12px) saturate(140%)",
              WebkitBackdropFilter: "blur(12px) saturate(140%)",
              boxShadow:
                "0 -10px 40px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,184,106,0.14)",
            }}
          >
            <ShadowsAI />
          </div>
        </div>
      </div>
    </div>
  );
}
