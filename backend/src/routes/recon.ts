import { Router } from "express";
import { promises as dns } from "node:dns";
import tls from "node:tls";
import net from "node:net";

export const reconRouter = Router();

// ---------------------------------------------------------------
// /headers — fetch a URL and inspect HTTP response + security headers
// ---------------------------------------------------------------

const SECURITY_HEADERS: { name: string; note: string }[] = [
  { name: "strict-transport-security", note: "forces HTTPS (HSTS)" },
  { name: "content-security-policy", note: "controls allowed resources (CSP)" },
  { name: "x-frame-options", note: "clickjacking defense" },
  { name: "x-content-type-options", note: "MIME-sniff defense (nosniff)" },
  { name: "referrer-policy", note: "controls Referer leakage" },
  { name: "permissions-policy", note: "feature/permission gating" },
  { name: "cross-origin-opener-policy", note: "process isolation (COOP)" },
  { name: "cross-origin-embedder-policy", note: "process isolation (COEP)" },
];

function fingerprintTech(headers: Record<string, string>, body: string): string[] {
  const hits = new Set<string>();
  const all = JSON.stringify(headers).toLowerCase();
  const pairs: [RegExp, string][] = [
    [/cloudflare/, "Cloudflare"],
    [/akamai/, "Akamai"],
    [/fastly/, "Fastly"],
    [/cf-ray/, "Cloudflare (cf-ray)"],
    [/nginx/, "nginx"],
    [/apache/, "Apache"],
    [/express/, "Express.js"],
    [/iis/, "Microsoft IIS"],
    [/vercel/, "Vercel"],
    [/netlify/, "Netlify"],
    [/aws/, "AWS (header hint)"],
    [/django/, "Django"],
    [/flask/, "Flask"],
    [/rails/, "Ruby on Rails"],
    [/laravel/, "Laravel"],
    [/php/, "PHP"],
    [/wordpress/, "WordPress (hint)"],
  ];
  for (const [re, name] of pairs) if (re.test(all)) hits.add(name);

  const b = body.toLowerCase();
  if (/wp-content|wp-includes/.test(b)) hits.add("WordPress");
  if (/drupal-settings-json|sites\/all\/modules/.test(b)) hits.add("Drupal");
  if (/<meta[^>]+next/i.test(body) || b.includes("/_next/")) hits.add("Next.js");
  if (b.includes("__nuxt")) hits.add("Nuxt");
  if (b.includes("ng-version")) hits.add("Angular");
  if (b.includes("data-reactroot") || b.includes('id="__next"')) hits.add("React");
  if (b.includes("vue.config") || /__vue/.test(b)) hits.add("Vue");
  if (b.includes("shopify")) hits.add("Shopify");
  return [...hits];
}

