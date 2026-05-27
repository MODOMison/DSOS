import { useState } from "react";
import { AuthorizedBanner } from "../components/AuthorizedBanner";
import {
  api,
  type ReconDnsResult,
  type ReconHeadersResult,
  type ReconSslResult,
} from "../lib/api";

type Tab = "headers" | "dns" | "ssl" | "subs" | "whois";

export function InfernoRecon() {
  const [target, setTarget] = useState("");
  const [tab, setTab] = useState<Tab>("headers");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [headers, setHeaders] = useState<ReconHeadersResult | null>(null);
  const [dns, setDns] = useState<ReconDnsResult | null>(null);
  const [ssl, setSsl] = useState<ReconSslResult | null>(null);
  const [subs, setSubs] = useState<string[] | null>(null);
  const [whois, setWhois] = useState<{ raw: string; parsed: Record<string, string> } | null>(null);

  async function run() {
    const t = target.trim();
    if (!t) return;
    setLoading(true);
    setErr(null);
    try {
      const domainOnly = t.replace(/^https?:\/\//, "").split("/")[0];
      if (tab === "headers") setHeaders(await api.recon.headers(t));
      else if (tab === "dns") setDns(await api.recon.dns(domainOnly));
      else if (tab === "ssl") setSsl(await api.recon.ssl(domainOnly));
      else if (tab === "subs") {
        const r = await api.recon.subdomains(domainOnly);
        setSubs(r.subdomains);
      } else if (tab === "whois") {
        const r = await api.recon.whois(domainOnly);
        setWhois(r);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "headers", label: "HTTP headers" },
    { id: "dns", label: "DNS" },
    { id: "ssl", label: "SSL / TLS" },
    { id: "subs", label: "Subdomains" },
    { id: "whois", label: "WHOIS" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <AuthorizedBanner />

      <div className="px-3 py-2 flex gap-2 items-center border-b border-dsos-flame/15">
        <input
          className="input-ember mono text-xs"
          placeholder="example.com  or  https://example.com/path"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button onClick={run} className="btn-ember whitespace-nowrap" disabled={loading}>
          {loading ? "scanning..." : "Scan"}
        </button>
      </div>

      <div className="px-3 pt-2 flex gap-1 border-b border-dsos-flame/15 overflow-x-auto dsos-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs rounded-t-md whitespace-nowrap ${
              tab === t.id
                ? "bg-dsos-flame/20 text-dsos-bone border-b-2 border-dsos-flame"
                : "text-dsos-ghost hover:text-dsos-bone hover:bg-dsos-flame/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto dsos-scrollbar p-3 mono text-[11.5px]">
        {err && (
          <div className="text-dsos-flame border border-dsos-flame/40 bg-dsos-blood/20 rounded p-2 mb-2">
            {err}
          </div>
        )}

        {tab === "headers" && headers && <HeadersView data={headers} />}
        {tab === "dns" && dns && <DnsView data={dns} />}
        {tab === "ssl" && ssl && <SslView data={ssl} />}
        {tab === "subs" && subs && <SubsView subs={subs} />}
        {tab === "whois" && whois && <WhoisView data={whois} />}

        {!headers && !dns && !ssl && !subs && !whois && !err && (
          <div className="text-dsos-ghost text-center mt-12">
            <div className="text-3xl mb-2">🜨</div>
            <div>enter a target above and pick a tab</div>
          </div>
        )}
      </div>
    </div>
  );
}

function HeadersView({ data }: { data: ReconHeadersResult }) {
  return (
    <div className="space-y-3">
      <div>
        <span className="text-dsos-glow">{data.status}</span>{" "}
        <span className="text-dsos-ghost">{data.statusText}</span>{" "}
        <span className="text-dsos-ghost">— {data.url}</span>
      </div>

      <Section title="Tech fingerprint">
        {data.tech.length ? (
          <div className="flex flex-wrap gap-1.5">
            {data.tech.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded bg-dsos-flame/20 border border-dsos-flame/40 text-dsos-bone"
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-dsos-ghost">no obvious fingerprints</div>
        )}
      </Section>

      <Section title="Security headers">
        <div className="space-y-1">
          {data.securityHeaders.map((h) => (
            <div
              key={h.name}
              className="flex items-center gap-2 border-l-2 pl-2"
              style={{
                borderColor: h.present ? "#ff8a2a" : "#7a1218",
              }}
            >
              <span
                className={
                  h.present ? "text-dsos-glow" : "text-dsos-blood"
                }
                style={{ minWidth: 18 }}
              >
                {h.present ? "✓" : "✗"}
              </span>
              <span className="text-dsos-bone">{h.name}</span>
              <span className="text-dsos-ghost text-[10px] ml-auto">{h.note}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="All response headers">
        <div className="space-y-0.5">
          {Object.entries(data.headers).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-dsos-glow whitespace-nowrap">{k}:</span>
              <span className="text-dsos-bone break-all">{v}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function DnsView({ data }: { data: ReconDnsResult }) {
  return (
    <div className="space-y-3">
      {data.records.map((r) => (
        <Section key={r.type} title={`${r.type} records`}>
          {r.error ? (
            <div className="text-dsos-ghost">— {r.error}</div>
          ) : r.values.length ? (
            r.values.map((v, i) => (
              <div key={i} className="text-dsos-bone break-all">{v}</div>
            ))
          ) : (
            <div className="text-dsos-ghost">none</div>
          )}
        </Section>
      ))}
    </div>
  );
}

function SslView({ data }: { data: ReconSslResult }) {
  const expired = data.daysRemaining < 0;
  return (
    <div className="space-y-3">
      <Section title="Validity">
        <div>From: {new Date(data.validFrom).toUTCString()}</div>
        <div>To:   {new Date(data.validTo).toUTCString()}</div>
        <div className={expired ? "text-dsos-flame" : "text-dsos-glow"}>
          {expired ? "EXPIRED" : `${data.daysRemaining} days remaining`}
        </div>
      </Section>
      <Section title="Subject">
        {Object.entries(data.subject).map(([k, v]) => (
          <div key={k}><span className="text-dsos-glow">{k}:</span> {String(v)}</div>
        ))}
      </Section>
      <Section title="Issuer">
        {Object.entries(data.issuer).map(([k, v]) => (
          <div key={k}><span className="text-dsos-glow">{k}:</span> {String(v)}</div>
        ))}
      </Section>
      <Section title="Subject Alt Names">
        <div className="flex flex-wrap gap-1.5">
          {data.subjectAltNames.map((s) => (
            <span key={s} className="px-2 py-0.5 rounded bg-dsos-flame/15 border border-dsos-flame/30">
              {s}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Connection">
        <div>Protocol: {data.protocol}</div>
        {data.cipher && (
          <div>Cipher: {data.cipher.name} ({data.cipher.version})</div>
        )}
        <div className="break-all">SHA-256 fingerprint: {data.fingerprint}</div>
        <div>Serial: {data.serialNumber}</div>
      </Section>
    </div>
  );
}

function SubsView({ subs }: { subs: string[] }) {
  return (
    <div>
      <div className="text-dsos-ghost mb-2">
        {subs.length} unique subdomain(s) found via certificate transparency (crt.sh)
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {subs.map((s) => (
          <div key={s} className="text-dsos-bone break-all">{s}</div>
        ))}
      </div>
    </div>
  );
}

function WhoisView({ data }: { data: { raw: string; parsed: Record<string, string> } }) {
  const importantKeys = [
    "registrar",
    "registrar whois server",
    "registrant name",
    "registrant organization",
    "creation date",
    "registry expiry date",
    "name server",
    "dnssec",
  ];
  return (
    <div className="space-y-3">
      <Section title="Parsed">
        {importantKeys
          .filter((k) => data.parsed[k])
          .map((k) => (
            <div key={k}>
              <span className="text-dsos-glow">{k}:</span> {data.parsed[k]}
            </div>
          ))}
      </Section>
      <Section title="Raw">
        <pre className="whitespace-pre-wrap text-dsos-ghost">{data.raw}</pre>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="script text-base text-dsos-glow text-glow mb-1">{title}</div>
      <div className="pl-2 border-l border-dsos-flame/25">{children}</div>
    </div>
  );
}
