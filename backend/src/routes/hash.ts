import { Router } from "express";

export const hashRouter = Router();

// Lightweight format/regex-based hash identifier. Confidence is a sketch,
// not a guarantee — hash format alone can't distinguish e.g. MD5 vs LM.
const RULES: { name: string; pattern: RegExp; confidence: "high" | "med" | "low" }[] =
  [
    { name: "MD5", pattern: /^[a-f0-9]{32}$/i, confidence: "med" },
    { name: "NTLM", pattern: /^[a-f0-9]{32}$/i, confidence: "med" },
    { name: "LM", pattern: /^[a-f0-9]{32}$/i, confidence: "low" },
    { name: "SHA-1", pattern: /^[a-f0-9]{40}$/i, confidence: "med" },
    { name: "SHA-224", pattern: /^[a-f0-9]{56}$/i, confidence: "high" },
    { name: "SHA-256", pattern: /^[a-f0-9]{64}$/i, confidence: "med" },
    { name: "SHA-384", pattern: /^[a-f0-9]{96}$/i, confidence: "high" },
    { name: "SHA-512", pattern: /^[a-f0-9]{128}$/i, confidence: "med" },
    { name: "bcrypt", pattern: /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/, confidence: "high" },
    { name: "Argon2", pattern: /^\$argon2[id]{1,2}\$/, confidence: "high" },
    { name: "scrypt (PHC)", pattern: /^\$scrypt\$/, confidence: "high" },
    { name: "PBKDF2 (PHC)", pattern: /^\$pbkdf2-/, confidence: "high" },
    { name: "MD5 crypt", pattern: /^\$1\$/, confidence: "high" },
    { name: "SHA-256 crypt", pattern: /^\$5\$/, confidence: "high" },
    { name: "SHA-512 crypt", pattern: /^\$6\$/, confidence: "high" },
    { name: "MySQL5 SHA1", pattern: /^\*[A-F0-9]{40}$/i, confidence: "high" },
    { name: "CRC-32", pattern: /^[a-f0-9]{8}$/i, confidence: "low" },
    { name: "MySQL323", pattern: /^[a-f0-9]{16}$/i, confidence: "low" },
    {
      name: "JWT",
      pattern: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      confidence: "high",
    },
  ];

hashRouter.post("/identify", (req, res) => {
  const hash = String(req.body?.hash ?? "").trim();
  if (!hash) return res.status(400).json({ error: "hash is required" });
  const candidates = RULES.filter((r) => r.pattern.test(hash)).map((r) => ({
    name: r.name,
    confidence: r.confidence,
  }));
  res.json({ candidates });
});
