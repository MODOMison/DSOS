import { useEffect, useState } from "react";

interface BootScreenProps {
  onComplete: () => void;
}

const bootLines = [
  "[ ok ] mounting /dev/hellfire ...",
  "[ ok ] loading kernel: dsos-core v0.3.0 (sunrise) ...",
  "[ ok ] initializing recon modules: dns, headers, ssl, ct-logs ...",
  "[ ok ] starting cve oracle (nvd feed) ...",
  "[ ok ] forging payload armory ...",
  "[ ok ] summoning soulreader ...",
  "[ ok ] linking brimstone hash engine ...",
  "[ warn ] oracle ai panel: waiting for api key ...",
  "[ ok ] desktop shell ready.",
  "",
  "welcome to DSOS — devil's sunrise operating system.",
];

export function BootScreen({ onComplete }: BootScreenProps) {
  const [phase, setPhase] = useState<"rise" | "lines" | "fade">("rise");
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase("lines"), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== "lines") return;
    if (shown >= bootLines.length) {
      const t = setTimeout(() => setPhase("fade"), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((s) => s + 1), 180);
    return () => clearTimeout(t);
  }, [phase, shown]);

  useEffect(() => {
    if (phase !== "fade") return;
    const t = setTimeout(onComplete, 900);
    return () => clearTimeout(t);
  }, [phase, onComplete]);

  return (
    <div
      onClick={onComplete}
      className={`fixed inset-0 z-50 cursor-pointer bg-black transition-opacity duration-700 ${
        phase === "fade" ? "opacity-0" : "opacity-100"
      }`}
      role="presentation"
    >
      {/* photograph — fades in on first render */}
      <img
        src="/eclipse.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000"
        style={{
          objectPosition: "center 60%",
          opacity: phase === "rise" ? 0.6 : 1,
        }}
      />

      {/* wordmark — sits in the dark gap between the cusps */}
      <div
        className="absolute inset-x-0 top-[14%] flex flex-col items-center pointer-events-none"
        style={{
          opacity: phase === "rise" ? 0 : 1,
          transform: phase === "rise" ? "translateY(20px)" : "translateY(0)",
          transition: "opacity 900ms ease-out, transform 900ms ease-out",
          transitionDelay: "500ms",
        }}
      >
        <h1
          className="font-script font-bold leading-none tracking-tight"
          style={{
            fontSize: "clamp(72px, 11vw, 168px)",
            color: "#ff8a2a",
            textShadow:
              "0 0 24px rgba(255,90,20,0.7), 0 0 60px rgba(194,38,29,0.55)",
          }}
        >
          DSOS
        </h1>
        <p
          className="font-script mt-1"
          style={{
            fontSize: "clamp(20px, 2.4vw, 36px)",
            color: "#f4ead4",
            opacity: 0.92,
            letterSpacing: "0.04em",
            textShadow: "0 0 18px rgba(0,0,0,0.8)",
          }}
        >
          devil&#39;s sunrise
        </p>
      </div>

      {/* boot log */}
      <div
        className="absolute inset-x-0 bottom-24 flex justify-center pointer-events-none"
        style={{
          opacity: phase === "lines" || phase === "fade" ? 1 : 0,
          transition: "opacity 400ms ease-out",
        }}
      >
        <div
          className="font-mono text-[12px] leading-relaxed w-[640px] max-w-[90vw] min-h-[200px] px-4 py-3 rounded"
          style={{
            color: "#ffb86a",
            background: "rgba(8,3,5,0.55)",
            border: "1px solid rgba(255,138,42,0.22)",
            backdropFilter: "blur(2px)",
          }}
        >
          {bootLines.slice(0, shown).map((line, i) => (
            <div
              key={i}
              style={{
                color: line.startsWith("[ warn")
                  ? "#ff4a1f"
                  : line.startsWith("welcome")
                  ? "#f4ead4"
                  : "#ffb86a",
              }}
            >
              {line || " "}
            </div>
          ))}
          {phase === "lines" && shown < bootLines.length && (
            <span className="inline-block w-2 h-3 bg-dsos-flame animate-pulse" />
          )}
        </div>
      </div>

      <div className="absolute bottom-6 inset-x-0 text-center text-[11px] text-dsos-ghost/70 font-mono">
        click anywhere to skip
      </div>
    </div>
  );
}
