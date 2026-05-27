import { useState } from "react";
import { AuthorizedBanner } from "../components/AuthorizedBanner";

interface Payload {
  id: string;
  category: "XSS" | "SQLi" | "SSRF" | "LFI" | "CMDi" | "XXE";
  title: string;
  payload: string;
  explanation: string;
  defense: string;
}

const PAYLOADS: Payload[] = [
  {
    id: "xss-1",
    category: "XSS",
    title: "Classic reflected XSS probe",
    payload: `<script>alert(1)</script>`,
    explanation:
      "If this fires an alert, user input is being rendered directly into HTML without escaping. The app trusts you to be HTML, and you're running script.",
    defense:
      "Contextual output encoding (HTML, attribute, JS, URL) + a strict Content-Security-Policy. Frameworks like React auto-escape; don't break it with dangerouslySetInnerHTML.",
  },
  {
    id: "xss-2",
    category: "XSS",
    title: "Filter-evasion via event handler",
    payload: `<img src=x onerror=alert(1)>`,
    explanation:
      "Bypasses naive <script> blocklists. Any event handler attribute on a broken/loaded element is a vector.",
    defense:
      "Don't blocklist — encode. CSP without 'unsafe-inline' kills inline handlers entirely.",
  },
  {
    id: "xss-3",
    category: "XSS",
    title: "DOM XSS via location.hash",
    payload: `document.body.innerHTML = location.hash.slice(1)`,
    explanation:
      "Vulnerable client-side code writes attacker-controlled URL fragments straight into the DOM.",
    defense:
      "Treat URL inputs as untrusted. Use textContent, never innerHTML, with user data.",
  },
  {
    id: "sqli-1",
    category: "SQLi",
    title: "Login bypass via boolean truth",
    payload: `' OR '1'='1' -- `,
    explanation:
      "If the backend builds SQL by string concatenation, the OR clause makes the WHERE always true and -- comments out the rest.",
    defense:
      "Parameterized queries / prepared statements. Never concatenate SQL with user input, ever.",
  },
  {
    id: "sqli-2",
    category: "SQLi",
    title: "UNION-based data exfil",
    payload: `' UNION SELECT NULL, username, password FROM users -- `,
    explanation:
      "Once you know the column count, UNION lets you tack a SELECT from a sensitive table onto the original query.",
    defense:
      "Prepared statements + least-privilege DB user. The web app's DB user should never have SELECT on credential tables it doesn't need.",
  },
  {
    id: "sqli-3",
    category: "SQLi",
    title: "Blind time-based",
    payload: `'; IF (1=1) WAITFOR DELAY '0:0:5' --`,
    explanation:
      "No visible output? Inject something that takes a measurable time and watch the response latency. MSSQL flavor shown; MySQL uses SLEEP(5).",
    defense:
      "Same as above. Also: log + alert on anomalously slow queries; they're a tell.",
  },
  {
    id: "ssrf-1",
    category: "SSRF",
    title: "AWS instance metadata exfil",
    payload: `http://169.254.169.254/latest/meta-data/iam/security-credentials/`,
    explanation:
      "Trick a server that fetches arbitrary URLs into hitting the IMDS endpoint and returning cloud credentials.",
    defense:
      "Use IMDSv2 (requires a session token). Block egress to link-local + RFC1918 from app servers. Validate URLs with an allowlist of hosts, not a denylist.",
  },
  {
    id: "ssrf-2",
    category: "SSRF",
    title: "DNS rebinding bypass",
    payload: `http://attacker-controlled-dns.test/`,
    explanation:
      "Domain resolves to a public IP at validation time, then re-resolves to 127.0.0.1 when the server actually fetches it.",
    defense:
      "Resolve once, pin the IP, and validate that IP. Or fetch through an egress proxy that re-validates each hop.",
  },
  {
    id: "lfi-1",
    category: "LFI",
    title: "Path traversal to /etc/passwd",
    payload: `../../../../etc/passwd`,
    explanation:
      "If a file-reading endpoint joins user input into a path without normalizing, '..' segments walk out of the intended directory.",
    defense:
      "Resolve the final path with path.resolve and assert it's inside the intended root. Don't let user input pick the filename — pick from an allowlist or hash-keyed lookup.",
  },
  {
    id: "lfi-2",
    category: "LFI",
    title: "PHP wrapper to read source",
    payload: `php://filter/convert.base64-encode/resource=index.php`,
    explanation:
      "PHP exposes 'stream wrappers' that turn include()/file_get_contents() into source-code dumpers when fed user input.",
    defense:
      "allow_url_include=Off and don't pass user input to include/require. Avoid file path inputs entirely where possible.",
  },
  {
    id: "cmd-1",
    category: "CMDi",
    title: "Command chaining",
    payload: `; cat /etc/passwd`,
    explanation:
      "If a process spawns a shell with user input, ';' '&&' '|' '$()' all chain a second command.",
    defense:
      "Don't use a shell at all. Use the array form of exec/spawn so arguments aren't re-parsed: exec('ping', [host]) not exec('ping ' + host).",
  },
  {
    id: "xxe-1",
    category: "XXE",
    title: "Classic external entity",
    payload: `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<foo>&xxe;</foo>`,
    explanation:
      "XML parsers that resolve external entities turn an XML upload into a local-file read.",
    defense:
      "Disable DTDs / external entity resolution in your parser. Modern parsers default safer, but legacy ones (libxml older settings, Java's default SAXParser pre-fix) still bite.",
  },
];

