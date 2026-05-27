import { useMemo, useState } from "react";

interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  raw: { header: string; payload: string; signature: string };
}

interface Finding {
  severity: "high" | "med" | "low" | "info";
  title: string;
  detail: string;
}

function b64urlDecode(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return atob(t);
}

function parseJwt(token: string): { ok: true; jwt: JwtParts } | { ok: false; error: string } {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "JWT must have three parts separated by dots" };
  }
  try {
    const header = JSON.parse(b64urlDecode(parts[0]));
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return {
      ok: true,
      jwt: {
        header,
        payload,
        signature: parts[2],
        raw: { header: parts[0], payload: parts[1], signature: parts[2] },
      },
    };
  } catch (e) {
    return { ok: false, error: `parse failed: ${(e as Error).message}` };
  }
}

const COMMON_WEAK_SECRETS = [
  "secret", "password", "123456", "admin", "key", "jwt", "test", "default",
  "changeme", "qwerty", "letmein", "secretkey", "your-256-bit-secret",
  "your-secret", "supersecret", "mysecret", "topsecret", "private", "token",
  "auth", "api-key", "apikey", "password123", "iamasecret", "shhh",
  "secret123", "JWT_SECRET", "jwtsecret", "mysecretkey", "sekret",
];

async function tryWeakSecrets(token: string, alg: string): Promise<string | null> {
  if (alg !== "HS256" && alg !== "HS384" && alg !== "HS512") return null;
  const enc = new TextEncoder();
  const [headerB64, payloadB64, sigB64] = token.split(".");
  const data = enc.encode(`${headerB64}.${payloadB64}`);
  const hashAlg = alg === "HS256" ? "SHA-256" : alg === "HS384" ? "SHA-384" : "SHA-512";

  const expectedSig = Uint8Array.from(b64urlDecode(sigB64), (c) => c.charCodeAt(0));

  for (const candidate of COMMON_WEAK_SECRETS) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(candidate),
        { name: "HMAC", hash: hashAlg },
        false,
        ["sign"]
      );
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
      if (sig.length !== expectedSig.length) continue;
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (sig[i] !== expectedSig[i]) {
          match = false;
          break;
        }
      }
      if (match) return candidate;
    } catch {
      /* skip */
    }
  }
  return null;
}

function audit(jwt: JwtParts, weakSecret: string | null): Finding[] {
  const findings: Finding[] = [];
  const { header, payload } = jwt;

  // alg=none
  const alg = (header.alg as string | undefined)?.toLowerCase();
  if (alg === "none") {
    findings.push({
      severity: "high",
      title: "alg=none accepted",
      detail:
        'The token is signed with the "none" algorithm. Any server that accepts this is fully bypassable — change any claim and resign with no signature.',
    });
  }

  if (alg === "hs256" || alg === "hs384" || alg === "hs512") {
    if (weakSecret) {
      findings.push({
        severity: "high",
        title: `HMAC secret cracked: "${weakSecret}"`,
        detail:
          "The signing secret was found in our top-30 weak-secret list. Anyone can forge tokens. Rotate to a 256-bit random secret immediately.",
      });
    } else {
      findings.push({
        severity: "info",
        title: "HMAC alg — secret not in common-weak list",
        detail:
          "We tried 30 common passwords; none matched. A real dictionary attack would use millions of candidates — don't take this as proof of strength.",
      });
    }
  }

  if (alg === "rs256" || alg === "rs384" || alg === "rs512") {
    findings.push({
      severity: "med",
      title: "RSA token — alg-confusion check applies",
      detail:
        'If the server uses the *public key* as an HMAC secret when alg is flipped to HS256, forgery is possible. Try resigning with HS256 and the public key as the shared secret.',
    });
  }

  // exp
  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp as number | undefined;
  if (typeof exp === "number") {
    if (exp < now) {
      const ago = humanDelta(now - exp);
      findings.push({
        severity: "info",
        title: `Token expired ${ago} ago`,
        detail: `exp = ${new Date(exp * 1000).toISOString()}`,
      });
    } else {
      const left = humanDelta(exp - now);
      const long = exp - now > 60 * 60 * 24 * 30;
      findings.push({
        severity: long ? "med" : "info",
        title: long ? `Long-lived token (${left} remaining)` : `Token valid for ${left}`,
        detail: long
          ? "Tokens that live >30 days are risky if leaked. Prefer short-lived access tokens + refresh tokens."
          : `exp = ${new Date(exp * 1000).toISOString()}`,
      });
    }
  } else {
    findings.push({
      severity: "med",
      title: "No `exp` claim",
      detail: "Tokens without expiry are valid forever. Always set `exp`.",
    });
  }

  // nbf
  const nbf = payload.nbf as number | undefined;
  if (typeof nbf === "number" && nbf > now) {
    findings.push({
      severity: "info",
      title: "Not yet valid (nbf in the future)",
      detail: `nbf = ${new Date(nbf * 1000).toISOString()}`,
    });
  }

  // typ
  const typ = (header.typ as string | undefined)?.toUpperCase();
  if (typ && typ !== "JWT") {
    findings.push({
      severity: "info",
      title: `Non-standard typ: ${typ}`,
      detail: "Servers expecting `typ: JWT` may reject this token.",
    });
  }

  // kid header injection hints
  if (typeof header.kid === "string" && (header.kid.includes("/") || header.kid.includes(".."))) {
    findings.push({
      severity: "high",
      title: "`kid` header contains path characters",
      detail:
        "If the server uses `kid` to look up a key file by name, this token may be probing for path-traversal (e.g. read /dev/null or a known file).",
    });
  }

  // jku/x5u — external key fetch
  if (header.jku || header.x5u) {
    findings.push({
      severity: "high",
      title: `External key URL header present (${header.jku ? "jku" : "x5u"})`,
      detail:
        "If unvalidated, this can be set to an attacker-controlled JWKS URL — the server fetches it and trusts the attacker's keys. Should be allowlisted.",
    });
  }

  // sub/iss/aud
  if (!payload.iss) {
    findings.push({
      severity: "low",
      title: "Missing `iss` claim",
      detail: "Multi-issuer environments rely on `iss` to route validation.",
    });
  }
  if (!payload.aud) {
    findings.push({
      severity: "low",
      title: "Missing `aud` claim",
      detail: "Without an audience, the token can be replayed against any service that shares the secret.",
    });
  }

  // role/admin claims (informational)
  for (const k of ["role", "roles", "admin", "is_admin", "scope", "scopes", "permissions"]) {
    if (payload[k] !== undefined) {
      findings.push({
        severity: "info",
        title: `Authorization claim found: \`${k}\``,
        detail: `Value: ${JSON.stringify(payload[k])}. If the server trusts this without re-checking against the DB, forgery via cracked secret = privilege escalation.`,
      });
      break;
    }
  }

  return findings;
}

