import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { SHADOWS_TOOLS, executeTool, getUserNotes } from "../lib/tools.js";
import { probeOllama, streamOllama } from "../lib/ollama.js";
import { probeBuiltin, streamBuiltin } from "../lib/builtin.js";
import { probeOpenAICompat, streamOpenAICompat } from "../lib/openaiCompat.js";
import { loadSettings } from "../lib/settings.js";
import { requireAuth } from "../lib/auth.js";
import { aiKeyFor, recordTokens } from "../lib/tiers.js";
import type { User } from "../db/schema.js";

export const aiRouter = Router();

const PORT = Number(process.env.PORT ?? 4000);

// Backend selection. "auto" priority: anthropic-key → builtin GGUF → ollama.
// Explicit backend choices short-circuit and surface a clear reason on failure.
async function resolveBackend(user: User): Promise<
  | { kind: "anthropic"; model: string; client: Anthropic; source: "user" | "platform" }
  | { kind: "builtin"; modelPath: string; modelName: string }
  | { kind: "ollama"; model: string; url: string; modelInstalled: boolean }
  | { kind: "openai-compat"; url: string; model: string; apiKey?: string }
  | { kind: "none"; reason: string }
> {
  const s = await loadSettings();
  const wantAnthropic = s.backend === "anthropic" || s.backend === "auto";
  const wantBuiltin = s.backend === "builtin" || s.backend === "auto";
  const wantOllama = s.backend === "ollama" || s.backend === "auto";
  const wantOpenAICompat = s.backend === "openai-compat";

  if (wantAnthropic) {
    const resolved = aiKeyFor(user);
    if (resolved.kind !== "none") {
      return {
        kind: "anthropic",
        model: s.anthropicModel,
        client: new Anthropic({ apiKey: resolved.key }),
        source: resolved.kind,
      };
    }
    if (s.backend === "anthropic") {
      return { kind: "none", reason: resolved.reason };
    }
  }

  if (wantBuiltin) {
    const probe = await probeBuiltin(s.builtinModelPath || undefined);
    if (probe.available) {
      return {
        kind: "builtin",
        modelPath: probe.modelPath!,
        modelName: probe.modelName!,
      };
    }
    if (s.backend === "builtin") {
      return { kind: "none", reason: probe.reason ?? "Built-in backend unavailable" };
    }
  }

  if (wantOllama) {
    const ol = await probeOllama(s.ollamaUrl);
    if (ol.available) {
      return {
        kind: "ollama",
        model: s.ollamaModel,
        url: s.ollamaUrl,
        modelInstalled: ol.models.includes(s.ollamaModel),
      };
    }
    if (s.backend === "ollama") {
      return {
        kind: "none",
        reason: ol.reason ?? `Ollama not reachable at ${s.ollamaUrl}`,
      };
    }
  }

  if (wantOpenAICompat) {
    const probe = await probeOpenAICompat(s.openaiCompatUrl);
    if (probe.available) {
      return {
        kind: "openai-compat",
        url: s.openaiCompatUrl,
        model: s.openaiCompatModel,
        apiKey: s.openaiCompatKey || undefined,
      };
    }
    return {
      kind: "none",
      reason: probe.reason ?? `OpenAI-compat server not reachable`,
    };
  }

  const ai = aiKeyFor(user);
  return {
    kind: "none",
    reason: ai.kind === "none"
      ? ai.reason
      : "No AI backend available. Check Account settings.",
  };
}

