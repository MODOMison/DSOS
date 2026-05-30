// Thin wrapper around the backend at /api/*.
// The Vite dev server proxies /api → http://localhost:4000.

const base = "/api";

export class ApiError extends Error {
  status: number;
  upgrade: boolean;
  constructor(message: string, status: number, upgrade = false) {
    super(message);
    this.status = status;
    this.upgrade = upgrade;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`Non-JSON response from ${path}: ${text.slice(0, 200)}`, res.status);
  }
  if (!res.ok) {
    const obj = (data as { error?: string; upgrade?: boolean } | null) ?? {};
    throw new ApiError(obj.error ?? `Request failed (${res.status})`, res.status, !!obj.upgrade);
  }
  return data as T;
}

export interface AuthUser {
  id: string;
  email: string;
  hasByoKey?: boolean;
}

export interface Subscription {
  userId: string;
  tier: "free" | "pro";
  status:
    | "active"
    | "canceled"
    | "past_due"
    | "trialing"
    | "incomplete"
    | "none";
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  updatedAt: string;
}

export interface BillingStatus {
  subscription: Subscription;
  effectiveTier: "free" | "pro";
  limits: {
    scansPerMonth: number;
    monthlyTokenQuota: number;
    toolsUnlocked: "basic" | "all";
  };
  usage: {
    userId: string;
    yearMonth: string;
    tokensIn: number;
    tokensOut: number;
    scans: number;
  };
}

