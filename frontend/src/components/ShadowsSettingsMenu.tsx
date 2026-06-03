import { useEffect, useRef, useState } from "react";
import {
  api,
  type InstallEvent,
  type PullProgressEvent,
  type SettingsResponse,
} from "../lib/api";
import { cancelSpeech, getAvailableVoices, speak } from "../lib/tts";
import { useTtsSettings } from "../store/ttsStore";

// Gear-icon dropdown that lets the user pick which brain Shadows runs on,
// drop in an Anthropic key, swap models, and pull Ollama models on demand.

interface Props {
  onSaved?: () => void;
}

export function ShadowsSettingsMenu({ onSaved }: Props) {
  const ttsSettings = useTtsSettings((s) => s.settings);
  const patchTts = useTtsSettings((s) => s.patch);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState<{
    model: string;
    pct: number;
    status: string;
  } | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [installingBuiltin, setInstallingBuiltin] = useState<{
    log: string[];
    status: "running" | "done" | "error";
    message?: string;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      api.settings.get().then(setData).catch(() => setData(null));
      getAvailableVoices().then(setVoices).catch(() => setVoices([]));
    }
  }, [open]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function patch(p: Partial<Parameters<typeof api.settings.save>[0]>) {
    setBusy(true);
    try {
      await api.settings.save(p);
      const fresh = await api.settings.get();
      setData(fresh);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  async function pull(model: string) {
    if (pulling) return;
    setPulling({ model, pct: 0, status: "starting" });
    try {
      await api.settings.pullOllamaModel(model, (e: PullProgressEvent) => {
        if (e.type === "progress") {
          const pct =
            e.total && e.completed
              ? Math.min(100, Math.round((e.completed / e.total) * 100))
              : 0;
          setPulling({ model, pct, status: e.status ?? "downloading" });
        } else if (e.type === "done") {
          setPulling(null);
          api.settings.get().then(setData);
        } else if (e.type === "error") {
          setPulling({ model, pct: 0, status: `error: ${e.message}` });
          setTimeout(() => setPulling(null), 3000);
        }
      });
    } catch (ex) {
      setPulling({
        model,
        pct: 0,
        status: `error: ${(ex as Error).message}`,
      });
      setTimeout(() => setPulling(null), 3000);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-dsos-ghost hover:text-dsos-glow text-xs px-2 py-0.5 rounded border border-dsos-flame/30 bg-black/40 backdrop-blur transition-colors"
        title="Shadows settings"
      >
        ⚙
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-lg overflow-hidden shadow-2xl z-50 text-xs"
          style={{
            background:
              "linear-gradient(180deg, rgba(36,16,19,0.97), rgba(18,7,9,0.97))",
            backdropFilter: "blur(16px) saturate(140%)",
            border: "1px solid rgba(255,138,42,0.45)",
            boxShadow:
              "0 12px 50px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,184,106,0.18)",
          }}
        >
          <div className="px-3 py-2 border-b border-dsos-flame/25 flex items-center justify-between">
            <span className="script text-dsos-glow text-glow text-base">
              Shadows
            </span>
            <span className="text-dsos-ghost text-[10px] mono uppercase tracking-wide">
              settings
            </span>
          </div>

          {!data && (
            <div className="p-4 text-dsos-ghost text-center animate-pulse">
              loading...
            </div>
          )}

          {data && (
            <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto dsos-scrollbar">
              {/* ---- Backend selector ---- */}
              <Section label="Brain">
                <div className="grid grid-cols-5 gap-1">
                  {(
                    [
                      { id: "auto", label: "Auto" },
                      { id: "anthropic", label: "Claude" },
                      { id: "builtin", label: "Built-in" },
                      { id: "ollama", label: "Ollama" },
                      { id: "openai-compat", label: "API" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => patch({ backend: opt.id })}
                      disabled={busy}
                      className={`text-[10px] py-1 rounded border transition-all ${
                        data.settings.backend === opt.id
                          ? "border-dsos-flame bg-dsos-flame/20 text-dsos-glow"
                          : "border-dsos-flame/25 bg-black/30 text-dsos-bone hover:border-dsos-flame/60"
                      }`}
                      title={
                        opt.id === "auto" ? "Auto-pick: Claude > Built-in > Ollama" :
                        opt.id === "anthropic" ? "Cloud — Anthropic Claude" :
                        opt.id === "builtin" ? "Local — GGUF model in backend/models/" :
                        opt.id === "ollama" ? "Local — via Ollama service" :
                        "Generic OpenAI-API server (text-gen-webui, vLLM, LM Studio)"
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-dsos-ghost mt-1 leading-snug">
                  {data.settings.backend === "auto" &&
                    "Tries Claude → Built-in GGUF → Ollama in that order."}
                  {data.settings.backend === "anthropic" &&
                    "Always use Claude. Needs an API key below."}
                  {data.settings.backend === "builtin" &&
                    "Load a GGUF file directly. No external service."}
                  {data.settings.backend === "ollama" &&
                    "Use a local model via the Ollama service."}
                  {data.settings.backend === "openai-compat" &&
                    "Hit any OpenAI-API-compatible server (text-gen-webui, vLLM, LM Studio)."}
                </p>
              </Section>

              {/* ---- Anthropic ---- */}
              <Section label="Claude (Anthropic)">
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    <input
                      type="password"
                      placeholder={
                        data.settings.hasAnthropicKey
                          ? `key set (${data.settings.anthropicKey})`
                          : "sk-ant-..."
                      }
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      className="input-ember text-[11px] flex-1"
                    />
                    <button
                      onClick={async () => {
                        if (!keyDraft) return;
                        await patch({ anthropicKey: keyDraft });
                        setKeyDraft("");
                      }}
                      disabled={!keyDraft || busy}
                      className="btn-ember text-[11px] px-2"
                    >
                      Save
                    </button>
                  </div>
                  {data.settings.hasAnthropicKey && (
                    <button
                      onClick={() => patch({ anthropicKey: "" })}
                      className="text-[10px] text-dsos-ghost hover:text-dsos-flame underline"
                    >
                      Clear stored key
                    </button>
                  )}
                  <ModelDropdown
                    value={data.settings.anthropicModel}
                    options={data.catalog.anthropic}
                    onChange={(id) => patch({ anthropicModel: id })}
                    disabled={busy}
                  />
                </div>
              </Section>

              {/* ---- Ollama ---- */}
              <Section label="Local (Ollama)">
                <div
                  className={`text-[10px] mb-1.5 ${
                    data.ollamaStatus.available
                      ? "text-dsos-glow"
                      : "text-dsos-flame"
                  }`}
                >
                  {data.ollamaStatus.available
                    ? `● online @ ${data.settings.ollamaUrl}`
                    : `● offline — ${data.ollamaStatus.reason ?? "not reachable"}`}
                </div>
                <ModelDropdown
                  value={data.settings.ollamaModel}
                  options={data.catalog.ollama}
                  onChange={(id) => patch({ ollamaModel: id })}
                  disabled={busy}
                  installedSet={
                    new Set(data.ollamaStatus.installedModels)
                  }
                />
                {data.ollamaStatus.available &&
                  !data.ollamaStatus.installedModels.some(
                    (m) =>
                      m === data.settings.ollamaModel ||
                      m.startsWith(
                        data.settings.ollamaModel.split(":")[0] + ":"
                      )
                  ) && (
                    <button
                      onClick={() => pull(data.settings.ollamaModel)}
                      disabled={!!pulling || busy}
                      className="btn-ember text-[11px] w-full mt-1.5 py-1"
                    >
                      {pulling
                        ? `pulling ${pulling.model} · ${pulling.pct}% · ${pulling.status}`
                        : `Pull ${data.settings.ollamaModel}`}
                    </button>
                  )}
                {pulling && pulling.pct > 0 && (
                  <div className="mt-1.5 h-1 bg-black/60 rounded overflow-hidden">
                    <div
                      className="h-full bg-dsos-flame transition-all"
                      style={{ width: `${pulling.pct}%` }}
                    />
                  </div>
                )}
                {!data.ollamaStatus.available && (
                  <a
                    href="https://ollama.com/download/windows"
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[10px] text-dsos-glow underline mt-1"
                  >
                    Install Ollama →
                  </a>
                )}
              </Section>

              {/* ---- Built-in GGUF ---- */}
              <Section label="Built-in (GGUF)">
                <BuiltinPanel
                  status={data.builtinStatus}
                  installing={installingBuiltin}
                  onInstall={async () => {
                    if (installingBuiltin?.status === "running") return;
                    setInstallingBuiltin({ log: [], status: "running" });
                    try {
                      await api.install.builtin((e: InstallEvent) => {
                        setInstallingBuiltin((prev) => {
                          if (!prev) return prev;
                          if (e.type === "log") {
                            return {
                              ...prev,
                              log: [...prev.log.slice(-40), e.line],
                            };
                          }
                          if (e.type === "done") {
                            return {
                              log: prev.log,
                              status: e.ok ? "done" : "error",
                              message: e.ok
                                ? "Engine installed. Drop a .gguf into backend/models/ to use it."
                                : `Install failed (exit ${e.exitCode}).`,
                            };
                          }
                          return {
                            log: prev.log,
                            status: "error",
                            message: e.type === "error" ? e.message : "unknown error",
                          };
                        });
                      });
                    } catch (ex) {
                      setInstallingBuiltin({
                        log: [],
                        status: "error",
                        message: (ex as Error).message,
                      });
                    } finally {
                      // Re-probe so the readiness indicator updates.
                      api.settings.get().then(setData).catch(() => {});
                    }
                  }}
                />
              </Section>

              {/* ---- OpenAI-compatible ---- */}
              <Section label="OpenAI-compatible (text-gen-webui / vLLM / LM Studio)">
                {data.settings.backend === "openai-compat" && (
                  <div
                    className={`text-[10px] mb-1.5 ${
                      data.openaiCompatStatus.available
                        ? "text-dsos-glow"
                        : "text-dsos-flame"
                    }`}
                  >
                    {data.openaiCompatStatus.available
                      ? `● online @ ${data.settings.openaiCompatUrl}`
                      : `● offline — ${data.openaiCompatStatus.reason ?? "not reachable"}`}
                  </div>
                )}
                <div className="space-y-1.5">
                  <UrlInput
                    label="URL"
                    value={data.settings.openaiCompatUrl}
                    placeholder="http://localhost:5000/v1"
                    onSave={(url) => patch({ openaiCompatUrl: url })}
                    disabled={busy}
                  />
                  <UrlInput
                    label="Model"
                    value={data.settings.openaiCompatModel}
                    placeholder="MythoMax-L2-13B-GPTQ"
                    onSave={(model) => patch({ openaiCompatModel: model })}
                    disabled={busy}
                  />
                  <UrlInput
                    label="API Key (optional)"
                    value=""
                    placeholder={data.settings.hasOpenaiCompatKey ? "(stored)" : "leave blank if none"}
                    isPassword
                    onSave={(key) => patch({ openaiCompatKey: key })}
                    disabled={busy}
                  />
                </div>
              </Section>

              <Section label="Voice">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11px] text-dsos-bone">
                    <input
                      type="checkbox"
                      checked={ttsSettings.enabled}
                      onChange={(e) =>
                        patchTts({ enabled: e.currentTarget.checked })
                      }
                      className="accent-dsos-flame"
                    />
                    <span>Speak responses aloud</span>
                  </label>

                  {ttsSettings.enabled && (
                    <div className="space-y-2">
                      <div>
                        <div className="text-[9px] mono uppercase tracking-wider text-dsos-ghost mb-0.5">
                          Voice
                        </div>
                        <select
                          value={ttsSettings.voiceURI ?? ""}
                          onChange={(e) =>
                            patchTts({
                              voiceURI: e.currentTarget.value || null,
                            })
                          }
                          className="w-full input-ember text-[11px]"
                        >
                          <option value="">Browser default</option>
                          {preferredVoices(voices).map((voice) => (
                            <option key={voice.voiceURI} value={voice.voiceURI}>
                              {voice.name} ({voice.lang})
                            </option>
                          ))}
                        </select>
                      </div>

                      <RangeSetting
                        label="Rate"
                        value={ttsSettings.rate}
                        min={0.5}
                        max={2}
                        step={0.1}
                        onChange={(rate) => patchTts({ rate })}
                      />
                      <RangeSetting
                        label="Pitch"
                        value={ttsSettings.pitch}
                        min={0}
                        max={2}
                        step={0.1}
                        onChange={(pitch) => patchTts({ pitch })}
                      />
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() =>
                            void speak(
                              "Hey. Shadows voice is online.",
                              ttsSettings
                            )
                          }
                          className="btn-ember text-[11px] py-1"
                        >
                          Test voice
                        </button>
                        <button
                          onClick={cancelSpeech}
                          className="text-[11px] py-1 rounded border border-dsos-flame/25 bg-black/30 text-dsos-bone hover:border-dsos-flame/60"
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function preferredVoices(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice[] {
  const english = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("en")
  );
  const pool = english.length > 0 ? english : voices;
  return [...pool].sort((a, b) => voicePreference(b) - voicePreference(a));
}

function voicePreference(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (name.includes("male")) score += 20;
  if (!name.includes("female")) score += 5;
  if (voice.default) score += 3;
  return score;
}

function RangeSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[9px] mono uppercase tracking-wider text-dsos-ghost mb-0.5">
        <span>{label}</span>
        <span>{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="w-full accent-dsos-flame"
      />
    </div>
  );
}

function BuiltinPanel({
  status,
  installing,
  onInstall,
}: {
  status: SettingsResponse["builtinStatus"];
  installing: {
    log: string[];
    status: "running" | "done" | "error";
    message?: string;
  } | null;
  onInstall: () => void;
}) {
  // Three states to render:
  //  A. Engine installed + model loaded → ready
  //  B. Engine installed, no .gguf in models/ → "drop a model" guidance
  //  C. Engine NOT installed → one-click install button
  const engineMissing =
    !status.available &&
    /Install the optional dependency|node-llama-cpp/.test(status.reason ?? "");
  const modelMissing =
    !status.available &&
    /No \.gguf model found/i.test(status.reason ?? "");

  if (installing) {
    return (
      <div className="space-y-1.5">
        <div
          className={`text-[10px] ${
            installing.status === "running"
              ? "text-dsos-glow animate-pulse"
              : installing.status === "done"
                ? "text-dsos-glow"
                : "text-dsos-flame"
          }`}
        >
          {installing.status === "running" && "● installing engine..."}
          {installing.status === "done" && "● install complete"}
          {installing.status === "error" && "● install failed"}
        </div>
        {installing.message && (
          <div className="text-[10px] text-dsos-bone">{installing.message}</div>
        )}
        <pre className="max-h-32 overflow-auto bg-black/60 border border-dsos-flame/20 rounded p-1.5 text-[9px] mono text-dsos-ghost whitespace-pre-wrap">
          {installing.log.slice(-12).join("\n") || "starting..."}
        </pre>
      </div>
    );
  }

  if (status.available) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] text-dsos-glow">
          ● ready · {status.modelName}
        </div>
        <div className="text-[10px] text-dsos-ghost leading-snug">
          Loaded from <span className="mono">{status.modelPath}</span>
        </div>
      </div>
    );
  }

  if (modelMissing) {
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] text-dsos-flame">● engine ready, no model</div>
        <div className="text-[10px] text-dsos-ghost leading-snug">
          Drop a <span className="mono">.gguf</span> file into{" "}
          <span className="mono">backend/models/</span> and refresh.
        </div>
        <a
          href="https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF/resolve/main/mythomax-l2-13b.Q4_K_M.gguf"
          target="_blank"
          rel="noreferrer"
          className="block text-[10px] text-dsos-glow underline"
        >
          Download MythoMax-L2-13B Q4_K_M (7.9 GB) →
        </a>
        <a
          href="https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
          target="_blank"
          rel="noreferrer"
          className="block text-[10px] text-dsos-glow underline"
        >
          Download Llama 3.1 8B Q4_K_M (4.9 GB) →
        </a>
      </div>
    );
  }

  if (engineMissing) {
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] text-dsos-flame">● engine not installed</div>
        <div className="text-[10px] text-dsos-ghost leading-snug">
          The local inference engine (~100 MB, includes CUDA/Metal/CPU
          binaries) isn't installed yet. One click and we'll handle it.
        </div>
        <button
          onClick={onInstall}
          className="btn-ember w-full text-[11px] py-1.5"
        >
          Install built-in engine
        </button>
      </div>
    );
  }

  // Fallback for unknown states
  return (
    <div className="text-[10px] text-dsos-ghost">
      {status.reason ?? "unknown state"}
    </div>
  );
}

function UrlInput({
  label,
  value,
  placeholder,
  isPassword,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  isPassword?: boolean;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  return (
    <div>
      <div className="text-[9px] mono uppercase tracking-wider text-dsos-ghost mb-0.5">
        {label}
      </div>
      <div className="flex gap-1">
        <input
          type={isPassword ? "password" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="input-ember text-[11px] flex-1"
        />
        {dirty && (
          <button
            onClick={() => onSave(draft)}
            disabled={disabled}
            className="btn-ember text-[11px] px-2"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[9px] mono uppercase tracking-widest text-dsos-flame mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function ModelDropdown({
  value,
  options,
  onChange,
  disabled,
  installedSet,
}: {
  value: string;
  options: readonly { id: string; label: string; desc: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
  installedSet?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-1 text-left text-[11px] px-2 py-1.5 rounded border border-dsos-flame/30 bg-black/40 hover:border-dsos-flame/60 transition-colors"
      >
        <span className="text-dsos-bone truncate">
          {current?.label ?? value}
        </span>
        <span className="text-dsos-ghost">▾</span>
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-md overflow-hidden z-50 max-h-60 overflow-y-auto dsos-scrollbar"
          style={{
            background:
              "linear-gradient(180deg, rgba(36,16,19,0.98), rgba(18,7,9,0.98))",
            border: "1px solid rgba(255,138,42,0.5)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.7)",
          }}
        >
          {options.map((opt) => {
            const installed =
              !installedSet ||
              installedSet.has(opt.id) ||
              [...installedSet].some((m) =>
                m.startsWith(opt.id.split(":")[0] + ":")
              );
            return (
              <button
                key={opt.id}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-2 py-1.5 text-[11px] border-b border-dsos-flame/15 last:border-b-0 transition-colors ${
                  opt.id === value
                    ? "bg-dsos-flame/15"
                    : "hover:bg-dsos-flame/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dsos-bone font-medium">
                    {opt.label}
                  </span>
                  {installedSet && (
                    <span
                      className={`text-[9px] mono ${
                        installed ? "text-dsos-glow" : "text-dsos-ghost"
                      }`}
                    >
                      {installed ? "● installed" : "○ not pulled"}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-dsos-ghost leading-snug mt-0.5">
                  {opt.desc}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
