import { DesktopBackground } from "../theme/DesktopBackground";
import { Window } from "./Window";
import { Taskbar } from "./Taskbar";
import { VrmCharacter } from "./VrmCharacter";
import { useWindowStore, type AppId } from "../store/windowStore";
import { useState } from "react";
import type { ReactNode } from "react";

import { About } from "../apps/About";
import { InfernoRecon } from "../apps/InfernoRecon";
import { CVEOracle } from "../apps/CVEOracle";
import { Brimstone } from "../apps/Brimstone";
import { Soulreader } from "../apps/Soulreader";
import { Armory } from "../apps/Armory";
import { HellfireTerminal } from "../apps/HellfireTerminal";
import { ShadowsAI } from "../apps/ShadowsAI";
import { Pricing } from "../apps/Pricing";
import { Account } from "../apps/Account";
import { CipherCellar } from "../apps/CipherCellar";
import { SealBreaker } from "../apps/SealBreaker";
import { SigilReader } from "../apps/SigilReader";
import { Animator } from "../apps/Animator";

const renderers: Record<AppId, () => ReactNode> = {
  about: () => <About />,
  recon: () => <InfernoRecon />,
  cve: () => <CVEOracle />,
  brimstone: () => <Brimstone />,
  soulreader: () => <Soulreader />,
  armory: () => <Armory />,
  terminal: () => <HellfireTerminal />,
  shadows: () => <ShadowsAI />,
  pricing: () => <Pricing />,
  account: () => <Account />,
  cipher: () => <CipherCellar />,
  seal: () => <SealBreaker />,
  sigil: () => <SigilReader />,
  animator: () => <Animator />,
};

export function Desktop() {
  const { windows, restoreOrFocus } = useWindowStore();
  const [petHidden, setPetHidden] = useState(false);

  const desktopIcons: { appId: AppId; glyph: string; label: string }[] = [
    { appId: "recon", glyph: "🜨", label: "Inferno Recon" },
    { appId: "cve", glyph: "☠", label: "CVE Oracle" },
    { appId: "brimstone", glyph: "♨", label: "Brimstone" },
    { appId: "soulreader", glyph: "✉", label: "Soulreader" },
    { appId: "armory", glyph: "⚔", label: "Armory" },
    { appId: "terminal", glyph: "▢", label: "Hellfire" },
    { appId: "shadows", glyph: "✦", label: "Shadows" },
    { appId: "cipher", glyph: "⛧", label: "Cipher Cellar" },
    { appId: "seal", glyph: "⛓", label: "Seal Breaker" },
    { appId: "sigil", glyph: "⌬", label: "Sigil Reader" },
    { appId: "animator", glyph: "🎭", label: "Animator" },
    { appId: "account", glyph: "⚲", label: "Account" },
    { appId: "pricing", glyph: "$", label: "Pricing" },
    { appId: "about", glyph: "ⓘ", label: "About DSOS" },
  ];

  return (
    <div className="fixed inset-0 overflow-hidden">
      <DesktopBackground />

      {/* desktop shortcut grid — flows top-to-bottom, wraps into a new
          column when it hits the bottom (real-desktop behavior). */}
      <div
        className="absolute top-4 left-4 bottom-16 flex flex-col flex-wrap content-start gap-3 z-10"
      >
        {desktopIcons.map(({ appId, glyph, label }) => (
          <button
            key={appId}
            onDoubleClick={() => restoreOrFocus(appId)}
            onClick={(e) => {
              if (e.detail === 1) {
                // single click — visual focus only; double click opens
              }
            }}
            className="group flex flex-col items-center gap-1 w-20 p-2 rounded-md hover:bg-dsos-flame/10 active:bg-dsos-flame/20 transition-colors"
            title={`double-click to open ${label}`}
          >
            <span
              className="text-3xl text-dsos-flame group-hover:text-dsos-sun"
              style={{
                textShadow:
                  "0 0 12px rgba(255,138,42,0.55), 0 0 28px rgba(194,38,29,0.4)",
              }}
            >
              {glyph}
            </span>
            <span className="text-[10px] text-dsos-bone leading-tight text-center">
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* windows */}
      {windows.map((w) => (
        <Window key={w.id} win={w}>
          {renderers[w.appId]()}
        </Window>
      ))}

      {/* Shadows desktop pet — VRM avatar pinned to the bottom-right.
          Clicking her body opens the Shadows chat window. The two control
          buttons in the top-right corner of the pet handle expand/banish
          without triggering the chat click. */}
      {!petHidden && (
        <div
          className="absolute right-4 bottom-20 z-0"
          style={{ width: 320, height: 440 }}
        >
          {/* VRM canvas — full-area, behind everything. pointer-events:none
              so the Three.js Canvas doesn't eat the chat clicks. */}
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
            <VrmCharacter />
          </div>
          {/* Click-to-summon-chat — full overlay ON TOP of the VRM so nothing
              underneath can absorb the click. cursor-pointer + group hover
              makes the chat hint glow. */}
          <button
            onClick={() => restoreOrFocus("shadows")}
            className="group absolute inset-0 cursor-pointer bg-transparent border-0 outline-none"
            style={{ zIndex: 2 }}
            title="Click to chat with Shadows"
            aria-label="Open Shadows chat"
          >
            <span
              className="absolute -top-1 left-2 text-[10px] mono px-2 py-1 rounded-full bg-dsos-flame/30 border border-dsos-flame/60 text-dsos-flame backdrop-blur group-hover:bg-dsos-flame/50 group-hover:text-white transition-colors"
              style={{ zIndex: 4 }}
            >
              click to chat ✦
            </span>
          </button>
          {/* Controls — sit ABOVE the chat-open button so they capture their
              own clicks instead of falling through to the chat handler. */}
          <div
            className="absolute top-1 right-1 flex gap-1"
            style={{ zIndex: 5 }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open("?mode=companion", "_blank");
              }}
              className="text-[10px] mono px-2 py-0.5 rounded border border-dsos-flame/40 bg-black/60 text-dsos-bone hover:text-dsos-flame backdrop-blur"
              title="Open Shadows in floating companion window"
            >
              ⤢
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPetHidden(true);
              }}
              className="text-[10px] mono px-2 py-0.5 rounded border border-dsos-ghost/40 bg-black/60 text-dsos-ghost hover:text-dsos-flame backdrop-blur"
              title="Banish Shadows"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {petHidden && (
        <button
          onClick={() => setPetHidden(false)}
          className="absolute right-4 bottom-20 z-0 text-[10px] mono px-3 py-1 rounded border border-dsos-flame/40 bg-black/60 text-dsos-bone hover:text-dsos-flame backdrop-blur"
          title="Summon Shadows"
        >
          ✦ summon shadows
        </button>
      )}

      <Taskbar />

      {/* watermark */}
      <div className="absolute bottom-16 right-4 mono text-[10px] text-dsos-ghost/40 z-0 select-none pointer-events-none">
        DSOS v0.3.0 — sunrise
      </div>
    </div>
  );
}
