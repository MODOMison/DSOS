import { useState } from "react";
import { api, type CveResult } from "../lib/api";

const severityColor = (sev?: string): string => {
  switch ((sev ?? "").toUpperCase()) {
    case "CRITICAL": return "bg-dsos-blood text-dsos-bone";
    case "HIGH": return "bg-dsos-fire text-dsos-bone";
    case "MEDIUM": return "bg-dsos-sun text-dsos-void";
    case "LOW": return "bg-dsos-glow text-dsos-void";
    default: return "bg-dsos-ash text-dsos-bone";
  }
};

export function CVEOracle() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<CveResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.cve.search(q.trim());
      setResults(r.results);
      setTotal(r.totalResults);
    } catch (e) {
      setErr((e as Error).message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 flex gap-2 items-center border-b border-dsos-flame/15">
        <input
          className="input-ember mono text-xs"
          placeholder='keyword (e.g. "log4j") or CVE id (e.g. CVE-2021-44228)'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button onClick={search} className="btn-ember whitespace-nowrap" disabled={loading}>
          {loading ? "consulting..." : "Consult"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto dsos-scrollbar p-3 text-[12px]">
        {err && (
          <div className="text-dsos-flame border border-dsos-flame/40 bg-dsos-blood/20 rounded p-2 mb-2">
            {err}
          </div>
        )}

        {!results && !err && (
          <div className="text-dsos-ghost text-center mt-12">
            <div className="text-3xl mb-2">☠</div>
            <div>The CVE Oracle reads from NVD (nvd.nist.gov).</div>
            <div className="mt-2 text-[11px]">
              Examples: <span className="mono text-dsos-glow">log4j</span>
              {" · "}
              <span className="mono text-dsos-glow">openssl heartbleed</span>
              {" · "}
              <span className="mono text-dsos-glow">CVE-2021-44228</span>
            </div>
          </div>
        )}

        {results && (
          <>
            <div className="text-dsos-ghost text-[11px] mb-2">
              showing {results.length} of {total} result(s)
            </div>
            <div className="space-y-2">
              {results.map((c) => (
                <div
                  key={c.id}
                  className="glass rounded-md p-3 border border-dsos-flame/15"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="script text-lg text-dsos-glow text-glow">{c.id}</span>
                    {c.cvssScore != null && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded mono ${severityColor(c.cvssSeverity)}`}>
                        {c.cvssScore.toFixed(1)} {c.cvssSeverity ?? ""}
                      </span>
                    )}
                    <span className="text-[10px] text-dsos-ghost ml-auto">
                      {new Date(c.published).toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <div
                    className={`text-dsos-bone text-[12px] ${
                      expanded === c.id ? "" : "line-clamp-3"
                    }`}
                  >
                    {c.description}
                  </div>
                  <button
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    className="text-[10px] text-dsos-glow hover:text-dsos-sun mt-1"
                  >
                    {expanded === c.id ? "less" : "more"}
                  </button>

                  {expanded === c.id && (
                    <div className="mt-2 space-y-1 text-[11px]">
                      {c.cvssVector && (
                        <div className="mono">
                          <span className="text-dsos-glow">vector:</span> {c.cvssVector}
                        </div>
                      )}
                      {c.cwe && c.cwe.length > 0 && (
                        <div>
                          <span className="text-dsos-glow">weaknesses:</span> {c.cwe.join(", ")}
                        </div>
                      )}
                      {c.references.length > 0 && (
                        <div>
                          <div className="text-dsos-glow">references:</div>
                          <ul className="ml-3 list-disc">
                            {c.references.map((r) => (
                              <li key={r} className="break-all">
                                <a
                                  href={r}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-dsos-bone hover:text-dsos-sun underline"
                                >
                                  {r}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