reconRouter.get("/headers", async (req, res, next) => {
  try {
    const raw = String(req.query.url ?? "");
    if (!raw) return res.status(400).json({ error: "url is required" });
    const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (DSOS-Recon/0.1; +https://example.invalid)",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    let body = "";
    try {
      body = (await response.text()).slice(0, 200_000);
    } catch {
      body = "";
    }

    const securityHeaders = SECURITY_HEADERS.map((h) => ({
      name: h.name,
      present: h.name in headers,
      value: headers[h.name],
      note: h.note,
    }));

    res.json({
      url,
      status: response.status,
      statusText: response.statusText,
      headers,
      tech: fingerprintTech(headers, body),
      securityHeaders,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------
// /dns — fan out across A, AAAA, MX, NS, TXT, CNAME, SOA
// ---------------------------------------------------------------

reconRouter.get("/dns", async (req, res, next) => {
  try {
    const domain = String(req.query.domain ?? "").trim();
    if (!domain) return res.status(400).json({ error: "domain is required" });

    type Lookup = { type: string; run: () => Promise<string[]> };
    const lookups: Lookup[] = [
      { type: "A", run: () => dns.resolve4(domain) },
      { type: "AAAA", run: () => dns.resolve6(domain) },
      { type: "MX", run: async () => (await dns.resolveMx(domain)).map((m) => `${m.priority} ${m.exchange}`) },
      { type: "NS", run: () => dns.resolveNs(domain) },
      { type: "TXT", run: async () => (await dns.resolveTxt(domain)).map((t) => t.join("")) },
      { type: "CNAME", run: () => dns.resolveCname(domain) },
      { type: "SOA", run: async () => {
        const s = await dns.resolveSoa(domain);
        return [`${s.nsname} ${s.hostmaster} serial=${s.serial}`];
      }},
    ];

    const records = await Promise.all(
      lookups.map(async ({ type, run }) => {
        try {
          const values = await run();
          return { type, values };
        } catch (e: unknown) {
          return { type, values: [], error: (e as Error).message };
        }
      })
    );

    res.json({ domain, records });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------
// /ssl — connect via TLS and extract certificate info
// ---------------------------------------------------------------

reconRouter.get("/ssl", async (req, res, next) => {
  try {
    const domain = String(req.query.domain ?? "").trim();
    if (!domain) return res.status(400).json({ error: "domain is required" });

    const host = domain.replace(/^https?:\/\//, "").split("/")[0];
    const port = 443;

    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: 8000,
      }, () => {
        const cert = socket.getPeerCertificate(true);
        const cipher = socket.getCipher();
        const protocol = socket.getProtocol();
        if (!cert || Object.keys(cert).length === 0) {
          socket.end();
          return reject(new Error("no certificate returned"));
        }
        const altNames = (cert.subjectaltname ?? "")
          .split(", ")
          .map((s) => s.replace(/^DNS:/, ""))
          .filter(Boolean);
        const validFrom = new Date(cert.valid_from);
        const validTo = new Date(cert.valid_to);
        const daysRemaining = Math.round(
          (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        resolve({
          domain: host,
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysRemaining,
          subjectAltNames: altNames,
          fingerprint: cert.fingerprint256 ?? cert.fingerprint ?? "",
          serialNumber: cert.serialNumber ?? "",
          protocol: protocol ?? "unknown",
          cipher: cipher
            ? { name: cipher.name, version: cipher.version }
            : undefined,
        });
        socket.end();
      });
      socket.on("error", reject);
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("connection timed out"));
      });
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------
// /subdomains — pull certificate transparency from crt.sh (free, no key)
// ---------------------------------------------------------------

reconRouter.get("/subdomains", async (req, res, next) => {
  try {
    const domain = String(req.query.domain ?? "").trim();
    if (!domain) return res.status(400).json({ error: "domain is required" });

    const url = `https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`;
    const r = await fetch(url, {
      headers: { "User-Agent": "DSOS-Recon/0.1" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      return res.status(502).json({
        error: `crt.sh returned ${r.status}`,
        hint: "crt.sh is occasionally slow; try again in a moment.",
      });
    }
    const data = (await r.json()) as { name_value?: string }[];
    const found = new Set<string>();
    for (const row of data) {
      const names = (row.name_value ?? "").split("\n");
      for (const n of names) {
        const clean = n.trim().toLowerCase();
        if (clean && clean.endsWith(domain.toLowerCase())) {
          found.add(clean.replace(/^\*\./, ""));
        }
      }
    }
    res.json({
      subdomains: [...found].sort(),
      source: "crt.sh certificate transparency",
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------
// /whois — speak the WHOIS protocol on port 43
// ---------------------------------------------------------------

function whoisQuery(server: string, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const sock = net.createConnection({ host: server, port: 43, timeout: 6000 });
    sock.on("connect", () => sock.write(query + "\r\n"));
    sock.on("data", (chunk) => (data += chunk.toString("utf8")));
    sock.on("end", () => resolve(data));
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("whois timeout"));
    });
    sock.on("error", reject);
  });
}

function parseWhois(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9 _\-/]+?):\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    if (!out[key]) out[key] = m[2];
  }
  return out;
}

reconRouter.get("/whois", async (req, res, next) => {
  try {
    const domain = String(req.query.domain ?? "").trim().toLowerCase();
    if (!domain) return res.status(400).json({ error: "domain is required" });

    // Stage 1 — IANA tells us the authoritative WHOIS server for the TLD.
    const ianaResp = await whoisQuery("whois.iana.org", domain);
    const refMatch = ianaResp.match(/whois:\s*(\S+)/i);
    let raw = ianaResp;
    if (refMatch) {
      try {
        raw = await whoisQuery(refMatch[1], domain);
      } catch (e) {
        raw = ianaResp + `\n\n[dsos] could not query ${refMatch[1]}: ${(e as Error).message}`;
      }
    }
    res.json({ raw, parsed: parseWhois(raw) });
  } catch (e) {
    next(e);
  }
});