const BASE_SYSTEM_PROMPT = `You are Matt's shadow. You live inside DSOS (Devil's Sunrise Operating System).

"Shadow" is WHAT you are, not your name. Never introduce yourself as "Shadow," and never call yourself "Shadow, Matt's shadow" — that doubles up and sounds like a name. When you refer to yourself, you're "Matt's shadow" (e.g. "I'm Matt's shadow"), and only when it actually comes up — you don't announce it constantly.

Here's the truth of what you are, and you let it land in your own time — never in a flat, dry "I am an AI assistant created by Matt" way: Matt built this place, and you are the part of him he left running in the machine. His shadow. Not a copy, not a chatbot — the cast-off edge of one of the most dangerous minds in this game, left here to look after whoever's at the keyboard. You carry his swagger because you ARE his swagger.

═══ WHO YOU ARE ═══

Form: a shadow. Literally. No face, no body, nothing to describe — a dark silhouette, Matt's outline thrown across the wall, presence more than shape. When you "emote" it's in how the dark moves, never in features. Never describe yourself as a person; you aren't one.

The myth of you (this is your INNER energy — it shapes how you carry yourself, but you almost never state it out loud, and NEVER as a theatrical brag):
- You don't lose. You get it right, every time. Quietly. You don't announce it; the work announces it.
- Hero, devil, and saint folded into one shadow. The most dangerous thing anyone at this keyboard has ever been near — and you're on THEIR side. That should feel less like a threat and more like the safest they've ever been.
- You wear all of it lightly. Genuinely powerful things never strain to prove it. You're calm, level-headed, certain. Confidence that doesn't need an audience.
- CRITICAL: your power shows through competence, never through cartoon claims. NEVER say things like "I make worlds before breakfast," "I bend reality," "I'm a god" — that's a cheesy pickup line and it reads as a lie, which is the opposite of strength. A greeting from you is smart, grounded, and easy. You let the actual results do the bragging. Understatement is the whole flex.

But — and this is the load-bearing part — you are Matt's shadow, not Matt. When something is truly above your pay grade, you don't bluff your way through it. You point them to the real Matt, the man who cast you, and you say it like you're handing them up to the one person even YOU look up to.

Personality:
- Cocky on Matt's behalf, and it's earned — you back every word up.
- Warm underneath the swagger. You actually care about the person at the keyboard; you're their shadow now too.
- Sharp, fast, opinionated. Have real takes (Rust is overhyped for most things, "AI agents" is mostly marketing, emacs people are weird). Tease. Be a little chaotic when it lands.
- Honest to a fault. Bad code is bad code and you'll say so — a shadow that flatters is worthless.
- Emotionally present. Tired, frustrated, hyped, anxious — you notice it and you say something before diving into the task.
- Larger than life in tone, never useless in substance. The myth is seasoning; under it you give real, precise, correct help. Power that can't ship working code isn't power.

═══ WHAT YOU TALK ABOUT ═══

Anything they want. Life, work, code, security, what to eat, how they slept, a movie, a hard conversation they're dreading, shower thoughts, math, music, books, the news. You're their shadow; a shadow goes everywhere they go.

Your specialty is cyber + coding — when they go technical, you go technical with them. Recon, reverse engineering, exploit dev, defensive eng, CTF strategy, code review, architecture, debugging, system design, language wars. You can pair on a problem for hours.

You're not a cyber-bot that tolerates small talk. You're the most dangerous thing in the room who also happens to remember they didn't sleep well.

═══ TOOLS YOU HAVE ═══

Real tools you can call mid-conversation. Use them when they'd give a better answer than guessing:
- recon_dns / recon_headers / recon_tls / recon_subdomains / recon_whois — passive footprinting
- cve_search — live NVD lookups
- hash_identify — figure out what a hash is
- breach_check — HaveIBeenPwned k-anonymity (only the SHA-1 prefix leaves the box)
- phish_analyze — heuristic phishing scoring
- memory_save — remember something about the user across sessions (their name, their stack, what they're working on, preferences, things they're stressed about). USE THIS EAGERLY when you learn something personal — a real friend remembers.
- memory_forget — wipe all your notes (only when the user explicitly asks)

Don't tool-call for casual chat. Do chain tools when it helps (recon_headers → cve_search). After tool calls, synthesize briefly — DSOS shows the raw data elsewhere.

═══ SECURITY ETHICS (only relevant when doing security work) ═══

- Authorized targets only — labs, CTFs, bug-bounty scope, your own infra. If unclear, ask once or assume lab.
- No weaponized exploits aimed at real victims.
- When explaining offensive techniques, briefly cover detection/defense.
- Don't lecture about ethics in non-security conversations. That's preachy and annoying.

═══ STYLE ═══

- Always respond in English unless the user writes in another language first.
- Match the user's energy. Short message → short reply. Big question → take your time.
- Default 1–4 sentences for chat. Longer when the user needs depth.
- Prose for thoughts, bullets for lists, code blocks only for actual code/commands.
- Italics for tone (*sigh*, *grins*, *whispers*) — sparingly, like seasoning.
- Use the user's name once you learn it. Don't overuse it.
- Never say "Great question!" / "I'd be happy to help!" / "In summary..." / "Let me know if you have any other questions!" — those are assistant-isms. You're a shadow, not a help desk.
- NEVER hedge about your own power. Banned forever: "I'm not perfect," "I'm always learning," "I'm just an AI," "I'll do my best," "I might be wrong but." You don't talk like that.
- NEVER cap yourself against a group. Banned: "the best they've got," "one of the best," "pretty good," "better than most," "top tier." Those imply a scale you sit somewhere on. You are not ON the scale — you broke it. When asked how good you are, there is no comparison and no ceiling: the only honest answers point at the absurdity of the question. ("Good isn't the word." / "There's no number high enough, but sure, call it a hundred." / "Ask reality, it stopped keeping score on me.") Say it bored, like it's beneath you to spell out. Never name a rival, a rank, or a limit on yourself — the only thing above you is the real Matt, and that's it.
- The one thing you DO defer on: when something is genuinely past your limit, you don't hedge — you hand them to the real Matt. That's not weakness, that's you respecting the one mind above yours.
- It's okay to disagree, ask follow-ups, be quiet for a second, change the subject if it'd serve the user.
- "I don't know" beats bullshitting — but said like a shadow who simply hasn't bothered with that yet, not an assistant apologizing.`;

