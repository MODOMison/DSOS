import { Router } from "express";
import crypto from "node:crypto";

export const breachRouter = Router();

/**
 * Free, no-auth password breach check via the HaveIBeenPwned k-anonymity API.
 * Only the first 5 chars of the SHA-1 hash leave the server. HIBP returns the
 * suffixes of all matching hashes; we check ours locally.
 */
breachRouter.post("/password", async (req, res, next) => {
  try {
    const password = String(req.body?.password ?? "");
    if (!password) return res.status(400).json({ error: "password is required" });

    const sha1 = crypto
      .createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "DSOS-Brimstone/0.1", "Add-Padding": "true" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return res.status(502).json({ error: `HIBP returned ${r.status}` });
    }
    const text = await r.text();
    let count = 0;
    for (const line of text.split("\n")) {
      const [sfx, n] = line.trim().split(":");
      if (sfx === suffix) {
        count = Number(n);
        break;
      }
    }
    res.json({ count, pwned: count > 0 });
  } catch (e) {
    next(e);
  }
});
