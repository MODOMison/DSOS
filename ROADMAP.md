# DSOS Roadmap — 25 new tools to make it pay-worthy

Curated so each entry has a clear *why* (paid-tier value), an effort estimate,
and a tier placement. Themed names follow the existing devil-sunrise grammar.

Tier legend: 🆓 free · ⭐ Pro · 🏆 Pro+ (future team tier)

---

## 🔥 Cyber Tools (highest paid value)

1. **🆓 Cipher Cellar** — base64/hex/URL/rot13/morse/UTF-7 decoder with chained transforms and auto-detect.
   Effort: S · *Why pay:* every sec student needs this; gateway-drug app that hooks people. **(BUILDING NOW)**

2. **⭐ Seal Breaker** — JWT inspector: decode header/payload/sig, exp/nbf check, none-algo detection,
   weak HS256 secret dictionary attack (top-10k), claim-confusion warnings.
   Effort: M · *Why pay:* JWT auth bypass is bread-and-butter for bug-bounty. **(BUILDING NOW)**

3. **⭐ Sigil Reader** — drag-drop file → identifies real type from magic bytes regardless of extension.
   Detects packers (UPX, ASPack), embedded archives, polyglots.
   Effort: S · *Why pay:* "what is this file?" comes up constantly in CTFs/IR. **(BUILDING NOW)**

4. **⭐ Port Scribe** — careful TCP port scan (top 100 ports, rate-limited) with service banner grabs.
   Effort: M · *Why pay:* real recon move, not just headers. Authorized targets only.

5. **⭐ Mirror Maze** — CORS misconfiguration tester. Sends pre-flight + cross-origin requests with
   various Origin headers; flags wildcards-with-credentials, reflect-origin, null-origin trust.
   Effort: S · *Why pay:* very few free tools do this well.

6. **⭐ Crypt Sniffer** — deeper TLS analyzer beyond Inferno Recon: weak ciphers, HSTS+preload status,
   OCSP stapling, certificate transparency, downgrade-attack resistance.
   Effort: M · *Why pay:* compliance/audit work.

7. **⭐ Subdomain Sepulcher** — given a domain, finds subdomains AND checks each for takeover risk
   (dangling CNAME → S3/Heroku/GitHub Pages/etc. unclaimed). Uses existing crt.sh recon as input.
   Effort: M · *Why pay:* bug-bounty $$$ in subdomain takeovers.

8. **⭐ Wayback Crypt** — historic snapshots of a URL via Wayback Machine + Archive.is + Common Crawl.
   Surfaces removed pages, leaked secrets in old commits, deprecated API endpoints.
   Effort: S · *Why pay:* OSINT goldmine.

9. **⭐ Vault Probe** — API key validator. Paste a leaked-looking key (AWS, GCP, GH, Stripe sk_, Slack,
   DigitalOcean, etc.) — tells you provider, validity, and minimum scope without burning the key.
   Effort: M · *Why pay:* IR teams use this when triaging GitHub leaks.

10. **🆓 Rune Decoder** — hex-dump viewer with strings extraction, entropy graph, embedded-string search.
    Drag in a binary, see what's interesting.
    Effort: S · *Why pay:* gateway tool; pulls free users in.

11. **⭐ Bone Sifter** — PCAP analyzer. Upload .pcap, extracts HTTP requests, DNS queries, TLS SNIs,
    cleartext credentials, file transfers.
    Effort: L · *Why pay:* DFIR/CTF workflow; no free web tool does this.

12. **⭐ Ash Tracer** — visual traceroute + ASN + geo. Map view of hop locations.
    Effort: M · *Why pay:* presentation-grade output for reports.

---

## 🤖 AI-Powered Tools (Claude integration moat)

13. **⭐ Heretic Reviewer** — paste a code snippet (or upload a file), AI does a line-by-line security
    audit with annotations: SQLi/XSS/SSRF/path-traversal/auth-flaws, with severity + fix.
    Effort: M · *Why pay:* this alone is worth $19/mo for any developer.

14. **🏆 Brimstone Forge** — generate realistic phishing emails for *authorized* internal sec training.
    Hard "authorized targets only + scenario context required" framing. Outputs in multiple styles.
    Effort: M · *Why pay:* sec-awareness consultants charge $$$ for this; we tool-ify it.