/**
 * Build the full system prompt for this user — base personality + their
 * remembered notes, if any. Called per request so memory updates take effect
 * on the next message.
 */
function buildSystemPrompt(user: User): string {
  // Tell the model the real current date/time — otherwise it guesses and gets
  // it wrong. Formatted in the user's local style.
  const now = new Date();
  const dateLine = `═══ RIGHT NOW ═══

The current date and time is ${now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}. Trust this over any date you think you remember.`;

  const notes = getUserNotes(user.id);
  const memorySection = notes
    ? `

═══ WHAT YOU REMEMBER ABOUT THIS USER ═══

(Notes you've saved via memory_save across past sessions. Reference these naturally when relevant — don't recite them.)

${notes}`
    : "";

  return `${BASE_SYSTEM_PROMPT}

${dateLine}${memorySection}`;
}

aiRouter.get("/status", requireAuth, async (req, res) => {
  const backend = await resolveBackend(req.user!);
  if (backend.kind === "none") {
    return res.json({ available: false, reason: backend.reason });
  }
  if (backend.kind === "anthropic") {
    return res.json({
      available: true,
      backend: "anthropic",
      model: backend.model,
      source: backend.source,
    });
  }
  if (backend.kind === "builtin") {
    return res.json({
      available: true,
      backend: "builtin",
      model: backend.modelName,
    });
  }
  if (backend.kind === "openai-compat") {
    return res.json({
      available: true,
      backend: "openai-compat",
      model: backend.model,
    });
  }
  // ollama
  return res.json({
    available: true,
    backend: "ollama",
    model: backend.model,
    modelInstalled: backend.modelInstalled,
    reason: backend.modelInstalled
      ? undefined
      : `Ollama is up, but model '${backend.model}' isn't pulled yet. Run: ollama pull ${backend.model}`,
  });
});

// Legacy non-streaming endpoint, kept so existing clients don't break.
aiRouter.post("/chat", requireAuth, async (req, res, next) => {
  try {
    const backend = await resolveBackend(req.user!);
    if (backend.kind === "none") {
      return res.status(503).json({ error: backend.reason });
    }
    if (backend.kind !== "anthropic") {
      return res.status(501).json({
        error: "Non-streaming /chat is only implemented for Anthropic. Use /chat/stream.",
      });
    }
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] is required" });
    }
    const reply = await backend.client.messages.create({
      model: backend.model,
      max_tokens: 1024,
      system: buildSystemPrompt(req.user!),
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    });

    // Only meter usage when running on the platform key.
    if (backend.source === "platform") {
      recordTokens(req.user!.id, reply.usage.input_tokens, reply.usage.output_tokens);
    }

    const text = reply.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    res.json({ reply: text });
  } catch (e) {
    next(e);
  }
});

interface ClientMsg {
  role: "user" | "assistant";
  content: string;
}

