import type { CSSProperties } from "react";

interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  variant?: "dark" | "light";
  className?: string;
  style?: CSSProperties;
  glow?: boolean;
}

// viewBox 400×300, horizon at y=246. Cusps are actual circle-arc crescents.
// LEFT: top tip (130,60), bottom tip (130,270) hidden below horizon.
//   outer = SUN arc  (center 215.25, 165; r=135.25)
//   inner = MOON arc (center 676.25, 165; r=556.25)
const CUSP_L =
  "M 130 60 A 135.25 135.25 0 0 0 106.94 246 L 125.93 246 A 556.25 556.25 0 0 1 130 60 Z";
const CUSP_R =
  "M 270 60 A 135.25 135.25 0 0 1 293.06 246 L 274.07 246 A 556.25 556.25 0 0 0 270 60 Z";
const RIM_L = "M 130 60 A 135.25 135.25 0 0 0 106.94 246";
const RIM_R = "M 270 60 A 135.25 135.25 0 0 1 293.06 246";

export function Logo({
  size = 240,
  showWordmark = true,
  variant = "dark",
  className,
  style,
  glow = true,
}: LogoProps) {
  const isDark = variant === "dark";

  return (
    <div
      className={className}
      style={{ width: size, ...style }}
      aria-label="DSOS logo"
    >
      <svg
        viewBox="0 0 400 300"
        width="100%"
        style={{
          display: "block",
          filter:
            glow && isDark
              ? "drop-shadow(0 0 32px rgba(255,90,28,0.55))"
              : undefined,
        }}
      >
        <defs>
          <radialGradient id="lg-sky" cx="50%" cy="105%" r="95%">
            {isDark ? (
              <>
                <stop offset="0%" stopColor="#4a0608" stopOpacity="0.95" />
                <stop offset="35%" stopColor="#1a0608" />
                <stop offset="100%" stopColor="#040102" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#e7e1d6" />
                <stop offset="100%" stopColor="#c9c3b6" />
              </>
            )}
          </radialGradient>

          <linearGradient id="lg-cusp" x1="50%" y1="0%" x2="50%" y2="100%">
            {isDark ? (
              <>
                <stop offset="0%" stopColor="#fff7d8" />
                <stop offset="22%" stopColor="#fff0a8" />
                <stop offset="55%" stopColor="#ffba4a" />
                <stop offset="82%" stopColor="#ee5520" />
                <stop offset="100%" stopColor="#5a0608" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#0a0506" />
                <stop offset="100%" stopColor="#160a0c" />
              </>
            )}
          </linearGradient>
        </defs>

        {/* sky */}
        <rect width="400" height="300" fill="url(#lg-sky)" />

        {/* corona halos hugging the base of each cusp */}
        {isDark && (
          <>
            <ellipse cx="85" cy="240" rx="95" ry="115" fill="#ff3a1a" opacity="0.22" />
            <ellipse cx="315" cy="240" rx="95" ry="115" fill="#ff3a1a" opacity="0.22" />
            <ellipse cx="85" cy="240" rx="45" ry="70" fill="#ffb86a" opacity="0.2" />
            <ellipse cx="315" cy="240" rx="45" ry="70" fill="#ffb86a" opacity="0.2" />
            {/* warm horizon glow */}
            <ellipse cx="200" cy="252" rx="220" ry="22" fill="#ff5a1a" opacity="0.18" />
          </>
        )}

        {/* the two cusps */}
        <path d={CUSP_L} fill="url(#lg-cusp)" />
        <path d={CUSP_R} fill="url(#lg-cusp)" />

        {/* hot bright rim along the sun-limb (outer) edges */}
        {isDark && (
          <>
            <path d={RIM_L} fill="none" stroke="#fff7d8" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
            <path d={RIM_R} fill="none" stroke="#fff7d8" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
          </>
        )}

        {/* horizon ridge — drawn OVER the wide cusp bases so the cusps appear
            to emerge from the land */}
        <path
          d="M 0 250 C 30 248, 60 245, 90 248 C 130 252, 165 244, 200 247 C 235 250, 270 244, 310 248 C 340 250, 370 247, 400 249 L 400 300 L 0 300 Z"
          fill={isDark ? "#050203" : "#1a0d10"}
        />

        {/* silhouetted brush packed at the cusp bases — irregular fine branches */}
        <g fill={isDark ? "#050203" : "#1a0d10"}>
          {/* left cusp brush cluster */}
          <path d="M 35 250 l 2 -9 l 1 6 l 2 -12 l 2 8 l 2 -14 l 1 7 l 3 -10 l 1 8 l 2 -11 l 2 9 l 3 -7 z" />
          <path d="M 55 250 l 1 -7 l 2 5 l 1 -11 l 2 7 l 2 -9 l 1 6 l 2 -12 l 2 8 z" />
          <path d="M 70 250 l 1 -6 l 1 4 l 2 -9 l 1 5 l 2 -7 z" />
          <path d="M 95 250 l 1 -5 l 2 3 l 1 -8 l 2 5 z" />
          <path d="M 115 250 l 1 -7 l 1 4 l 2 -10 l 1 6 l 2 -8 z" />
          {/* right cusp brush cluster (mirror) */}
          <path d="M 365 250 l -2 -9 l -1 6 l -2 -12 l -2 8 l -2 -14 l -1 7 l -3 -10 l -1 8 l -2 -11 l -2 9 l -3 -7 z" />
          <path d="M 345 250 l -1 -7 l -2 5 l -1 -11 l -2 7 l -2 -9 l -1 6 l -2 -12 l -2 8 z" />
          <path d="M 330 250 l -1 -6 l -1 4 l -2 -9 l -1 5 l -2 -7 z" />
          <path d="M 305 250 l -1 -5 l -2 3 l -1 -8 l -2 5 z" />
          <path d="M 285 250 l -1 -7 l -1 4 l -2 -10 l -1 6 l -2 -8 z" />
          {/* sparse middle */}
          <path d="M 175 250 l 1 -3 l 1 2 l 1 -4 z" />
          <path d="M 220 250 l 1 -3 l 1 2 l 1 -4 z" />
        </g>

        {showWordmark && (
          <g>
            <text
              x="200"
              y="115"
              textAnchor="middle"
              fontFamily="'Dancing Script', cursive"
              fontWeight={700}
              fontSize="68"
              fill={isDark ? "#ff8a2a" : "#0a0506"}
              style={{ letterSpacing: "1px" }}
            >
              DSOS
            </text>
            <text
              x="200"
              y="148"
              textAnchor="middle"
              fontFamily="'Dancing Script', cursive"
              fontWeight={600}
              fontSize="20"
              fill={isDark ? "#f4ead4" : "#241013"}
              opacity={isDark ? 0.95 : 1}
            >
              devil&#39;s sunrise
            </text>
            <text x="252" y="78" fontSize="13" fill={isDark ? "#ff4a1f" : "#7a1218"}>★</text>
            <text x="148" y="142" fontSize="11" fill={isDark ? "#ff4a1f" : "#7a1218"}>★</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * Minimal mark — just the cusps in a square. Used in window chrome and the
 * taskbar at 24–32px. Same geometry as the full logo, fit into a square.
 */
export function LogoMark({
  size = 32,
  glow = false,
}: {
  size?: number;
  glow?: boolean;
}) {
  // Square viewBox: scale x by 100/400 = 0.25, y by 100/300 ≈ 0.333.
  // Cusps then occupy y ∈ [8, 93], x roughly [9, 91].
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{
        filter: glow
          ? "drop-shadow(0 0 6px rgba(255,90,28,0.7))"
          : undefined,
        display: "block",
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id="lgm-cusp" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#fff7d8" />
          <stop offset="35%" stopColor="#ffd078" />
          <stop offset="75%" stopColor="#ff6420" />
          <stop offset="100%" stopColor="#5a0608" />
        </linearGradient>
      </defs>
      <path
        d="M 32 18 A 46.6 46.6 0 0 0 32 90 A 217.5 217.5 0 0 1 32 18 Z"
        fill="url(#lgm-cusp)"
      />
      <path
        d="M 68 18 A 46.6 46.6 0 0 1 68 90 A 217.5 217.5 0 0 0 68 18 Z"
        fill="url(#lgm-cusp)"
      />
    </svg>
  );
}
