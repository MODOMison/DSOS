import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

interface Line {
  kind: "in" | "out" | "err" | "sys";
  text: string;
}

const HELP = `Commands:
  help                          show this
  recon headers <url>           fetch HTTP response + security headers
  recon dns <domain>            DNS records (A, AAAA, MX, NS, TXT, CNAME, SOA)
  recon ssl <domain>            inspect TLS certificate
  recon subs <domain>           subdomains via crt.sh
  recon whois <domain>          WHOIS lookup
  cve <query>                   search NVD (keyword or CVE-ID)
  hash <string>                 identify a hash format
  breach <password>             check HaveIBeenPwned (k-anonymity)
  clear                         clear the terminal
  exit                          close this window`;

export function HellfireTerminal() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "DSOS · Hellfire Terminal · type `help` to begin" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, busy]);

  function append(...newLines: Line[]) {
    setLines((l) => [...l, ...newLines]);
  }

  async function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    setHistory((h) => [...h, cmd]);
    setHistIdx(null);
    append({ kind: "in", text: `❯ ${cmd}` });

    const [verb, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(" ");

    try {
      setBusy(true);
      if (verb === "help") return append({ kind: "out", text: HELP });
      if (verb === "clear") return setLines([]);
      if (verb === "exit") {
        append({ kind: "sys", text: "(close the window with the × button)" });
        return;
      }

      if (verb === "recon") {
        const sub = rest[0];
        const target = rest.slice(1).join(" ");
        if (!sub || !target) {
          return append({ kind: "err", text: "usage: recon <headers|dns|ssl|subs|whois> <target>" });
        }
        if (sub === "headers") {
          const r = await api.recon.headers(target);
          append({
            kind: "out",
            text: `${r.status} ${r.statusText} — ${r.url}\nTech: ${r.tech.join(", ") || "(none)"}\nSecurity headers missing: ${r.securityHeaders.filter(h => !h.present).map(h => h.name).join(", ") || "(none)"}`,
          });
        } else if (sub === "dns") {
          const r = await api.recon.dns(target);
          const out = r.records
            .map((rec) => `${rec.type}: ${rec.values.join(", ") || rec.error || "(none)"}`)
            .join("\n");
          append({ kind: "out", text: out });
        } else if (sub === "ssl") {
          const r = await api.recon.ssl(target);
          append({
            kind: "out",
            text: `Issuer: ${r.issuer.O ?? "?"}\nValid: ${r.validFrom} → ${r.validTo}\nDays remaining: ${r.daysRemaining}\nSANs: ${r.subjectAltNames.slice(0, 6).join(", ")}${r.subjectAltNames.length > 6 ? "..." : ""}`,
          });
        } else if (sub === "subs") {
          const r = await api.recon.subdomains(target);
          append({
            kind: "out",
            text: `${r.subdomains.length} subdomain(s):\n${r.subdomains.slice(0, 60).join("\n")}${r.subdomains.length > 60 ? `\n... and ${r.subdomains.length - 60} more` : ""}`,
          });
        } else if (sub === "whois") {
          const r = await api.recon.whois(target);
          append({ kind: "out", text: r.raw.slice(0, 4000) });
        } else {
          append({ kind: "err", text: `unknown recon subcommand: ${sub}` });
        }
        return;
      }

      if (verb === "cve") {
        if (!arg) return append({ kind: "err", text: "usage: cve <query>" });
        const r = await api.cve.search(arg);
        const out = r.results.slice(0, 8).map((c) =>
          `${c.id}  [${c.cvssSeverity ?? "?"} ${c.cvssScore ?? "?"}]  ${c.description.slice(0, 140)}${c.description.length > 140 ? "..." : ""}`
        ).join("\n");
        append({ kind: "out", text: out || `no results for "${arg}"` });
        return;
      }

      if (verb === "hash") {
        if (!arg) return append({ kind: "err", text: "usage: hash <string>" });
        const r = await api.hash.identify(arg);
        append({
          kind: "out",
          text: r.candidates.length
            ? r.candidates.map((c) => `${c.name} (${c.confidence})`).join("\n")
            : "no match",
        });
        return;
      }

      if (verb === "breach") {
        if (!arg) return append({ kind: "err", text: "usage: breach <password>" });
        const r = await api.breach.password(arg);
        append({
          kind: "out",
          text: r.pwned
            ? `⚠ pwned — seen ${r.count.toLocaleString()} times in breaches`
            : "✓ not found in HIBP",
        });
        return;
      }

      append({ kind: "err", text: `unknown command: ${verb}. type \`help\`.` });
    } catch (e) {
      append({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 mono text-[12px] bg-black/60"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto dsos-scrollbar px-3 py-2">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "in"
                ? "text-dsos-glow"
                : l.kind === "err"
                ? "text-dsos-flame"
                : l.kind === "sys"
                ? "text-dsos-ghost italic"
                : "text-dsos-bone whitespace-pre-wrap"
            }
          >
            {l.text}
          </div>
        ))}
        {busy && <div className="text-dsos-glow animate-pulse">...</div>}
      </div>
      <form
        className="flex items-center gap-2 px-3 py-2 border-t border-dsos-flame/20"
        onSubmit={(e) => {
          e.preventDefault();
          const cmd = input;
          setInput("");
          run(cmd);
        }}
      >
        <span className="text-dsos-flame">❯</span>
        <input
          ref={inputRef}
          autoFocus
          className="flex-1 bg-transparent outline-none text-dsos-bone"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (!history.length) return;
              const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
              setHistIdx(idx);
              setInput(history[idx]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (histIdx === null) return;
              const idx = histIdx + 1;
              if (idx >= history.length) {
                setHistIdx(null);
                setInput("");
              } else {
                setHistIdx(idx);
                setInput(history[idx]);
              }
            }
          }}
        />
      </form>
    </div>
  );
}
