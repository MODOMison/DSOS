import { useEffect, useMemo, useState } from "react";
import {
  ANIMATIONS,
  type AnimationName,
  DANCE_VARIANTS,
  RARE_DANCE_VARIANTS,
  IDLE_VARIANTS,
  LIFE_VARIANTS,
  HAPPY_VARIANTS,
  SAD_VARIANTS,
  THINKING_VARIANTS,
  GREETING_VARIANTS,
  ENERGETIC_VARIANTS,
  WALK_VARIANTS,
} from "../lib/bvhLoader";
import { useCharacter } from "../store/characterStore";

// Reverse-lookup: which pools does each clip belong to? Used to label clips
// in the list view so the user knows which rotations a ban would affect.
const POOL_INDEX = new Map<AnimationName, string[]>();
function indexPool(name: string, pool: readonly AnimationName[]) {
  for (const n of pool) {
    if (!POOL_INDEX.has(n)) POOL_INDEX.set(n, []);
    POOL_INDEX.get(n)!.push(name);
  }
}
indexPool("dance", DANCE_VARIANTS);
indexPool("rare", RARE_DANCE_VARIANTS);
indexPool("idle", IDLE_VARIANTS);
indexPool("life", LIFE_VARIANTS);
indexPool("happy", HAPPY_VARIANTS);
indexPool("sad", SAD_VARIANTS);
indexPool("thinking", THINKING_VARIANTS);
indexPool("greeting", GREETING_VARIANTS);
indexPool("energetic", ENERGETIC_VARIANTS);
indexPool("walk", WALK_VARIANTS);

type Filter =
  | "all"
  | "dance"
  | "idle"
  | "life"
  | "happy"
  | "sad"
  | "thinking"
  | "greeting"
  | "energetic"
  | "walk"
  | "unpooled"
  | "banned";