function humanDelta(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}

const SEV_COLOR: Record<Finding["severity"], string> = {
  high: "text-red-400 border-red-400/40",
  med: "text-dsos-flame border-dsos-flame/40",
  low: "text-yellow-300/90 border-yellow-300/30",
  info: "text-dsos-ghost border-dsos-ghost/30",
};

export function SealBreaker() {
  const [token, setToken] = useState("");
  const [weakSecret, setWeakSecret] = useState<string | null>(null);
  const [cracking, setCracking] = useState(false);

  const parsed = useMemo(() => (token.trim() ? parseJwt(token) : null), [token]);

  const findings = useMemo(() => {
    if (!parsed || !parsed.ok) return [];
    return audit(parsed.jwt, weakSecret);
  }, [parsed, weakSecret]);

  const runCrack = async () => {
    if (!parsed || !parsed.ok) return;
    setCracking(true);
    setWeakSecret(null);
    const alg = (parsed.jwt.header.alg as string | undefined)?.toUpperCase() ?? "";
    const result = await tryWeakSecrets(token, alg);
    setWeakSecret(result);
    setCracking(false);
  };

  return (
    <div className="p-4 text-dsos-bone space-y-3 h-full flex flex-col overflow-auto">
      <div>
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">
          DSOS // SEAL BREAKER
        </div>
        <div className="text-xs text-dsos-bone/60 mt-0.5">
          Decode + audit JSON Web Tokens. Tries common-weak HMAC secrets.
          Authorized targets only — your own tokens, CTF tokens, bug-bounty scope.
        </div>
      </div>

      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Paste a JWT (eyJ...)"
        spellCheck={false}
        className="min-h-[80px] px-3 py-2 bg-dsos-night border border-dsos-ghost/30 focus:border-dsos-flame outline-none text-dsos-bone text-xs mono rounded resize-none break-all"
      />

      {parsed && !parsed.ok && (
        <div className="text-xs mono text-red-400 border border-red-400/40 rounded p-2">
          ⚠ {parsed.error}
        </div>
      )}

      {parsed && parsed.ok && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Panel title="HEADER">{JSON.stringify(parsed.jwt.header, null, 2)}</Panel>
            <Panel title="PAYLOAD">{JSON.stringify(parsed.jwt.payload, null, 2)}</Panel>
          </div>

          <div className="flex gap-2 items-center">
            <button
              onClick={runCrack}
              disabled={cracking}
              className="px-3 py-1.5 rounded bg-dsos-flame/20 border border-dsos-flame text-dsos-flame hover:bg-dsos-flame/30 disabled:opacity-50 mono text-[10px] tracking-widest"
            >
              {cracking ? "CRACKING..." : "TRY WEAK SECRETS"}
            </button>
            <span className="text-[10px] mono text-dsos-ghost/50">
              Runs 30 common HMAC secrets locally (no network).
            </span>
          </div>

          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">
              FINDINGS ({findings.length})
            </div>
            <div className="space-y-1.5">
              {findings.length === 0 && (
                <div className="text-xs text-dsos-ghost/50">No issues detected yet.</div>
              )}
              {findings.map((f, i) => (
                <div
                  key={i}
                  className={`border rounded p-2 text-xs ${SEV_COLOR[f.severity]}`}
                >
                  <div className="mono text-[10px] tracking-widest opacity-80 uppercase">
                    {f.severity}
                  </div>
                  <div className="font-semibold mt-0.5">{f.title}</div>
                  <div className="text-dsos-bone/80 mt-1 font-normal">{f.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dsos-night border border-dsos-ghost/30 rounded p-2">
      <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider mb-1">{title}</div>
      <pre className="text-[11px] mono text-dsos-bone whitespace-pre-wrap break-all">
        {children}
      </pre>
    </div>
  );
}