const CATEGORIES = ["XSS", "SQLi", "SSRF", "LFI", "CMDi", "XXE"] as const;

export function Armory() {
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("XSS");
  const [copied, setCopied] = useState<string | null>(null);

  const payloads = PAYLOADS.filter((p) => p.category === cat);

  function copy(p: Payload) {
    navigator.clipboard.writeText(p.payload).catch(() => {});
    setCopied(p.id);
    setTimeout(() => setCopied((c) => (c === p.id ? null : c)), 1500);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <AuthorizedBanner />
      <div className="px-3 py-2 flex gap-1 border-b border-dsos-flame/15 overflow-x-auto dsos-scrollbar">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1 text-xs rounded-md whitespace-nowrap ${
              cat === c
                ? "bg-dsos-flame/25 text-dsos-bone border border-dsos-flame/50"
                : "text-dsos-ghost hover:text-dsos-bone hover:bg-dsos-flame/10"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto dsos-scrollbar p-3 space-y-3">
        <div className="text-[11px] text-dsos-ghost">
          Each entry is a teaching artifact: what it is, why it works, and how
          you&#39;d defend against it. Practice on intentionally vulnerable
          targets ({" "}
          <a className="underline hover:text-dsos-glow" target="_blank" rel="noreferrer" href="https://github.com/digininja/DVWA">DVWA</a>
          ,{" "}
          <a className="underline hover:text-dsos-glow" target="_blank" rel="noreferrer" href="https://portswigger.net/web-security">PortSwigger Academy</a>
          ,{" "}
          <a className="underline hover:text-dsos-glow" target="_blank" rel="noreferrer" href="https://www.hackthebox.com/">HackTheBox</a>
          ).
        </div>
        {payloads.map((p) => (
          <div key={p.id} className="glass rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="script text-lg text-dsos-glow text-glow">{p.title}</span>
              <span className="text-[10px] mono px-1.5 py-0.5 rounded bg-dsos-flame/20 border border-dsos-flame/40">
                {p.category}
              </span>
            </div>
            <pre className="mono text-[11px] bg-black/40 border border-dsos-flame/20 rounded p-2 whitespace-pre-wrap text-dsos-bone">
              {p.payload}
            </pre>
            <button onClick={() => copy(p)} className="btn-ghost text-xs">
              {copied === p.id ? "copied!" : "copy"}
            </button>
            <div className="text-[12px] text-dsos-bone">
              <span className="text-dsos-flame font-semibold">how:</span> {p.explanation}
            </div>
            <div className="text-[12px] text-dsos-bone">
              <span className="text-dsos-glow font-semibold">defense:</span> {p.defense}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