15. **⭐ Inquisitor** — STRIDE/PASTA threat model from a system description. AI walks you through
    component-by-component asset, threat, mitigation table.
    Effort: M · *Why pay:* threat-modeling is half a day of senior IC time; AI shrinks it.

16. **⭐ Scribe of Ash** — pentest report writer. Paste raw findings (or pull them from DSOS scan
    history), get a client-ready Markdown report with exec summary, findings, evidence, remediation.
    Effort: M · *Why pay:* the gnarliest part of consulting work.

17. **🆓 Regex Reaper** — natural-language → regex builder powered by Claude. "Find AWS access keys in
    a log line" → `(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])` with explanation.
    Effort: S · *Why pay:* free, but burns through your AI quota and converts free→pro.

18. **⭐ Whisper Reader** — log analyzer. Paste server/auth logs, AI flags suspicious patterns,
    groups by attacker, generates IOCs.
    Effort: M · *Why pay:* SOC analyst superpower. **(BUILT)** — deterministic in-browser engine
    (Apache/Nginx access + sshd/auth parsing, per-source threat scoring, IOC export to txt/json)
    with an optional, graceful AI incident summary.

19. **🆓 CTF Shadows** — paste a CTF challenge description, AI gives progressively bigger hints
    (level 1 nudge → level 3 walkthrough) so people don't get full spoilers.
    Effort: S · *Why pay:* student stickiness; teaches scoping prompts.

20. **⭐ Policy Forge** — security policy generator (incident response, AUP, BCP, data retention).
    Industry/size-aware. Output in DOCX + MD.
    Effort: M · *Why pay:* small businesses pay $5k for policy templates from consultants.

---

## 🎮 Fun + Stickiness (theme + retention)

21. **🆓 Hellfire Challenges** — built-in CTF puzzles with the DSOS aesthetic. New daily challenge,
    weekly boss-level. Uses the tools the user already has access to.
    Effort: L · *Why pay:* free retention engine that funnels into Pro for the tools to solve them.

22. **🆓 Soul Score / Ranks** — gamification layer. XP per tool use, ranks (Initiate → Penitent →
    Inquisitor → Archfiend), achievement system. Subtle, not LinkedIn-cringe.
    Effort: M · *Why pay:* makes the product feel alive.

23. **⭐ Demon Familiar** — the existing VRM character system becomes a reactive desktop pet that
    idles, reacts to scan results ("oh that one's bad"), and gives tooltip hints. Optional.
    Effort: M · *Why pay:* differentiates from every other "security toolkit".

24. **🆓 DSOS Radio** — built-in lo-fi/dark-ambient stream embedded in the taskbar, "music to recon by."
    Curated playlists per workflow (recon = dark synth, reverse-engineering = drone, etc.).
    Effort: S · *Why pay:* sticky session lengths.

25. **🆓 Boot Sigil Customization** — pick your sunrise color, summon glyph, boot motto. Persisted
    per-account; small flex but every customizable UI converts better.
    Effort: S · *Why pay:* personalization → ownership → retention.

---

## Polish items (NOT new tools but high-leverage)

- **Phish scoring bug** — `support@paypa1.com` with urgency + bit.ly currently scores 18 / "looks-clean".
  Threshold + typosquat-detection weight need tuning.
- **Per-user settings** — model/backend choice is still global. Move to user record.
- **Scan-counter reset date** — show "150 / 150 scans · resets Jun 1" in Account window.
- **Password reset flow** — magic-link email; can't recover forgotten password today.
- **Email verification on signup** — currently anyone with any string-shaped email can sign up.
- **Per-tool empty/error states** — when a backend errors, surface a useful message in the window.

---

## Build priority (ranked by ROI per hour)

S-tier (build first):  1, 17, 2, 3, 10, 13
A-tier:                5, 9, 21, 22, 18, 19
B-tier:                7, 16, 4, 15, 20, 23
C-tier (later):        6, 8, 11, 12, 24, 25, 14

Built tonight: **1 (Cipher Cellar)**, **2 (Seal Breaker)**, **3 (Sigil Reader)**.
