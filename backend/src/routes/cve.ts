import { Router } from "express";

export const cveRouter = Router();

interface NvdCve {
  cve: {
    id: string;
    descriptions: { lang: string; value: string }[];
    published: string;
    lastModified: string;
    references?: { url: string }[];
    metrics?: {
      cvssMetricV31?: {
        cvssData: { baseScore: number; baseSeverity: string; vectorString: string };
      }[];
      cvssMetricV30?: {
        cvssData: { baseScore: number; baseSeverity: string; vectorString: string };
      }[];
      cvssMetricV2?: {
        cvssData: { baseScore: number; vectorString: string };
        baseSeverity?: string;
      }[];
    };
    weaknesses?: { description: { value: string }[] }[];
  };
}

cveRouter.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "q is required" });

    const isCveId = /^CVE-\d{4}-\d+$/i.test(q);
    const base = "https://services.nvd.nist.gov/rest/json/cves/2.0";
    const params = isCveId
      ? `cveId=${encodeURIComponent(q.toUpperCase())}`
      : `keywordSearch=${encodeURIComponent(q)}&resultsPerPage=25`;

    const headers: Record<string, string> = {
      "User-Agent": "DSOS-CVE-Oracle/0.1",
    };
    if (process.env.NVD_API_KEY) headers["apiKey"] = process.env.NVD_API_KEY;

    const r = await fetch(`${base}?${params}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      return res.status(502).json({
        error: `NVD returned ${r.status}`,
        hint:
          "NVD aggressively rate-limits without an API key. Add NVD_API_KEY to backend/.env (free at nvd.nist.gov/developers).",
      });
    }
    const data = (await r.json()) as {
      vulnerabilities?: NvdCve[];
      totalResults?: number;
    };

    const results = (data.vulnerabilities ?? []).map((v) => {
      const cve = v.cve;
      const enDesc =
        cve.descriptions.find((d) => d.lang === "en")?.value ??
        cve.descriptions[0]?.value ??
        "";
      const m = cve.metrics ?? {};
      const cvss =
        m.cvssMetricV31?.[0]?.cvssData ??
        m.cvssMetricV30?.[0]?.cvssData ??
        m.cvssMetricV2?.[0]?.cvssData;
      const severity =
        m.cvssMetricV31?.[0]?.cvssData.baseSeverity ??
        m.cvssMetricV30?.[0]?.cvssData.baseSeverity ??
        m.cvssMetricV2?.[0]?.baseSeverity;
      const cwe = (cve.weaknesses ?? [])
        .flatMap((w) => w.description.map((d) => d.value))
        .filter((s) => s.startsWith("CWE-"));

      return {
        id: cve.id,
        description: enDesc,
        published: cve.published,
        lastModified: cve.lastModified,
        cvssScore: cvss?.baseScore,
        cvssSeverity: severity,
        cvssVector: cvss?.vectorString,
        references: (cve.references ?? []).map((r) => r.url).slice(0, 10),
        cwe,
      };
    });

    res.json({ results, totalResults: data.totalResults ?? results.length });
  } catch (e) {
    next(e);
  }
});
