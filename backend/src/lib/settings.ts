// Settings storage — a single JSON file at backend/settings.json.
// Read on every request so changes take effect immediately (no restart).
// In a packaged build this should move to app.getPath("userData") so the
// installer can stay read-only.

import fs from "node:fs/promises";
import path from "node:path";

export interface OracleSettings {
  // "anthropic" | "builtin" | "ollama" | "openai-compat" | "auto"
  //   auto: prefer anthropic-key → builtin (if a .gguf is in backend/models/)
  //         → ollama (if reachable). openai-compat is never auto-selected.
  //   builtin: load a GGUF directly via node-llama-cpp. User drops their
  //            model file in backend/models/ — we auto-pick the first one,
  //            or honor builtinModelPath if set.
  //   openai-compat: generic OpenAI-API server (text-gen-webui, vLLM, LM Studio).
  backend: "anthropic" | "builtin" | "ollama" | "openai-compat" | "auto";
  anthropicKey: string;
  anthropicModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  builtinModelPath: string;  // empty = auto-pick from backend/models/
  openaiCompatUrl: string;
  openaiCompatModel: string;
  openaiCompatKey: string;
}

export const DEFAULT_SETTINGS: OracleSettings = {
  backend: "auto",
  anthropicKey: "",
  anthropicModel: "claude-haiku-4-5",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  builtinModelPath: "",
  openaiCompatUrl: "http://localhost:5000/v1",
  openaiCompatModel: "MythoMax-L2-13B-GPTQ",
  openaiCompatKey: "",
};

// Curated lists so the UI can show good defaults.
export const ANTHROPIC_MODELS = [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    desc: "Fast and cheap. Default.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    desc: "Balanced. Better reasoning, ~3x cost.",
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    desc: "Top-tier. For hard agent tasks. ~5x cost.",
  },
] as const;

export const OLLAMA_MODELS = [
  {
    id: "qwen2.5:7b",
    label: "Qwen 2.5 7B",
    desc: "Best small model for tool use. ~5GB VRAM.",
  },
  {
    id: "qwen2.5:14b",
    label: "Qwen 2.5 14B",
    desc: "Stronger reasoning. ~9GB VRAM.",
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    desc: "Meta's solid all-rounder. ~5GB VRAM.",
  },
  {
    id: "hermes3:8b",
    label: "Hermes 3 8B",
    desc: "Function-calling tuned. ~5GB VRAM.",
  },
  {
    id: "mistral-nemo:12b",
    label: "Mistral Nemo 12B",
    desc: "Mistral's small flagship. ~8GB VRAM.",
  },
  {
    id: "qwen2.5:3b",
    label: "Qwen 2.5 3B",
    desc: "Tiny + fast. Low-spec fallback. ~2GB VRAM.",
  },
] as const;

const SETTINGS_PATH = path.join(process.cwd(), "settings.json");

let cache: OracleSettings | null = null;

export async function loadSettings(): Promise<OracleSettings> {
  if (cache) return cache;
  let next: OracleSettings;
  try {
    const text = await fs.readFile(SETTINGS_PATH, "utf8");
    next = { ...DEFAULT_SETTINGS, ...JSON.parse(text) };
  } catch {
    next = { ...DEFAULT_SETTINGS };
    // Seed file so it's discoverable. Best-effort.
    fs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2)).catch(() => {});
  }
  // Honor env-var defaults if the file leaves a field empty — handy during
  // dev when ANTHROPIC_API_KEY still lives in backend/.env.
  if (!next.anthropicKey && process.env.ANTHROPIC_API_KEY) {
    next.anthropicKey = process.env.ANTHROPIC_API_KEY;
  }
  cache = next;
  return next;
}

export async function saveSettings(
  next: Partial<OracleSettings>
): Promise<OracleSettings> {
  const current = await loadSettings();
  const merged: OracleSettings = { ...current, ...next };
  cache = merged;
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

export function invalidateSettings() {
  cache = null;
}
