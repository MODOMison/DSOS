import { Router } from "express";

export const phishRouter = Router();

type Severity = "info" | "low" | "med" | "high";
interface Signal {
  name: string;
  severity: Severity;
  detail: string;
}

const URGENCY_PATTERNS = [
  /urgent/i,
  /immediately/i,
  /within (24|48) hours/i,
  /action required/i,
  /verify your account/i,
  /suspended/i,
  /unauthorized/i,
  /your account will be/i,
  /click (the )?link below/i,
  /final notice/i,
];

const REWARD_PATTERNS = [
  /you('ve| have) won/i,
  /congratulations/i,
  /claim your (prize|reward|gift)/i,
  /free (iphone|gift|voucher|cash)/i,
  /lottery/i,
  /inheritance/i,
];

const ATTACHMENT_RED_FLAGS = [
  /\.exe(\?|"|$)/i,
  /\.scr(\?|"|$)/i,
  /\.js(\?|"|$)/i,
  /\.iso(\?|"|$)/i,
  /\.hta(\?|"|$)/i,
  /\.lnk(\?|"|$)/i,
  /\.docm(\?|"|$)/i,
  /\.xlsm(\?|"|$)/i,
];

const TYPOSQUAT_BRANDS = [
  "microsoft",
  "paypal",
  "amazon",
  "apple",
  "google",
  "facebook",
  "instagram",
  "netflix",
  "fedex",
  "ups",
  "dhl",
  "bankofamerica",
  "chase",
  "wellsfargo",
  "linkedin",
  "spotify",
  "dropbox",
  "github",
  "stripe",
  "coinbase",
  "binance",
  "discord",
  "steam",
];

const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at", "short.link", "tiny.cc",
  "rb.gy", "bl.ink", "tr.im", "shorte.st", "soo.gd",
]);

function checkTyposquat(dom: string, signals: Signal[], source: string) {
  const root = dom.split(".").slice(-2, -1)[0] ?? "";
  if (!root || root.length < 4) return;
  for (const brand of TYPOSQUAT_BRANDS) {
    if (root === brand) return; // legit match
    const d = levenshtein(root, brand);
    if (d > 0 && d <= 2) {
      signals.push({
        name: "Possible typosquat domain",
        severity: "high",
        detail: `${source} domain "${dom}" is ${d} character(s) from legit brand "${brand}". Classic phishing tactic (paypa1, micros0ft, amaz0n).`,
      });
      return;
    }
    // homograph / digit-letter swap: count chars that differ by class
    if (root.length === brand.length) {
      let diff = 0;
      for (let i = 0; i < root.length; i++) {
        const a = root[i];
        const b = brand[i];
        if (a !== b && ((a === "0" && b === "o") || (a === "1" && b === "l") || (a === "1" && b === "i") || (a === "5" && b === "s") || (a === "rn" && b === "m"))) {
          diff++;
        } else if (a !== b) {
          diff = 999;
          break;
        }
      }
      if (diff > 0 && diff < 999) {
        signals.push({
          name: "Homograph attack",
          severity: "high",
          detail: `${source} domain "${dom}" substitutes digits for letters in "${brand}".`,
        });
        return;
      }
    }
  }
}

function severityScore(s: Severity): number {
  return s === "high" ? 30 : s === "med" ? 18 : s === "low" ? 8 : 0;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

phishRouter.post("/analyze", (req, res) => {
  const email = String(req.body?.email ?? "");
  if (!email) return res.status(400).json({ error: "email is required" });

  const signals: Signal[] = [];

  // headers
  const fromMatch = email.match(/^from:\s*(.+)$/im);
  const fromHeader = fromMatch?.[1]?.trim();
  const replyTo = email.match(/^reply-to:\s*(.+)$/im)?.[1]?.trim();

  if (fromHeader && replyTo) {
    const fromDom = fromHeader.match(/@([^\s>]+)/)?.[1]?.toLowerCase();
    const replyDom = replyTo.match(/@([^\s>]+)/)?.[1]?.toLowerCase();
    if (fromDom && replyDom && fromDom !== replyDom) {
      signals.push({
        name: "Reply-To mismatch",
        severity: "high",
        detail: `From points at ${fromDom} but Reply-To redirects to ${replyDom}.`,
      });
    }
  }

  // SPF/DKIM/DMARC hints
  const authResults = email.match(/^authentication-results:.*$/im)?.[0] ?? "";
  if (/spf=fail|dkim=fail|dmarc=fail/i.test(authResults)) {
    signals.push({
      name: "Email authentication failed",
      severity: "high",
      detail: `Header shows SPF/DKIM/DMARC failure: ${authResults.slice(0, 200)}`,
    });
  } else if (/spf=none|dkim=none/i.test(authResults)) {
    signals.push({
      name: "Weak email authentication",
      severity: "med",
      detail: "Domain has no SPF or DKIM record — easier to spoof.",
    });
  }

  // language
  const urgencyHits = URGENCY_PATTERNS.filter((p) => p.test(email));
  if (urgencyHits.length) {
    signals.push({
      name: "Urgency / pressure language",
      severity: urgencyHits.length > 2 ? "high" : "med",
      detail: `Matched ${urgencyHits.length} urgency patterns (e.g. ${urgencyHits[0].source}).`,
    });
  }
  const rewardHits = REWARD_PATTERNS.filter((p) => p.test(email));
  if (rewardHits.length) {
    signals.push({
      name: "Reward / prize bait",
      severity: "med",
      detail: `${rewardHits.length} 'you won / claim your prize' phrase(s) detected.`,
    });
  }

  // links
  const linkRe = /https?:\/\/[^\s"'<>)]+/gi;
  const links = email.match(linkRe) ?? [];
  const linkDomains = new Set<string>();
  for (const link of links) {
    try {
      linkDomains.add(new URL(link).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  if (links.length > 12) {
    signals.push({
      name: "Many links",
      severity: "low",
      detail: `Body contains ${links.length} links — phish often spray-and-pray.`,
    });
  }

  // anchor text mismatch
  const anchorRe =
    /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(email)) !== null) {
    const href = m[1];
    const text = m[2];
    if (/^https?:\/\//.test(text)) {
      try {
        const hrefHost = new URL(href).hostname.toLowerCase();
        const textHost = new URL(text).hostname.toLowerCase();
        if (hrefHost !== textHost) {
          signals.push({
            name: "Anchor href ≠ visible URL",
            severity: "high",
            detail: `Link shows "${textHost}" but actually points to "${hrefHost}".`,
          });
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  // typosquat — check From-header domain AND every link domain
  const fromDomain = fromHeader?.match(/@([^\s>]+)/)?.[1]?.toLowerCase();
  if (fromDomain) checkTyposquat(fromDomain, signals, "Sender");
  for (const dom of linkDomains) {
    checkTyposquat(dom, signals, "Link");
  }

  // URL shorteners — hide the real destination, classic phish move
  const shortenerHits = [...linkDomains].filter((d) => URL_SHORTENERS.has(d));
  if (shortenerHits.length) {
    signals.push({
      name: "URL shortener used",
      severity: "med",
      detail: `${shortenerHits.length} link(s) use shorteners (${shortenerHits.join(", ")}) which hide the real destination. Legit corporate emails rarely use these.`,
    });
  }

  // Generic sender on a freemail or no-name domain claiming to be a brand
  if (fromDomain) {
    const senderLocalPart = fromHeader?.split("@")[0]?.replace(/^.*\b/, "").toLowerCase() ?? "";
    const generic = ["support", "noreply", "no-reply", "service", "security", "admin", "billing", "account"];
    const looksGeneric = generic.some((g) => senderLocalPart.includes(g));
    const freeMail = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "proton.me", "protonmail.com"];
    if (looksGeneric && freeMail.includes(fromDomain)) {
      signals.push({
        name: "Generic role address on freemail",
        severity: "high",
        detail: `Real "${senderLocalPart}@" addresses come from corporate domains, not ${fromDomain}.`,
      });
    }
  }

  // attachments
  for (const re of ATTACHMENT_RED_FLAGS) {
    if (re.test(email)) {
      signals.push({
        name: "Suspicious attachment hint",
        severity: "med",
        detail: `Body references a risky file extension: ${re.source}.`,
      });
      break;
    }
  }

  if (signals.length === 0) {
    signals.push({
      name: "No obvious phishing signals",
      severity: "info",
      detail:
        "Nothing tripped the heuristic checks. Stay skeptical anyway — confirm with the sender out-of-band before acting.",
    });
  }

  const score = signals.reduce((acc, s) => acc + severityScore(s.severity), 0);
  const verdict: "likely-phish" | "suspicious" | "looks-clean" =
    score >= 50 ? "likely-phish" : score >= 20 ? "suspicious" : "looks-clean";

  res.json({
    verdict,
    score,
    signals,
    extractedLinks: [...new Set(links)].slice(0, 25),
    fromHeader,
  });
});
