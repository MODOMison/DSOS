import { useMemo, useState } from "react";

type Codec =
  | "auto"
  | "base64"
  | "base64url"
  | "hex"
  | "url"
  | "rot13"
  | "binary"
  | "morse"
  | "utf8-to-utf16"
  | "html-entities"
  | "jwt-decode";

const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};
const MORSE_REV: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k])
);

function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function tryBase64(s: string, urlSafe = false): string | null {
  try {
    let t = s.replace(/\s+/g, "");
    if (urlSafe) t = t.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    const bytes = Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function tryHex(s: string): string | null {
  const t = s.replace(/[\s:0x]/gi, "");
  if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2) return null;
  try {
    const bytes = new Uint8Array(t.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(t.substr(i * 2, 2), 16);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function tryBinary(s: string): string | null {
  const groups = s.trim().split(/\s+/);
  if (!groups.every((g) => /^[01]{8}$/.test(g))) return null;
  return groups.map((g) => String.fromCharCode(parseInt(g, 2))).join("");
}

function tryMorse(s: string): string | null {
  const words = s.trim().split(/\s*\/\s*|\s{2,}/);
  const decoded = words
    .map((w) =>
      w
        .split(/\s+/)
        .map((ch) => MORSE_REV[ch] ?? "?")
        .join("")
    )
    .join(" ");
  return /[A-Z0-9? ]/.test(decoded) ? decoded : null;
}

function decodeJwt(s: string): string | null {
  const parts = s.split(".");
  if (parts.length !== 3) return null;
  const hdr = tryBase64(parts[0], true);
  const pay = tryBase64(parts[1], true);
  if (!hdr || !pay) return null;
  try {
    return JSON.stringify(
      { header: JSON.parse(hdr), payload: JSON.parse(pay), signature: parts[2] },
      null,
      2
    );
  } catch {
    return null;
  }
}

function encode(codec: Codec, s: string): string {
  switch (codec) {
    case "base64":
      return btoa(unescape(encodeURIComponent(s)));
    case "base64url":
      return btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    case "hex":
      return Array.from(new TextEncoder().encode(s))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    case "url":
      return encodeURIComponent(s);
    case "rot13":
      return rot13(s);
    case "binary":
      return Array.from(new TextEncoder().encode(s))
        .map((b) => b.toString(2).padStart(8, "0"))
        .join(" ");
    case "morse":
      return s
        .toUpperCase()
        .split("")
        .map((c) => (c === " " ? "/" : MORSE[c] ?? "?"))
        .join(" ");
    case "html-entities":
      return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
    case "utf8-to-utf16": {
      const bytes = new TextEncoder().encode(s);
      let out = "";
      for (let i = 0; i < bytes.length; i++) out += `\\x${bytes[i].toString(16).padStart(2, "0")}`;
      return out;
    }
    default:
      return s;
  }
}

function decode(codec: Codec, s: string): string | null {
  if (codec === "auto") {
    // Try in order of specificity. First non-null wins.
    return (
      decodeJwt(s) ??
      tryBase64(s) ??
      tryBase64(s, true) ??
      tryHex(s) ??
      tryBinary(s) ??
      tryMorse(s) ??
      (s.startsWith("%") ? safeDecodeURI(s) : null) ??
      rot13(s)
    );
  }
  switch (codec) {
    case "base64":
      return tryBase64(s);
    case "base64url":
      return tryBase64(s, true);
    case "hex":
      return tryHex(s);
    case "url":
      return safeDecodeURI(s);
    case "rot13":
      return rot13(s);
    case "binary":
      return tryBinary(s);
    case "morse":
      return tryMorse(s);
    case "html-entities":
      return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
    case "jwt-decode":
      return decodeJwt(s);
    default:
      return null;
  }
}

function safeDecodeURI(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

const CODECS: { id: Codec; label: string }[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "base64", label: "Base64" },
  { id: "base64url", label: "Base64-URL" },
  { id: "hex", label: "Hex" },
  { id: "url", label: "URL %" },
  { id: "rot13", label: "ROT13" },
  { id: "binary", label: "Binary" },
  { id: "morse", label: "Morse" },
  { id: "html-entities", label: "HTML entities" },
  { id: "jwt-decode", label: "JWT (decode only)" },
];

export function CipherCellar() {
  const [codec, setCodec] = useState<Codec>("auto");
  const [direction, setDirection] = useState<"decode" | "encode">("decode");
  const [input, setInput] = useState("");

  const output = useMemo(() => {
    if (!input) return "";
    if (direction === "decode") {
      const r = decode(codec, input);
      return r ?? "(no decoding matched — try another codec)";
    }
    if (codec === "auto" || codec === "jwt-decode") {
      return "(pick a specific codec to encode)";
    }
    return encode(codec, input);
  }, [input, codec, direction]);

  const swap = () => {
    if (!output || output.startsWith("(")) return;
    setInput(output);
  };

  return (
    <div className="p-4 text-dsos-bone space-y-3 h-full flex flex-col">
      <div>
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">
          DSOS // CIPHER CELLAR
        </div>
        <div className="text-xs text-dsos-bone/60 mt-0.5">
          Encode/decode base64, hex, url, rot13, morse, binary, JWT.
          Auto-detect tries every common format.
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <div className="flex border border-dsos-ghost/30 rounded overflow-hidden text-[10px] mono">
          <button
            onClick={() => setDirection("decode")}
            className={`px-3 py-1 ${direction === "decode" ? "bg-dsos-flame/20 text-dsos-flame" : "text-dsos-ghost"}`}
          >
            DECODE
          </button>
          <button
            onClick={() => setDirection("encode")}
            className={`px-3 py-1 ${direction === "encode" ? "bg-dsos-flame/20 text-dsos-flame" : "text-dsos-ghost"}`}
          >
            ENCODE
          </button>
        </div>

        <select
          value={codec}
          onChange={(e) => setCodec(e.target.value as Codec)}
          className="flex-1 px-2 py-1 bg-dsos-night border border-dsos-ghost/30 text-dsos-bone text-xs mono rounded"
        >
          {CODECS.map((c) => (
            <option key={c.id} value={c.id} disabled={direction === "encode" && (c.id === "auto" || c.id === "jwt-decode")}>
              {c.label}
            </option>
          ))}
        </select>

        <button
          onClick={swap}
          className="px-2 py-1 rounded border border-dsos-ghost/30 text-dsos-ghost hover:text-dsos-flame hover:border-dsos-flame mono text-[10px] tracking-widest"
          title="copy output → input"
        >
          ↻
        </button>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={
          direction === "decode"
            ? "Paste something to decode..."
            : "Type something to encode..."
        }
        spellCheck={false}
        className="flex-1 min-h-[100px] px-3 py-2 bg-dsos-night border border-dsos-ghost/30 focus:border-dsos-flame outline-none text-dsos-bone text-xs mono rounded resize-none"
      />

      <div>
        <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
          OUTPUT
        </div>
        <pre className="flex-1 min-h-[80px] px-3 py-2 bg-dsos-night border border-dsos-flame/30 text-dsos-flame text-xs mono rounded whitespace-pre-wrap break-all overflow-auto">
          {output || <span className="text-dsos-ghost/40">(output appears here)</span>}
        </pre>
      </div>
    </div>
  );
}
