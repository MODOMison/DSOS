# 🜨 DSOS — Devil's Sunrise Operating System

An AI + cybersecurity workbench dressed as a fake operating system. Boot screen,
draggable desktop windows, devil-sunrise aesthetic — every window is a real,
working tool.

> ⚠ **Authorized targets only.** Run these tools against systems you own or are
> explicitly authorized to test. Practice on lab targets:
> [PortSwigger Academy](https://portswigger.net/web-security),
> [HackTheBox](https://www.hackthebox.com/),
> [DVWA](https://github.com/digininja/DVWA).

---

## What's inside

- **Inferno Recon** — DNS records, HTTP headers + security-header audit + tech
  fingerprint, full TLS certificate inspection, subdomain enumeration via
  certificate transparency (crt.sh), WHOIS over the raw port-43 protocol.
- **CVE Oracle** — live NVD lookups by keyword or CVE-ID. CVSS score, vector,
  CWE, references.
- **Brimstone** — hash format identifier (MD5, SHA, bcrypt, Argon2, JWT, PHC
  strings…) + password strength meter (zxcvbn) + HaveIBeenPwned breach lookup
  (k-anonymity: only the first 5 hex chars of the SHA-1 ever leave your box).
- **Soulreader** — heuristic phishing analyzer: header mismatches, urgency
  language, typosquat domain detection, anchor href vs visible URL, SPF/DKIM
  hints.
- **Armory** — curated CTF payload library: XSS, SQLi, SSRF, LFI, command
  injection, XXE. Each payload comes with how it works **and** how to defend.
- **Hellfire Terminal** — text command line that wraps every other tool
  (`recon dns example.com`, `cve log4j`, `hash <str>`, `breach <pw>`).
- **Shadows** — AI sidebar that wakes up when you add an Anthropic API key. Off
  by default; the rest of DSOS works without it.

---

## Run it

You'll need Node.js 18+ (you have v22, you're good).

```sh
cd C:\Users\matto\dsos
npm run install:all     # installs root + frontend + backend deps
npm run dev             # starts backend (:4000) and frontend (:5173) together
```

Then open **http://localhost:5173** in your browser.

If `npm run dev` ever fails, you can run the two halves in separate terminals:

```sh
npm run dev:backend     # tab 1
npm run dev:frontend    # tab 2
```

---

## Built-in local LLM (Shadows without an API key)

Shadows defaults to a **built-in** backend that runs MythoMax-L2-13B
locally via `node-llama-cpp` — no Anthropic key, no Ollama, no internet
needed at chat time. The model file (~7.4 GB) is gitignored, so a fresh
clone has to pull it once:

**Windows (PowerShell):**
```powershell
pwsh backend\scripts\download-model.ps1
```

**macOS / Linux / Git Bash:**
```sh
bash backend/scripts/download-model.sh
```

The script downloads `mythomax-l2-13b.Q4_K_M.gguf` from
[TheBloke/MythoMax-L2-13B-GGUF](https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF)
into `backend/models/`. After it finishes, `npm run dev` and chat with
Shadows — the first message takes ~20-30s to load 7 GB of weights
into RAM, then replies stream normally.

> Inference runs in a child process (`backend/src/lib/builtinWorker.mjs`)
> spawned with plain `node`, NOT under `tsx`. The native addon import
> blocks the Node event loop under `tsx watch` on Windows, which would
> wedge the whole backend; the child-process boundary keeps the main
> server snappy even while the model is loading or generating.

**Don't want the built-in?** Flip `backend/settings.json` to
`"backend": "ollama"` (and run `ollama pull qwen2.5:7b`) or
`"backend": "anthropic"` and paste a key in the Account window.

---

## Accounts, tiers, and Shadows

DSOS now requires a (free) account on first run. On boot you'll see the sign-in
screen — create an account, you'll land on the desktop on the **Free** tier:

- Free: Inferno Recon + Brimstone hash tool, 150 scans/month, BYO Anthropic key required for Shadows.
- Pro ($19/mo): everything in Free + CVE Oracle + Soulreader phish analyzer + breach lookups, unlimited scans, 500k Shadows tokens/month included.

Open the **Account** window to manage your subscription or paste your own
Anthropic key. Open **Pricing** to upgrade.

### Bring your own Anthropic key

Cheapest way to use Shadows is to paste your own key in the Account window
(get one at [console.anthropic.com](https://console.anthropic.com)). It's stored
on your local DSOS server and never leaves it. Saved keys skip the Pro token
quota entirely.

### Setting up Stripe (one-time, for the developer running this)

Billing endpoints work the moment the env vars below are filled in. Until then
the rest of DSOS still runs — only the Upgrade / Manage Billing buttons error.

1. **Create a Stripe account** at [dashboard.stripe.com](https://dashboard.stripe.com)
   and stay in **test mode** (toggle in the top-right) for now.
2. **Create the Pro product:** Products → Add product → Name: `DSOS Pro`, set a
   recurring price (`$19 USD / month`). Copy the price ID (`price_...`) when you
   save — that's your `STRIPE_PRO_PRICE_ID`.
3. **Get your secret key:** Developers → API keys → reveal the **secret** test
   key (`sk_test_...`). That's `STRIPE_SECRET_KEY`.
4. **Set up the webhook:**
   - **Local dev:** install the [Stripe CLI](https://stripe.com/docs/stripe-cli),
     then run:
     ```sh
     stripe listen --forward-to localhost:4000/api/billing/webhook
     ```
     It prints a `whsec_...` — that's your `STRIPE_WEBHOOK_SECRET`. Keep
     `stripe listen` running while you test.
   - **Production:** Developers → Webhooks → Add endpoint pointing at
     `https://your-domain/api/billing/webhook`. Select events:
     `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`.
5. **Fill in `backend/.env`** (copy from `backend/.env.example`):
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   SESSION_SECRET=<48 random hex bytes — see comment in .env.example>
   APP_URL=http://localhost:5173
   ```
6. **Test the flow:** in the app open Pricing → Upgrade. Use Stripe test card
   `4242 4242 4242 4242`, any future expiry, any CVC. After checkout you bounce
   back to DSOS and your tier flips to Pro.
7. **(Optional) Platform Shadows key:** set `PLATFORM_ANTHROPIC_KEY=sk-ant-...`
   to power Pro users who don't BYO a key. Leave blank to require BYO.

**Optional but recommended:** also grab a free
[NVD API key](https://nvd.nist.gov/developers/request-an-api-key). Without one,
the CVE Oracle still works but NVD throttles you aggressively. Drop the key
into `backend/.env` as `NVD_API_KEY=...`.

---

## Project layout

```
dsos/
├── package.json              root scripts (install:all, dev)
├── .env.example              env template
├── frontend/                 Vite + React + TypeScript + Tailwind
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/       BootScreen, Desktop, Window, Taskbar...
│   │   ├── theme/            Logo (SVG), DesktopBackground
│   │   ├── store/            Zustand window manager
│   │   ├── apps/             InfernoRecon, CVEOracle, Brimstone, Soulreader,
│   │   │                     Armory, HellfireTerminal, ShadowsAI, About
│   │   └── lib/api.ts        backend client
└── backend/                  Express + TypeScript (tsx for dev)
    └── src/
        ├── index.ts
        └── routes/           recon, cve, hash, breach, phish, ai
```

---

## Tech & data sources

- **Frontend:** Vite 5, React 18, TypeScript, Tailwind CSS, Zustand, zxcvbn.
- **Backend:** Express 4, Node.js built-ins (`dns`, `tls`, `net`, `crypto`),
  Anthropic SDK (optional).
- **External APIs (no auth required):**
  - [crt.sh](https://crt.sh) — certificate transparency for subdomain enum
  - [NVD 2.0](https://services.nvd.nist.gov/rest/json/cves/2.0) — CVE database
  - [HaveIBeenPwned Pwned Passwords](https://api.pwnedpasswords.com) — breach
    lookup via k-anonymity (no email, no PII leaves your machine)
- **Optional:** Anthropic Claude (for the Shadows AI panel).

---

## Design language

- **Name:** DSOS — Devil's Sunrise Operating System.
- **Mark:** two crescent horns silhouetted against a sunrise.
- **Palette:** deep void black → blood red → fire orange → glow → bone white.
- **Wordmark:** script (Dancing Script).
- **Voice:** every app has a flame-themed name (Inferno, Brimstone,
  Hellfire…) and a clear "authorized targets only" framing.

---

## Roadmap

Ideas for later:
- Drag-and-drop file analyzer (entropy + signature detection)
- Live PCAP / log file analyzer
- Boot-screen customization (your name on the GRUB-style splash)
- Save recon results to local "case files"
- Dark/light theme toggle reflecting the two reference logos

---

Built as a portfolio piece. PRs to your own fork welcome.
