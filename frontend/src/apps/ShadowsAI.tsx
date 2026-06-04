import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type ShadowsEvent } from "../lib/api";
import {
  cancelSpeech,
  isSpeechSupported,
  isTtsSpeaking,
  onSpeakingChange,
  speak,
  type TtsSettings,
} from "../lib/tts";
import { useCharacter } from "../store/characterStore";
import { useAuthStore } from "../store/authStore";
import { useTtsSettings } from "../store/ttsStore";
import { ShadowsSettingsMenu } from "../components/ShadowsSettingsMenu";

function greetingFor(hour: number, name?: string): string {
  const who = name ? `, ${name}` : "";
  if (hour >= 5 && hour < 12) {
    const pool = [
      `Morning${who}. I'm Matt's shadow — but I'm here for you. What are we working on?`,
      `You're up early${who}. Good time to think clearly. Where do you want to start?`,
      `Morning${who}. Tell me what's in front of you and we'll take it apart.`,
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (hour >= 12 && hour < 17) {
    const pool = [
      `Hey${who}. Matt's shadow — looking after you while you're in here. What's the situation?`,
      `Afternoon${who}. What are you trying to get done?`,
      `Back at it${who}? Good. Walk me through it.`,
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (hour >= 17 && hour < 22) {
    const pool = [
      `Evening${who}. Matt built me to stand in for him in here. What are we working on?`,
      `Hey${who}. Long day or just getting started?`,
      `Evening${who}. Lay it out and we'll figure it out.`,
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // late night
  const pool = [
    `Up late${who}? I'm Matt's shadow, and I don't keep hours. What are we doing?`,
    `Late one${who}. Clear head or running on fumes — either way, where do we start?`,
    `Hey${who}. The quiet hours are good for the hard problems. What's on your mind?`,
    `Still going${who}? Same. Let's make it count.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

type Turn =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      text: string;
      tools: ToolCall[];
      done: boolean;
    };

interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "ok" | "error";
  preview?: string;
}

export function ShadowsAI() {
  const ttsSettings = useTtsSettings((s) => s.settings);
  const [status, setStatus] = useState<{
    available: boolean;
    reason?: string;
    model?: string;
    backend?: "anthropic" | "ollama";
    modelInstalled?: boolean;
  } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ttsSettingsRef = useRef(ttsSettings);

  useEffect(() => {
    ttsSettingsRef.current = ttsSettings;
    if (!ttsSettings.enabled) cancelSpeech();
  }, [ttsSettings]);

  useEffect(() => {
    return onSpeakingChange((speaking) => {
      useCharacter.getState().setSpeaking(speaking);
    });
  }, []);

  useEffect(() => {
    api.ai
      .status()
      .then(setStatus)
      .catch(() =>
        setStatus({ available: false, reason: "backend unreachable" })
      );
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  async function send() {
    if (!input.trim() || sending || !status?.available) return;
    cancelSpeech();
    let sentenceBuffer = "";
    const userTurn: Turn = { kind: "user", text: input.trim() };
    const assistantTurn: Turn = {
      kind: "assistant",
      text: "",
      tools: [],
      done: false,
    };
    setTurns((prev) => [...prev, userTurn, assistantTurn]);
    setInput("");
    setSending(true);
    setErr(null);

    // Character reacts: brief acknowledgement.
    useCharacter.getState().onSend();

    const history = [
      ...turns
        .filter((t): t is Extract<Turn, { kind: "user" | "assistant" }> => true)
        .map((t) => ({
          role: t.kind as "user" | "assistant",
          content: t.kind === "user" ? t.text : t.text,
        })),
      { role: "user" as const, content: userTurn.text },
    ];

    abortRef.current = new AbortController();

    try {
      await api.ai.stream(
        history,
        (e: ShadowsEvent) => {
          // Dispatch character reactions on every event.
          const c = useCharacter.getState();
          switch (e.type) {
            case "tool_start":
              c.onToolStart();
              break;
            case "tool_result":
              c.onToolEnd();
              break;
            case "text":
              if (ttsSettingsRef.current.enabled && isSpeechSupported()) {
                c.markActivity();
              } else {
                c.setSpeaking(false);
                c.markActivity();
              }
              // Accumulate the whole reply and speak it as a single utterance
              // on "done". Chrome on Windows clips the leading words of
              // back-to-back queued utterances, so speaking sentence-by-
              // sentence reliably drops words.
              sentenceBuffer += e.delta;
              break;
            case "done":
              speakRemainder(sentenceBuffer, ttsSettingsRef.current);
              sentenceBuffer = "";
              c.onResponseDone(isTtsSpeaking());
              break;
            case "error":
              sentenceBuffer = "";
              c.onError();
              break;
          }
          setTurns((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last.kind !== "assistant") return prev;
            const updated = { ...last, tools: last.tools.slice() };
            switch (e.type) {
              case "text":
                updated.text += e.delta;
                break;
              case "tool_start":
                updated.tools.push({
                  id: e.id,
                  name: e.name,
                  input: e.input,
                  status: "running",
                });
                break;
              case "tool_result": {
                const idx = updated.tools.findIndex((t) => t.id === e.id);
                if (idx !== -1) {
                  updated.tools[idx] = {
                    ...updated.tools[idx],
                    status: e.ok ? "ok" : "error",
                    preview: e.preview,
                  };
                }
                break;
              }
              case "done":
                updated.done = true;
                break;
              case "error":
                setErr(e.message);
                updated.done = true;
                break;
            }
            next[next.length - 1] = updated;
            return next;
          });
        },
        abortRef.current.signal
      );
    } catch (ex) {
      setErr((ex as Error).message);
      useCharacter.getState().onError();
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    cancelSpeech();
    setSending(false);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Settings gear, top-right of the chat area */}
      <div className="absolute top-2 right-2 z-10">
        <ShadowsSettingsMenu
          onSaved={() =>
            api.ai
              .status()
              .then(setStatus)
              .catch(() => setStatus({ available: false, reason: "backend unreachable" }))
          }
        />
      </div>

      {status && !status.available && (
        <div className="m-3 glass rounded-md p-3 text-xs text-dsos-bone border border-dsos-flame/30">
          <div className="script text-lg text-dsos-glow text-glow mb-1">
            Shadows is dormant
          </div>
          <div className="text-dsos-ghost mb-2">{status.reason}</div>
          <div className="text-dsos-ghost text-[11px] leading-relaxed">
            <strong className="text-dsos-bone">To wake Shadows:</strong>
            <ol className="list-decimal ml-4 mt-1 space-y-0.5">
              <li>
                Sign up at{" "}
                <a
                  className="underline text-dsos-glow"
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  console.anthropic.com
                </a>{" "}
                and create an API key.
              </li>
              <li>
                Open{" "}
                <span className="mono text-dsos-glow">backend/.env</span> (copy
                from <span className="mono">.env.example</span> if missing).
              </li>
              <li>
                Set{" "}
                <span className="mono text-dsos-glow">
                  ANTHROPIC_API_KEY=sk-ant-...
                </span>
              </li>
              <li>
                Restart the backend (Ctrl+C in the backend terminal, then{" "}
                <span className="mono">npm run dev</span>).
              </li>
            </ol>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto dsos-scrollbar p-3 space-y-2 text-sm"
      >
        {turns.length === 0 && status?.available && <ShadowsGreeting status={status} />}
        {turns.map((t, i) =>
          t.kind === "user" ? (
            <div
              key={i}
              className="rounded-md p-2 bg-dsos-flame/15 text-dsos-bone ml-6"
            >
              <div className="text-[10px] mono text-dsos-ghost mb-0.5">you</div>
              <div className="whitespace-pre-wrap text-[12px]">{t.text}</div>
            </div>
          ) : (
            <div
              key={i}
              className="rounded-md p-2 bg-black/40 text-dsos-bone mr-6 border border-dsos-flame/20"
            >
              <div className="text-[10px] mono text-dsos-ghost mb-0.5">
                shadows
              </div>
              {t.tools.length > 0 && (
                <div className="mb-2 space-y-1">
                  {t.tools.map((tool) => (
                    <ToolBadge key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
              {t.text ? (
                <div className="prose-shadows text-[12px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {t.text}
                  </ReactMarkdown>
                </div>
              ) : !t.done ? (
                <div className="text-dsos-glow text-xs animate-pulse">
                  shadows is divining...
                </div>
              ) : null}
            </div>
          )
        )}
        {err && <div className="text-dsos-flame text-xs">{err}</div>}
      </div>

      <form
        className="border-t border-dsos-flame/20 p-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="input-ember text-xs"
          placeholder={
            status?.available
              ? "talk to your shadow... (it can call DSOS tools)"
              : "your shadow is dormant — see panel above"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!status?.available || sending}
        />
        {sending ? (
          <button type="button" className="btn-ember" onClick={stop}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn-ember"
            disabled={!status?.available || !input.trim()}
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function speakRemainder(text: string, settings: TtsSettings) {
  const trimmed = text.trim();
  if (trimmed) void speak(trimmed, settings);
}

interface ShadowsStatus {
  available: boolean;
  reason?: string;
  model?: string;
  backend?: "anthropic" | "ollama";
  modelInstalled?: boolean;
}

function ShadowsGreeting({ status }: { status: ShadowsStatus }) {
  const user = useAuthStore((s) => s.user);
  // Pull a display name out of the email local-part if we don't have a real one.
  const displayName = useMemo(() => {
    if (!user?.email) return undefined;
    const local = user.email.split("@")[0];
    // Skip the dev account and obvious junk
    if (local === "dev" || local.length < 2) return undefined;
    // Strip digits + punctuation, capitalize
    const cleaned = local.replace(/[\d._+-]+/g, " ").trim().split(" ")[0];
    if (!cleaned) return undefined;
    return cleaned[0].toUpperCase() + cleaned.slice(1);
  }, [user]);

  const greeting = useMemo(
    () => greetingFor(new Date().getHours(), displayName),
    [displayName]
  );

  return (
    <div className="px-3 py-6 space-y-3">
      <div className="text-dsos-flame text-2xl leading-none">✦</div>
      <div className="text-dsos-bone text-sm leading-relaxed">{greeting}</div>
      <div className="text-dsos-ghost/60 text-[10px] mono pt-2 border-t border-dsos-ghost/15">
        {status.backend === "ollama" ? "local · " : "cloud · "}
        {status.model ?? "claude-haiku-4-5"}
        {status.backend === "ollama" && status.modelInstalled === false && (
          <div className="mt-1 text-dsos-flame">
            model not pulled — run:{" "}
            <span className="mono">ollama pull {status.model}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBadge({ tool }: { tool: ToolCall }) {
  const color =
    tool.status === "running"
      ? "text-dsos-glow border-dsos-glow/40 animate-pulse"
      : tool.status === "ok"
        ? "text-dsos-bone border-dsos-flame/30"
        : "text-dsos-flame border-dsos-flame/60";
  const icon =
    tool.status === "running" ? "✦" : tool.status === "ok" ? "✓" : "✗";

  const argSummary =
    tool.input && typeof tool.input === "object"
      ? Object.values(tool.input as Record<string, unknown>)
          .map((v) => String(v).slice(0, 60))
          .join(", ")
      : "";

  return (
    <div
      className={`mono text-[10px] rounded border bg-black/30 px-2 py-1 ${color}`}
    >
      <span className="mr-1.5">{icon}</span>
      <span className="text-dsos-glow">{tool.name}</span>
      {argSummary && (
        <span className="text-dsos-ghost ml-1.5">({argSummary})</span>
      )}
    </div>
  );
}