export const api = {
  recon: {
    headers: (url: string) =>
      request<ReconHeadersResult>(
        `/recon/headers?url=${encodeURIComponent(url)}`
      ),
    dns: (domain: string) =>
      request<ReconDnsResult>(`/recon/dns?domain=${encodeURIComponent(domain)}`),
    ssl: (domain: string) =>
      request<ReconSslResult>(`/recon/ssl?domain=${encodeURIComponent(domain)}`),
    subdomains: (domain: string) =>
      request<{ subdomains: string[]; source: string }>(
        `/recon/subdomains?domain=${encodeURIComponent(domain)}`
      ),
    whois: (domain: string) =>
      request<{ raw: string; parsed: Record<string, string> }>(
        `/recon/whois?domain=${encodeURIComponent(domain)}`
      ),
  },
  cve: {
    search: (q: string) =>
      request<{ results: CveResult[]; totalResults: number }>(
        `/cve/search?q=${encodeURIComponent(q)}`
      ),
  },
  hash: {
    identify: (hash: string) =>
      request<{ candidates: { name: string; confidence: string }[] }>(
        `/hash/identify`,
        { method: "POST", body: JSON.stringify({ hash }) }
      ),
  },
  breach: {
    password: (password: string) =>
      request<{ count: number; pwned: boolean }>(`/breach/password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  },
  phish: {
    analyze: (email: string) =>
      request<PhishResult>(`/phish/analyze`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  },
  ai: {
    status: () =>
      request<{
        available: boolean;
        reason?: string;
        model?: string;
        backend?: "anthropic" | "ollama";
        modelInstalled?: boolean;
      }>(`/ai/status`),
    chat: (messages: { role: "user" | "assistant"; content: string }[]) =>
      request<{ reply: string }>(`/ai/chat`, {
        method: "POST",
        body: JSON.stringify({ messages }),
      }),
    stream: streamShadows,
  },
  settings: {
    get: () => request<SettingsResponse>(`/settings`),
    save: (patch: Partial<SettingsPatch>) =>
      request<SettingsSaveResponse>(`/settings`, {
        method: "POST",
        body: JSON.stringify(patch),
      }),
    pullOllamaModel: streamPullOllamaModel,
  },
  auth: {
    me: () =>
      request<{ user: AuthUser; subscription: Subscription }>(`/auth/me`),
    signup: (email: string, password: string) =>
      request<{ user: AuthUser; subscription: Subscription }>(`/auth/signup`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    login: (email: string, password: string) =>
      request<{ user: AuthUser; subscription: Subscription }>(`/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request<{ ok: true }>(`/auth/logout`, { method: "POST" }),
    setByoKey: (key: string) =>
      request<{ hasByoKey: boolean }>(`/ai/byo-key`, {
        method: "PUT",
        body: JSON.stringify({ key }),
      }),
  },
  billing: {
    status: () => request<BillingStatus>(`/billing/status`),
    checkout: () =>
      request<{ url: string }>(`/billing/checkout`, { method: "POST" }),
    portal: () =>
      request<{ url: string }>(`/billing/portal`, { method: "POST" }),
  },
  install: {
    builtinStatus: () =>
      request<{ installed: boolean; inflight: boolean; reason?: string }>(
        `/install/builtin-status`
      ),
    builtin: streamInstallBuiltin,
  },
};

export type InstallEvent =
  | { type: "log"; line: string }
  | { type: "done"; ok: boolean; canLoad?: boolean; reason?: string; exitCode?: number }
  | { type: "error"; message: string };

async function streamInstallBuiltin(
  onEvent: (e: InstallEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${base}/install/builtin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `install request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.trim() || frame.startsWith(":")) continue;
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        switch (event) {
          case "log":
            onEvent({ type: "log", line: payload.line });
            break;
          case "done":
            onEvent({ type: "done", ...payload });
            return;
          case "error":
            onEvent({ type: "error", message: payload.message });
            return;
        }
      } catch {
        /* skip */
      }
    }
  }
}

export type BackendKind =
  | "anthropic"
  | "builtin"
  | "ollama"
  | "openai-compat"
  | "auto";

export interface SettingsResponse {
  settings: {
    backend: BackendKind;
    anthropicKey: string; // masked, "***XXXX" or ""
    hasAnthropicKey: boolean;
    anthropicModel: string;
    ollamaUrl: string;
    ollamaModel: string;
    builtinModelPath: string;
    openaiCompatUrl: string;
    openaiCompatModel: string;
    hasOpenaiCompatKey: boolean;
  };
  catalog: {
    anthropic: readonly { id: string; label: string; desc: string }[];
    ollama: readonly { id: string; label: string; desc: string }[];
  };
  ollamaStatus: {
    available: boolean;
    reason?: string;
    installedModels: string[];
  };
  builtinStatus: {
    available: boolean;
    modelName?: string;
    modelPath?: string;
    reason?: string;
  };
  openaiCompatStatus: {
    available: boolean;
    models?: string[];
    reason?: string;
  };
}

export interface SettingsPatch {
  backend: BackendKind;
  anthropicKey: string;
  anthropicModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  builtinModelPath: string;
  openaiCompatUrl: string;
  openaiCompatModel: string;
  openaiCompatKey: string;
}

export interface SettingsSaveResponse {
  backend: BackendKind;
  anthropicModel: string;
  ollamaModel: string;
  ollamaUrl: string;
  hasAnthropicKey: boolean;
}

export type PullProgressEvent =
  | {
      type: "progress";
      status?: string;
      digest?: string;
      total?: number;
      completed?: number;
    }
  | { type: "done"; model: string }
  | { type: "error"; message: string };

async function streamPullOllamaModel(
  model: string,
  onEvent: (e: PullProgressEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${base}/settings/pull-ollama-model`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `pull failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.trim() || frame.startsWith(":")) continue;
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        if (event === "progress") {
          onEvent({ type: "progress", ...payload });
        } else if (event === "done") {
          onEvent({ type: "done", model: payload.model });
          return;
        } else if (event === "error") {
          onEvent({ type: "error", message: payload.message });
          return;
        }
      } catch {
        /* skip */
      }
    }
  }
}

// ---------------------------------------------------------------
// SSE streaming client for the Shadows agent loop.
// Server events: text | tool_start | tool_result | done | error
// ---------------------------------------------------------------

export type ShadowsEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      preview: string;
    }
  | { type: "done"; stop_reason: string | null }
  | { type: "error"; message: string };

async function streamShadows(
  messages: { role: "user" | "assistant"; content: string }[],
  onEvent: (e: ShadowsEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${base}/ai/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.trim() || frame.startsWith(":")) continue; // comment/keepalive

      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        switch (event) {
          case "text":
            onEvent({ type: "text", delta: payload.delta });
            break;
          case "tool_start":
            onEvent({
              type: "tool_start",
              id: payload.id,
              name: payload.name,
              input: payload.input,
            });
            break;
          case "tool_result":
            onEvent({
              type: "tool_result",
              id: payload.id,
              name: payload.name,
              ok: payload.ok,
              preview: payload.preview,
            });
            break;
          case "done":
            onEvent({ type: "done", stop_reason: payload.stop_reason });
            return;
          case "error":
            onEvent({ type: "error", message: payload.message });
            return;
        }
      } catch {
        /* malformed frame — skip */
      }
    }
  }
}

export interface ReconHeadersResult {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  tech: string[];
  securityHeaders: {
    name: string;
    present: boolean;
    value?: string;
    note: string;
  }[];
}

export interface ReconDnsResult {
  domain: string;
  records: { type: string; values: string[]; error?: string }[];
}

export interface ReconSslResult {
  domain: string;
  subject: Record<string, string>;
  issuer: Record<string, string>;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  subjectAltNames: string[];
  fingerprint: string;
  serialNumber: string;
  protocol: string;
  cipher?: { name: string; version: string };
}

export interface CveResult {
  id: string;
  description: string;
  published: string;
  lastModified: string;
  cvssScore?: number;
  cvssSeverity?: string;
  cvssVector?: string;
  references: string[];
  cwe?: string[];
}

export interface PhishResult {
  verdict: "likely-phish" | "suspicious" | "looks-clean";
  score: number;
  signals: {
    name: string;
    severity: "info" | "low" | "med" | "high";
    detail: string;
  }[];
  extractedLinks: string[];
  fromHeader?: string;
}
