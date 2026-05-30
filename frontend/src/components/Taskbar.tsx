import { useEffect, useState } from "react";
import {
  APP_TITLES,
  useWindowStore,
  type AppId,
} from "../store/windowStore";

const appsInLauncher: AppId[] = [
  "recon",
  "cve",
  "brimstone",
  "soulreader",
  "armory",
  "terminal",
  "shadows",
  "about",
];

const appGlyphs: Record<AppId, string> = {
  recon: "🜨",
  cve: "☠",
  brimstone: "♨",
  soulreader: "✉",
  armory: "⚔",
  terminal: "▢",
  shadows: "✦",
  about: "ⓘ",
  account: "⚲",
  pricing: "$",
  cipher: "⛧",
  seal: "⛓",
  sigil: "⌬",
  animator: "🎭",
};

export function Taskbar() {
  const { windows, restoreOrFocus, focus } = useWindowStore();
  const [now, setNow] = useState(new Date());
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = now.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  return (
    <>
      {/* app launcher panel */}
      {launcherOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setLauncherOpen(false)}
        >
          <div
            className="absolute bottom-16 left-3 glass rounded-lg p-3 w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="script text-xl text-dsos-glow mb-2">
              Devil&#39;s Sunrise
            </div>
            <div className="text-[11px] text-dsos-ghost mb-3 uppercase tracking-wider">
              applications
            </div>
            <div className="grid grid-cols-4 gap-2">
              {appsInLauncher.map((appId) => (
                <button
                  key={appId}
                  onClick={() => {
                    restoreOrFocus(appId);
                    setLauncherOpen(false);
                  }}
                  className="flex flex-col items-center gap-1 p-2 rounded-md hover:bg-dsos-flame/15 transition-colors"
                  title={APP_TITLES[appId]}
                >
                  <span className="text-2xl text-dsos-flame">
                    {appGlyphs[appId]}
                  </span>
                  <span className="text-[10px] text-dsos-ghost text-center leading-tight">
                    {APP_TITLES[appId]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        className="fixed bottom-0 left-0 right-0 h-14 flex items-center gap-2 px-3 z-40"
        style={{
          background:
            "linear-gradient(180deg, rgba(18,7,9,0.85), rgba(5,2,3,0.95))",
          borderTop: "1px solid rgba(255,138,42,0.3)",
          backdropFilter: "blur(8px)",
        }}
      >
        <button
          onClick={() => setLauncherOpen((v) => !v)}
          className="flex items-center gap-2 px-4 h-10 rounded-md hover:bg-dsos-flame/20 transition-colors"
          title="apps"
        >
          <span className="script text-dsos-glow text-xl leading-none">DSOS</span>
        </button>

        <div className="w-px h-7 bg-dsos-flame/30 mx-1" />

        <div className="flex items-center gap-1 flex-1 overflow-x-auto dsos-scrollbar">
          {windows.map((w) => (
            <button
              key={w.id}
              onClick={() => focus(w.id)}
              className={`px-3 h-10 rounded-md text-xs whitespace-nowrap transition-all flex items-center gap-2 ${
                w.minimized
                  ? "bg-black/30 text-dsos-ghost"
                  : "bg-dsos-flame/15 text-dsos-bone"
              } hover:bg-dsos-flame/25`}
              title={w.title}
            >
              <span className="text-dsos-flame">{appGlyphs[w.appId]}</span>
              <span className="script text-base">{w.title}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col items-end text-[11px] leading-tight pr-2 text-dsos-ghost">
          <span className="text-dsos-bone">{timeStr}</span>
          <span>{dateStr}</span>
        </div>
      </div>
    </>
  );
}