export function Animator() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AnimationName | null>(null);

  const allNames = useMemo(() => Object.keys(ANIMATIONS) as AnimationName[], []);
  const banned = useCharacter((s) => s.banned);
  const banClip = useCharacter((s) => s.banClip);
  const unbanClip = useCharacter((s) => s.unbanClip);
  const playClip = useCharacter((s) => s.playClip);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allNames.filter((name) => {
      if (q && !name.toLowerCase().includes(q)) return false;
      if (filter === "all") return true;
      if (filter === "banned") return banned.has(name);
      if (filter === "unpooled") return !POOL_INDEX.has(name);
      return POOL_INDEX.get(name)?.includes(filter) ?? false;
    });
  }, [allNames, filter, search, banned]);

  // Loop clips while previewing. Mixamo walks and many idle clips are
  // 1-2 second stride loops designed for continuous playback — playing
  // them "once" cuts off after a single stride and looks broken. Looping
  // by default lets every clip stretch to fill the review interval.
  const [autoStep, setAutoStep] = useState(false);
  const PREVIEW_DURATION_MS = 6000;

  // Timer-based auto-advance — fires every 6s regardless of clip length,
  // so short loopers and long dances all get the same review window.
  useEffect(() => {
    if (!autoStep || !selected) return;
    const t = setTimeout(() => {
      const idx = filtered.indexOf(selected);
      if (idx === -1 || idx >= filtered.length - 1) {
        setAutoStep(false);
        return;
      }
      const next = filtered[idx + 1];
      setSelected(next);
      playClip(next, "loop");
    }, PREVIEW_DURATION_MS);
    return () => clearTimeout(t);
  }, [autoStep, selected, filtered, playClip]);

  const play = (name: AnimationName) => {
    setSelected(name);
    playClip(name, "loop");
  };
  const prev = () => {
    if (!selected) return;
    const idx = filtered.indexOf(selected);
    if (idx > 0) play(filtered[idx - 1]);
  };
  const next = () => {
    if (!selected) return;
    const idx = filtered.indexOf(selected);
    if (idx >= 0 && idx < filtered.length - 1) play(filtered[idx + 1]);
  };
  const toggleBan = (name: AnimationName) => {
    if (banned.has(name)) unbanClip(name);
    else banClip(name);
  };

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: allNames.length },
    { id: "dance", label: "Dance", count: DANCE_VARIANTS.length + RARE_DANCE_VARIANTS.length },
    { id: "idle", label: "Idle", count: IDLE_VARIANTS.length },
    { id: "life", label: "Life", count: LIFE_VARIANTS.length },
    { id: "happy", label: "Happy", count: HAPPY_VARIANTS.length },
    { id: "sad", label: "Sad", count: SAD_VARIANTS.length },
    { id: "thinking", label: "Thinking", count: THINKING_VARIANTS.length },
    { id: "greeting", label: "Greeting", count: GREETING_VARIANTS.length },
    { id: "energetic", label: "Energetic", count: ENERGETIC_VARIANTS.length },
    { id: "walk", label: "Walk", count: WALK_VARIANTS.length },
    { id: "unpooled", label: "Unpooled", count: allNames.filter((n) => !POOL_INDEX.has(n)).length },
    { id: "banned", label: "Banned", count: banned.size },
  ];

  return (
    <div className="flex flex-col h-full text-dsos-bone">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dsos-ghost/20">
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">
          DSOS // ANIMATOR
        </div>
        <div className="text-xs text-dsos-bone/70 mt-0.5">
          {allNames.length} clips · {banned.size} banned · {allNames.length - banned.size} active.
          Click a clip to preview on the desktop pet. Thumbs-down bans it from auto-rotations.
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-dsos-ghost/20 flex flex-wrap gap-1">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-[10px] mono px-2 py-0.5 rounded border ${
              filter === f.id
                ? "border-dsos-flame bg-dsos-flame/20 text-dsos-flame"
                : "border-dsos-ghost/30 text-dsos-ghost hover:text-dsos-bone hover:border-dsos-bone/50"
            }`}
          >
            {f.label} <span className="text-dsos-ghost/60">({f.count})</span>
          </button>
        ))}
      </div>

      {/* Search + transport */}
      <div className="px-3 py-2 border-b border-dsos-ghost/20 flex gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="flex-1 px-2 py-1 bg-dsos-night border border-dsos-ghost/30 focus:border-dsos-flame outline-none text-dsos-bone text-xs mono rounded"
        />
        <button
          onClick={prev}
          disabled={!selected || filtered.indexOf(selected) <= 0}
          className="text-xs mono px-2 py-1 rounded border border-dsos-ghost/40 hover:border-dsos-flame disabled:opacity-30"
          title="Previous"
        >
          ⏮
        </button>
        <button
          onClick={next}
          disabled={!selected || filtered.indexOf(selected) >= filtered.length - 1}
          className="text-xs mono px-2 py-1 rounded border border-dsos-ghost/40 hover:border-dsos-flame disabled:opacity-30"
          title="Next"
        >
          ⏭
        </button>
        <button
          onClick={() => {
            const newAutoStep = !autoStep;
            setAutoStep(newAutoStep);
            if (newAutoStep && filtered.length > 0) {
              const start = selected ?? filtered[0];
              play(start);
            }
          }}
          className={`text-xs mono px-2 py-1 rounded border ${
            autoStep
              ? "border-dsos-flame bg-dsos-flame/20 text-dsos-flame"
              : "border-dsos-ghost/40 text-dsos-bone hover:border-dsos-flame"
          }`}
          title={autoStep ? "Stop auto-advance" : "Auto-advance through the list"}
        >
          {autoStep ? "■" : "▶▶"}
        </button>
      </div>

      {/* Now playing */}
      {selected && (
        <div className="px-3 py-2 border-b border-dsos-ghost/20 bg-dsos-flame/5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] mono text-dsos-flame">NOW PREVIEWING</div>
              <div className="text-xs mono text-dsos-bone truncate">{selected}</div>
              <div className="text-[10px] text-dsos-ghost/60 mt-0.5">
                pools: {POOL_INDEX.get(selected)?.join(", ") ?? "(none — not used in rotations)"}
              </div>
            </div>
            <button
              onClick={() => toggleBan(selected)}
              className={`text-[10px] mono px-3 py-1.5 rounded border ${
                banned.has(selected)
                  ? "border-dsos-flame bg-dsos-flame/30 text-dsos-flame"
                  : "border-dsos-ghost/40 text-dsos-ghost hover:text-red-400 hover:border-red-400"
              }`}
              title={banned.has(selected) ? "Unban — restore to rotations" : "Ban — remove from rotations"}
            >
              {banned.has(selected) ? "✓ BANNED · click to restore" : "👎 BAN"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-dsos-ghost/60 text-xs">
            no clips match
          </div>
        ) : (
          filtered.map((name) => {
            const isSelected = name === selected;
            const isBanned = banned.has(name);
            const pools = POOL_INDEX.get(name) ?? [];
            return (
              <button
                key={name}
                onClick={() => play(name)}
                className={`w-full text-left px-3 py-1.5 border-b border-dsos-ghost/10 text-xs mono flex items-center gap-2 ${
                  isSelected
                    ? "bg-dsos-flame/15 text-dsos-flame"
                    : isBanned
                      ? "text-dsos-ghost/40 hover:bg-dsos-night/50"
                      : "text-dsos-bone hover:bg-dsos-flame/5"
                }`}
              >
                <span className="flex-1 truncate">
                  {isBanned && <span className="text-red-400 mr-1">×</span>}
                  {name}
                </span>
                <span className="text-[9px] text-dsos-ghost/60">
                  {pools.join(",") || "—"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
