// Tool definitions + executor for Shadows's agent loop.
// Most tools wrap a DSOS /api route via loopback. The memory_* tools talk
// to the DB directly because they need per-user scoping.

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const SHADOWS_TOOLS: Anthropic.Tool[] = [
  {
    name: "recon_dns",
    description:
      "Look up DNS records (A, AAAA, MX, NS, TXT, CNAME, SOA) for a domain. Use this for footprinting: who hosts the mail, who's the nameserver, what TXT records exist (SPF/DKIM/verification tokens).",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "Domain to query, e.g. example.com (no scheme).",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "recon_headers",
    description:
      "Fetch a URL and inspect HTTP response headers, audit security headers (HSTS, CSP, X-Frame-Options, etc.), and fingerprint the web stack. Use this to gauge a target's security posture from the outside.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "URL to fetch, e.g. https://example.com.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "recon_tls",
    description:
      "Connect to a domain over TLS on port 443 and inspect the certificate: issuer, validity dates, subject alternative names, protocol version, cipher.",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "Domain or hostname to inspect, e.g. example.com.",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "recon_subdomains",
    description:
      "Enumerate subdomains of a domain via certificate transparency logs (crt.sh). Passive — no traffic touches the target. Returns the sorted unique list.",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "Apex domain, e.g. example.com.",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "recon_whois",
    description:
      "Query WHOIS for a domain over the port-43 protocol. Returns parsed key/value pairs plus the raw record. Use for registration data, registrar, dates.",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "Domain to look up.",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "cve_search",
    description:
      "Search the NIST NVD for CVEs by keyword (e.g. 'log4j', 'openssl') or by CVE ID (e.g. 'CVE-2021-44228'). Returns CVSS score, severity, vector, description, CWE, and reference links.",
    input_schema: {
      type: "object" as const,
      properties: {
        q: {
          type: "string",
          description:
            "Keyword or CVE ID. CVE IDs match the pattern CVE-YYYY-N.",
        },
      },
      required: ["q"],
    },
  },
  {
    name: "hash_identify",
    description:
      "Identify the format of a hash string (MD5, SHA-1/224/256/384/512, bcrypt, Argon2, scrypt, PBKDF2, JWT, MySQL, etc.) by pattern. Returns candidate algorithms with a confidence label.",
    input_schema: {
      type: "object" as const,
      properties: {
        hash: {
          type: "string",
          description: "The hash string to identify.",
        },
      },
      required: ["hash"],
    },
  },
  {
    name: "breach_check",
    description:
      "Check whether a password appears in known breaches using HaveIBeenPwned's k-anonymity API. Only the first 5 hex chars of the SHA-1 hash ever leave the server. Returns the breach count.",
    input_schema: {
      type: "object" as const,
      properties: {
        password: {
          type: "string",
          description: "The password to check.",
        },
      },
      required: ["password"],
    },
  },
  {
    name: "phish_analyze",
    description:
      "Heuristically analyze a suspicious email. Paste the raw text (headers + body). Returns a verdict (likely-phish / suspicious / looks-clean), score, and specific signals: urgency language, reply-to mismatches, typosquat domains, anchor href vs visible URL mismatches, suspicious attachments, SPF/DKIM/DMARC hints.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: {
          type: "string",
          description: "The raw email text (headers + body).",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "memory_save",
    description:
      "Save a fact about this user so you remember it in future conversations. Use this whenever the user tells you something personal you'd want a real friend to remember: their name, what they're building, their stack (e.g. 'uses Rust + Postgres'), their goals (e.g. 'studying for OSCP'), their preferences ('hates verbose explanations'), their schedule, things they're stressed about. Append-only — each call adds a single short note. Keep notes terse (one sentence). Don't save passwords, secrets, or anything sensitive.",
    input_schema: {
      type: "object" as const,
      properties: {
        note: {
          type: "string",
          description:
            "One short sentence to remember. E.g. 'name is Matto', 'building DSOS, a cybersec workbench', 'prefers terse answers'.",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "memory_forget",
    description:
      "Clear all stored notes about this user. Only use when the user explicitly asks you to forget them or to wipe your memory.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export function getUserNotes(userId: string): string | null {
  const [row] = db
    .select({ notes: schema.users.shadowsNotes })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .all();
  return row?.notes ?? null;
}

function appendUserNote(userId: string, note: string) {
  const current = getUserNotes(userId) ?? "";
  const trimmed = note.trim().slice(0, 280);
  if (!trimmed) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const merged = current ? `${current}\n- (${stamp}) ${trimmed}` : `- (${stamp}) ${trimmed}`;
  // Cap total memory to keep prompts cheap (~4 KB).
  const capped = merged.length > 4000 ? merged.slice(merged.length - 4000) : merged;
  db.update(schema.users).set({ shadowsNotes: capped }).where(eq(schema.users.id, userId)).run();
}

function clearUserNotes(userId: string) {
  db.update(schema.users).set({ shadowsNotes: null }).where(eq(schema.users.id, userId)).run();
}

type ToolInput = Record<string, unknown>;

export async function executeTool(
  name: string,
  input: ToolInput,
  port: number,
  userId?: string
): Promise<{ ok: boolean; output: string }> {
  // Memory tools — direct DB access, no HTTP loopback (loopback can't
  // re-authenticate the user mid-stream).
  if (name === "memory_save") {
    if (!userId) return { ok: false, output: "memory_save unavailable: no user context" };
    const note = String(input.note ?? "").trim();
    if (!note) return { ok: false, output: "note is required" };
    appendUserNote(userId, note);
    return { ok: true, output: `Remembered: ${note}` };
  }
  if (name === "memory_forget") {
    if (!userId) return { ok: false, output: "memory_forget unavailable: no user context" };
    clearUserNotes(userId);
    return { ok: true, output: "All notes cleared." };
  }

  const base = `http://localhost:${port}/api`;
  let url: string;
  let init: RequestInit = {};

  switch (name) {
    case "recon_dns":
      url = `${base}/recon/dns?domain=${encodeURIComponent(String(input.domain ?? ""))}`;
      break;
    case "recon_headers":
      url = `${base}/recon/headers?url=${encodeURIComponent(String(input.url ?? ""))}`;
      break;
    case "recon_tls":
      url = `${base}/recon/ssl?domain=${encodeURIComponent(String(input.domain ?? ""))}`;
      break;
    case "recon_subdomains":
      url = `${base}/recon/subdomains?domain=${encodeURIComponent(String(input.domain ?? ""))}`;
      break;
    case "recon_whois":
      url = `${base}/recon/whois?domain=${encodeURIComponent(String(input.domain ?? ""))}`;
      break;
    case "cve_search":
      url = `${base}/cve/search?q=${encodeURIComponent(String(input.q ?? ""))}`;
      break;
    case "hash_identify":
      url = `${base}/hash/identify`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: String(input.hash ?? "") }),
      };
      break;
    case "breach_check":
      url = `${base}/breach/password`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: String(input.password ?? "") }),
      };
      break;
    case "phish_analyze":
      url = `${base}/phish/analyze`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(input.email ?? "") }),
      };
      break;
    default:
      return { ok: false, output: `unknown tool: ${name}` };
  }

  try {
    const r = await fetch(url, init);
    const text = await r.text();
    // crt.sh + NVD can return hefty payloads. Cap so we don't eat the
    // context window or trigger compaction prematurely.
    const capped =
      text.length > 16000
        ? text.slice(0, 16000) + '\n... [truncated by Shadows tool runner]'
        : text;
    return { ok: r.ok, output: capped };
  } catch (e) {
    return { ok: false, output: `tool error: ${(e as Error).message}` };
  }
}