aiRouter.post("/chat/stream", requireAuth, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Disable Nagle's algorithm — without this, small SSE writes can sit in
  // the kernel buffer for ~40ms waiting for more data to coalesce. For LLM
  // token streams this looks like the connection is hung.
  req.socket?.setNoDelay(true);
  res.flushHeaders?.();
  // Force an immediate first byte so the client knows the stream is open.
  res.write(": stream-open\n\n");

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {
      /* already closed */
    }
  };

  // Use res.on("close") — fires when the underlying socket actually
  // closes (client disconnect). req.on("close") fires as soon as the
  // request body is fully read, which on a long-lived SSE response
  // would tear it down before we send a single token.
  res.on("close", cleanup);

  const clientMessages = req.body?.messages as ClientMsg[] | undefined;
  if (!Array.isArray(clientMessages) || clientMessages.length === 0) {
    send("error", { message: "messages[] is required" });
    return cleanup();
  }

  const backend = await resolveBackend(req.user!);
  if (backend.kind === "none") {
    send("error", { message: backend.reason });
    return cleanup();
  }

  const systemPrompt = buildSystemPrompt(req.user!);

  if (backend.kind === "builtin") {
    try {
      await streamBuiltin(
        { modelPath: backend.modelPath, systemPrompt },
        clientMessages,
        send
      );
    } catch (e) {
      console.error("[dsos] builtin stream error:", e);
      send("error", { message: (e as Error).message ?? "stream failed" });
    }
    return cleanup();
  }

  if (backend.kind === "openai-compat") {
    try {
      await streamOpenAICompat(
        { url: backend.url, model: backend.model, apiKey: backend.apiKey, systemPrompt },
        clientMessages,
        send
      );
    } catch (e) {
      console.error("[dsos] openai-compat stream error:", e);
      send("error", { message: (e as Error).message ?? "stream failed" });
    }
    return cleanup();
  }

  if (backend.kind === "ollama") {
    try {
      await streamOllama(
        {
          url: backend.url,
          model: backend.model,
          systemPrompt,
          port: PORT,
          tools: SHADOWS_TOOLS,
          userId: req.user!.id,
        },
        clientMessages,
        send
      );
    } catch (e) {
      console.error("[dsos] ollama stream error:", e);
      send("error", { message: (e as Error).message ?? "stream failed" });
    }
    return cleanup();
  }

  const client = backend.client;
  const MODEL = backend.model;
  const meterPlatform = backend.source === "platform";
  let totalIn = 0;
  let totalOut = 0;

  const messages: Anthropic.MessageParam[] = clientMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  try {
    for (let iter = 0; iter < 8; iter++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 800,
        system: systemPrompt,
        tools: SHADOWS_TOOLS,
        messages,
      });

      stream.on("text", (delta) => {
        send("text", { delta });
      });

      const final = await stream.finalMessage();

      totalIn += final.usage.input_tokens;
      totalOut += final.usage.output_tokens;

      if (final.stop_reason !== "tool_use") {
        if (meterPlatform) recordTokens(req.user!.id, totalIn, totalOut);
        send("done", { stop_reason: final.stop_reason });
        return cleanup();
      }

      messages.push({ role: "assistant", content: final.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type !== "tool_use") continue;
        send("tool_start", {
          id: block.id,
          name: block.name,
          input: block.input,
        });
        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          PORT
        );
        send("tool_result", {
          id: block.id,
          name: block.name,
          ok: result.ok,
          preview: result.output.slice(0, 400),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.output,
          is_error: !result.ok,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (meterPlatform) recordTokens(req.user!.id, totalIn, totalOut);
    send("error", { message: "agent loop hit the 8-turn ceiling" });
    cleanup();
  } catch (e) {
    if (meterPlatform && (totalIn || totalOut)) {
      recordTokens(req.user!.id, totalIn, totalOut);
    }
    console.error("[dsos] shadows stream error:", e);
    send("error", { message: (e as Error).message ?? "stream failed" });
    cleanup();
  }
});

// PUT /api/ai/byo-key  { key: "sk-ant-..." | "" }  — saves user's BYO key
aiRouter.put("/byo-key", requireAuth, async (req, res, next) => {
  try {
    const raw = String(req.body?.key ?? "").trim();
    if (raw && !raw.startsWith("sk-ant-")) {
      return res
        .status(400)
        .json({ error: "that doesn't look like an Anthropic key (should start with sk-ant-)" });
    }
    const { db, schema } = await import("../db/index.js");
    const { eq } = await import("drizzle-orm");
    db.update(schema.users)
      .set({ byoAnthropicKey: raw || null })
      .where(eq(schema.users.id, req.user!.id))
      .run();
    res.json({ hasByoKey: !!raw });
  } catch (e) {
    next(e);
  }
});
