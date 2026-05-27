import { useState } from "react";
import { api, type PhishResult } from "../lib/api";

const sampleEmail = `From: "Microsoft Security" <security@micros0ft-support.com>
Reply-To: support@helpdesk-microsoft.ru
Subject: URGENT: Your account will be suspended within 24 hours

Authentication-Results: spf=fail smtp.mailfrom=micros0ft-support.com; dkim=none

Dear Customer,

We detected unauthorized activity on your Microsoft account. Action required immediately to avoid suspension.

Please verify your account by clicking the link below:

<a href="http://micros0ft-support.com/verify">https://login.microsoft.com/verify</a>

Failure to act within 24 hours will result in permanent account closure.

Sincerely,
Microsoft Security Team`;

export function Soulreader() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<PhishResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function analyze() {
    if (!email.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.phish.analyze(email);
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const verdictColor = (v?: string) =>
    v === "likely-phish"
      ? "text-dsos-flame border-dsos-fire bg-dsos-blood/20"
      : v === "suspicious"
      ? "text-dsos-sun border-dsos-sun/50 bg-dsos-sun/10"
      : "text-emerald-300 border-emerald-500/40 bg-emerald-900/20";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto dsos-scrollbar p-3 space-y-3">
        <div className="text-xs text-dsos-ghost">
          Paste a raw email (including headers if you have them). Soulreader
          runs heuristic phishing checks: header mismatches, urgency language,
          typosquat domains, anchor href vs. visible text, weak email auth.
        </div>

        <textarea
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          rows={10}
          placeholder="paste raw email here..."
          className="input-ember mono text-[11px] font-mono"
          style={{ resize: "vertical" }}
        />
        <div className="flex gap-2 flex-wrap">
          <button onClick={analyze} className="btn-ember" disabled={loading || !email.trim()}>
            {loading ? "reading souls..." : "Analyze"}
          </button>
          <button onClick={() => setEmail(sampleEmail)} className="btn-ghost">
            load sample (typosquat phish)
          </button>
          <button onClick={() => { setEmail(""); setResult(null); }} className="btn-ghost">
            clear
          </button>
        </div>

        {err && (
          <div className="text-dsos-flame border border-dsos-flame/40 bg-dsos-blood/20 rounded p-2 text-xs">
            {err}
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div
              className={`rounded-md border p-3 ${verdictColor(result.verdict)}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="script text-xl">
                  verdict: {result.verdict.replace("-", " ")}
                </span>
                <span className="mono text-xs">score {result.score}</span>
              </div>
              {result.fromHeader && (
                <div className="text-[11px] mt-1 mono opacity-80">
                  From: {result.fromHeader}
                </div>
              )}
            </div>

            <div className="glass rounded-md p-3">
              <div className="script text-lg text-dsos-glow mb-2">signals</div>
              <ul className="space-y-1.5">
                {result.signals.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span
                      className={`mono text-[10px] px-1.5 rounded shrink-0 ${
                        s.severity === "high"
                          ? "bg-dsos-fire text-dsos-bone"
                          : s.severity === "med"
                          ? "bg-dsos-sun text-dsos-void"
                          : s.severity === "low"
                          ? "bg-dsos-glow text-dsos-void"
                          : "bg-dsos-ash text-dsos-bone"
                      }`}
                    >
                      {s.severity}
                    </span>
                    <span>
                      <span className="text-dsos-bone font-semibold">{s.name}.</span>{" "}
                      <span className="text-dsos-ghost">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {result.extractedLinks.length > 0 && (
              <div className="glass rounded-md p-3">
                <div className="script text-lg text-dsos-glow mb-2">links found</div>
                <ul className="text-[11px] space-y-0.5 mono">
                  {result.extractedLinks.map((l, i) => (
                    <li key={i} className="text-dsos-bone break-all">{l}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
