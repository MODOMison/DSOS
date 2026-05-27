import { useCallback, useState } from "react";

interface Signature {
  offset: number;
  bytes: number[];
  name: string;
  kind: "image" | "archive" | "executable" | "document" | "audio" | "video" | "script" | "other";
  notes?: string;
}

// Magic numbers — curated, not exhaustive. Order matters: more specific first.
const SIGNATURES: Signature[] = [
  // Images
  { offset: 0, bytes: [0xff, 0xd8, 0xff], name: "JPEG image", kind: "image" },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name: "PNG image", kind: "image" },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], name: "GIF image", kind: "image" },
  { offset: 0, bytes: [0x42, 0x4d], name: "BMP image", kind: "image" },
  { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00], name: "TIFF image (little-endian)", kind: "image" },
  { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a], name: "TIFF image (big-endian)", kind: "image" },
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], name: "RIFF container (WebP/WAV/AVI — check offset 8)", kind: "other" },
  // Archives
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], name: "ZIP archive (or modern Office .docx/.xlsx/.jar/.apk)", kind: "archive" },
  { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06], name: "ZIP archive (empty)", kind: "archive" },
  { offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08], name: "ZIP archive (spanned)", kind: "archive" },
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], name: "RAR archive", kind: "archive" },
  { offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], name: "7-Zip archive", kind: "archive" },
  { offset: 0, bytes: [0x1f, 0x8b], name: "gzip-compressed", kind: "archive" },
  { offset: 0, bytes: [0x42, 0x5a, 0x68], name: "bzip2-compressed", kind: "archive" },
  { offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], name: "xz-compressed", kind: "archive" },
  { offset: 0, bytes: [0x75, 0x73, 0x74, 0x61, 0x72], name: "tar archive", kind: "archive" },
  // Executables
  { offset: 0, bytes: [0x4d, 0x5a], name: "Windows PE executable (.exe/.dll)", kind: "executable", notes: "Inspect e_lfanew offset for PE header location." },
  { offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46], name: "ELF executable (Linux/BSD)", kind: "executable" },
  { offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xce], name: "Mach-O executable (32-bit)", kind: "executable" },
  { offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xcf], name: "Mach-O executable (64-bit)", kind: "executable" },
  { offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe], name: "Mach-O executable (64-bit, reversed)", kind: "executable" },
  { offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe], name: "Java class file OR Mach-O fat binary", kind: "executable" },
  { offset: 0, bytes: [0x55, 0x50, 0x58, 0x21], name: "UPX-packed binary (header marker)", kind: "executable", notes: "Run `upx -d` to unpack." },
  // Documents
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], name: "PDF document", kind: "document" },
  { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], name: "Microsoft Office (legacy .doc/.xls/.ppt) — OLE2", kind: "document" },
  { offset: 0, bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31], name: "RTF document", kind: "document" },
  // Audio
  { offset: 0, bytes: [0x49, 0x44, 0x33], name: "MP3 audio (ID3v2 tag)", kind: "audio" },
  { offset: 0, bytes: [0xff, 0xfb], name: "MP3 audio (raw frame)", kind: "audio" },
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], name: "Ogg container (Vorbis/Opus/Theora)", kind: "audio" },
  { offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43], name: "FLAC audio", kind: "audio" },
  // Video / containers
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], name: "MP4 / QuickTime container", kind: "video" },
  { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], name: "Matroska / WebM container", kind: "video" },
  // Scripts / text
  { offset: 0, bytes: [0x23, 0x21], name: "Shebang script (#!) — text", kind: "script", notes: "Check the interpreter on line 1." },
  { offset: 0, bytes: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], name: "XML document", kind: "document" },
  { offset: 0, bytes: [0x3c, 0x21, 0x44, 0x4f, 0x43], name: "HTML document (DOCTYPE)", kind: "document" },
  { offset: 0, bytes: [0xef, 0xbb, 0xbf], name: "UTF-8 BOM (text file)", kind: "other" },
  { offset: 0, bytes: [0xff, 0xfe], name: "UTF-16 LE BOM (text file)", kind: "other" },
  { offset: 0, bytes: [0xfe, 0xff], name: "UTF-16 BE BOM (text file)", kind: "other" },
];

function matchSignatures(bytes: Uint8Array): Signature[] {
  return SIGNATURES.filter((sig) => {
    if (bytes.length < sig.offset + sig.bytes.length) return false;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (bytes[sig.offset + i] !== sig.bytes[i]) return false;
    }
    return true;
  });
}

function entropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Array(256).fill(0);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  let h = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / bytes.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function extractStrings(bytes: Uint8Array, min = 6, max = 40): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 32 && b < 127) {
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= min) out.push(cur);
      cur = "";
    }
    if (out.length >= max) break;
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

function hex(bytes: Uint8Array, n: number): string {
  const slice = bytes.slice(0, n);
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function ascii(bytes: Uint8Array, n: number): string {
  return Array.from(bytes.slice(0, n))
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "·"))
    .join("");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer — handles SharedArrayBuffer-backed Uint8Arrays.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface FileReport {
  name: string;
  size: number;
  ext: string;
  matches: Signature[];
  entropy: number;
  entropyLabel: string;
  hexPreview: string;
  asciiPreview: string;
  strings: string[];
  sha256: string;
  mismatch: boolean;
}

