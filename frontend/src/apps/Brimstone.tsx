import { useMemo, useState } from "react";
import zxcvbn from "zxcvbn";
import { api } from "../lib/api";

type Tab = "hash" | "password";

export function Brimstone() {
  const [tab, setTab] = useState<Tab>("hash");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 pt-2 flex gap-1 border-b border-dsos-flame/15">
        <TabBtn active={tab === "hash"} onClick={() => setTab("hash")}>
          Hash identifier
        </TabBtn>
        <TabBtn active={tab === "password"} onClick={() => setTab("password")}>
          Password strength + breach
        </TabBtn>
      </div>
      <div className="flex-1 overflow-y-auto dsos-scrollbar p-4">
        {tab === "hash" ? <HashTab /> : <PasswordTab />}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-t-md ${
        active
          ? "bg-dsos-flame/20 text-dsos-bone border-b-2 border-dsos-flame"
          : "text-dsos-ghost hover:text-dsos-bone hover:bg-dsos-flame/10"
      }`}
    >
      {children}
    </button>
  );
}

function HashTab() {
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<{ name: string; confidence: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!hash.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.hash.identify(hash.trim());
      setCandidates(r.candidates);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-dsos-ghost">
        Paste a hash. Brimstone runs format heuristics — useful for telling apart
        bcrypt vs MD5 vs JWT vs PHC strings.
      </div>
      <div className="flex gap-2">
        <input
          className="input-ember mono text-xs"
          placeholder="paste hash here"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button onClick={go} className="btn-ember whitespace-nowrap" disabled={loading}>
          Identify
        </button>
      </div>
      {err && <div className="text-dsos-flame text-xs">{err}</div>}
      {candidates && (
        <div className="glass rounded-md p-3">
          <div className="script text-lg text-dsos-glow mb-2">candidates</div>
          {candidates.length ? (
            <ul className="space-y-1">
              {candidates.map((c) => (
                <li key={c.name} className="text-sm flex justify-between">
                  <span className="text-dsos-bone">{c.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded mono ${
                      c.confidence === "high"
                        ? "bg-dsos-fire text-dsos-bone"
                        : c.confidence === "med"
                        ? "bg-dsos-sun text-dsos-void"
                        : "bg-dsos-ash text-dsos-bone"
                    }`}
                  >
                    {c.confidence}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-dsos-ghost text-xs">
              No obvious match. The string doesn&#39;t fit a common hash format.
            </div>
          )}
          <div className="text-[10px] text-dsos-ghost mt-2">
            Caveat: format alone can&#39;t distinguish similar hashes (e.g. MD5
            vs NTLM vs LM are all 32 hex). Use context (where you found it).
          </div>
        </div>
      )}
    </div>
  );
}

function PasswordTab() {
  const [pw, setPw] = useState("");
  const [reveal, setReveal] = useState(false);
  const [breach, setBreach] = useState<{ count: number; pwned: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const score = useMemo(() => (pw ? zxcvbn(pw) : null), [pw]);

  async function check() {
    if (!pw) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.breach.password(pw);
      setBreach(r);
    } catch (e) {
      setErr((e as Error).message);
      setBreach(null);
    } finally {
      setLoading(false);
    }
  }

  const scoreColors = ["bg-dsos-blood", "bg-dsos-fire", "bg-dsos-sun", "bg-dsos-glow", "bg-emerald-400"];
  const scoreLabels = ["very weak", "weak", "fair", "strong", "very strong"];

  return (
    <div className="space-y-3">
      <div className="text-xs text-dsos-ghost">
        Strength is computed locally with zxcvbn. Breach check uses HaveIBeenPwned&#39;s
        k-anonymity API — only the first 5 chars of the SHA-1 hash leave your machine.
      </div>

      <div className="flex gap-2">
        <input
          type={reveal ? "text" : "password"}
          className="input-ember mono text-xs"
          placeholder="enter a password to test"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setBreach(null);
          }}
        />
        <button
          onClick={() => setReveal((v) => !v)}
          className="btn-ghost whitespace-nowrap"
          title={reveal ? "hide" : "reveal"}
        >
          {reveal ? "hide" : "show"}
        </button>
        <button onClick={check} className="btn-ember whitespace-nowrap" disabled={loading || !pw}>
          {loading ? "checking..." : "Check breach"}
        </button>
      </div>

      {score && (
        <div className="glass rounded-md p-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-dsos-glow script text-lg">strength</span>
            <span className="text-dsos-bone">{scoreLabels[score.score]}</span>
          </div>
          <div className="h-1.5 bg-dsos-ash rounded-full overflow-hidden">
            <div
              className={`h-full ${scoreColors[score.score]} transition-all`}
              style={{ width: `${(score.score + 1) * 20}%` }}
            />
          </div>
          <div className="text-[11px] text-dsos-ghost space-y-0.5 mono">
            <div>guess time (slow hash, 1e4/sec): {String(score.crack_times_display.offline_slow_hashing_1e4_per_second)}</div>
            <div>guess time (online throttled): {String(score.crack_times_display.online_throttling_100_per_hour)}</div>
            {score.feedback.warning && (
              <div className="text-dsos-flame">⚠ {score.feedback.warning}</div>
            )}
            {score.feedback.suggestions.map((s: string, i: number) => (
              <div key={i}>💡 {s}</div>
            ))}
          </div>
        </div>
      )}

      {err && <div className="text-dsos-flame text-xs">{err}</div>}
      {breach && (
        <div
          className={`glass rounded-md p-3 border ${
            breach.pwned ? "border-dsos-fire" : "border-emerald-500/40"
          }`}
        >
          {breach.pwned ? (
            <div className="text-sm">
              <span className="text-dsos-flame font-semibold">⚠ pwned.</span>{" "}
              This password appears in known breach data{" "}
              <span className="mono">{breach.count.toLocaleString()}</span> times.
              Don&#39;t use it. Anywhere.
            </div>
          ) : (
            <div className="text-sm text-emerald-300">
              ✓ not found in the HIBP breach corpus. (That doesn&#39;t mean it&#39;s
              strong — just unbreached.)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