const EXT_KIND_HINT: Record<string, Signature["kind"]> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", bmp: "image",
  zip: "archive", rar: "archive", "7z": "archive", gz: "archive", tar: "archive",
  exe: "executable", dll: "executable", so: "executable", elf: "executable",
  pdf: "document", doc: "document", docx: "document", xls: "document", xlsx: "document",
  mp3: "audio", flac: "audio", ogg: "audio", wav: "audio",
  mp4: "video", mkv: "video", webm: "video", mov: "video",
};

export function SigilReader() {
  const [report, setReport] = useState<FileReport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setReading(true);
    setReport(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const matches = matchSignatures(bytes);
      const ent = entropy(bytes);
      const entropyLabel =
        ent < 1
          ? "very low (zeros/repeated)"
          : ent < 5
          ? "low (text-like)"
          : ent < 7.2
          ? "medium (mixed binary)"
          : ent < 7.8
          ? "high (compressed/random)"
          : "very high (encrypted/packed)";

      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      const expectedKind = EXT_KIND_HINT[ext];
      const mismatch =
        matches.length > 0 && expectedKind !== undefined &&
        !matches.some((m) => m.kind === expectedKind);

      const sha256 = await sha256Hex(bytes);

      setReport({
        name: file.name,
        size: file.size,
        ext,
        matches,
        entropy: ent,
        entropyLabel,
        hexPreview: hex(bytes, 32),
        asciiPreview: ascii(bytes, 32),
        strings: extractStrings(bytes),
        sha256,
        mismatch,
      });
    } finally {
      setReading(false);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div className="p-4 text-dsos-bone space-y-3 h-full flex flex-col overflow-auto">
      <div>
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">
          DSOS // SIGIL READER
        </div>
        <div className="text-xs text-dsos-bone/60 mt-0.5">
          Drop a file. We read the first bytes locally — nothing leaves your machine.
          Identifies real format, flags extension/format mismatch, samples entropy + strings.
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`block border-2 border-dashed rounded p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-dsos-flame bg-dsos-flame/10"
            : "border-dsos-ghost/30 hover:border-dsos-flame/50"
        }`}
      >
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <div className="text-3xl text-dsos-flame mb-2">⌬</div>
        <div className="mono text-xs text-dsos-bone tracking-wider">
          DROP FILE OR CLICK
        </div>
        <div className="text-[10px] mono text-dsos-ghost/50 mt-1">
          Stays on this machine. No upload.
        </div>
      </label>

      {reading && (
        <div className="text-xs mono text-dsos-flame animate-pulse">reading...</div>
      )}

      {report && (
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <Field label="NAME" value={report.name} />
            <Field label="SIZE" value={fmtBytes(report.size)} />
            <Field label="EXTENSION" value={report.ext || "(none)"} />
            <Field label="ENTROPY" value={`${report.entropy.toFixed(2)} bits — ${report.entropyLabel}`} />
          </div>

          {report.mismatch && (
            <div className="border border-red-400/50 bg-red-400/10 rounded p-2">
              <div className="mono text-[10px] text-red-400 tracking-widest">⚠ EXTENSION / FORMAT MISMATCH</div>
              <div className="text-dsos-bone/90 mt-1">
                File is named <code>.{report.ext}</code> but its bytes say{" "}
                <code>{report.matches[0]?.name}</code>. Could be a polyglot, malware
                disguise, or just a renamed file.
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
              SIGNATURE MATCHES ({report.matches.length})
            </div>
            {report.matches.length === 0 ? (
              <div className="text-dsos-ghost/50">
                No magic-byte match. Could be a custom format, text, or fully encrypted.
              </div>
            ) : (
              <div className="space-y-1">
                {report.matches.map((m, i) => (
                  <div
                    key={i}
                    className="border border-dsos-flame/40 bg-dsos-flame/5 rounded p-2"
                  >
                    <div className="text-dsos-flame">{m.name}</div>
                    {m.notes && (
                      <div className="text-dsos-bone/70 text-[11px] mt-1">{m.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
              FIRST 32 BYTES
            </div>
            <pre className="bg-dsos-night border border-dsos-ghost/30 rounded p-2 text-[11px] mono leading-relaxed">
              <span className="text-dsos-flame">{report.hexPreview}</span>
              {"\n"}
              <span className="text-dsos-bone/80">{report.asciiPreview}</span>
            </pre>
          </div>

          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
              SHA-256
            </div>
            <pre className="bg-dsos-night border border-dsos-ghost/30 rounded p-2 text-[10px] mono break-all">
              {report.sha256}
            </pre>
          </div>

          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
              STRINGS ({report.strings.length} shown, ≥6 chars)
            </div>
            <pre className="bg-dsos-night border border-dsos-ghost/30 rounded p-2 text-[11px] mono whitespace-pre-wrap max-h-40 overflow-auto">
              {report.strings.join("\n") || "(none found)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-dsos-night border border-dsos-ghost/30 rounded p-2">
      <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider">{label}</div>
      <div className="text-dsos-bone text-xs mono break-all mt-0.5">{value}</div>
    </div>
  );
}
