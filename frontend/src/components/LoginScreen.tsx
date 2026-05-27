import { useState } from "react";
import { useAuthStore } from "../store/authStore";

const DEV_EMAIL = "dev@dsos.local";
const DEV_PASSWORD = "devpassword123";

export function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login, signup } = useAuthStore();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await signup(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const quickSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      // Try signup first; if account exists, fall back to login.
      try {
        await signup(DEV_EMAIL, DEV_PASSWORD);
      } catch {
        await login(DEV_EMAIL, DEV_PASSWORD);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "quick sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-dsos-night flex items-center justify-center z-50">
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(255,138,42,0.35), transparent 55%), radial-gradient(circle at 50% 90%, rgba(194,38,29,0.25), transparent 60%)",
        }}
      />
      <form
        onSubmit={submit}
        className="relative w-[360px] rounded-md border border-dsos-flame/40 bg-dsos-night/90 p-6 shadow-[0_0_40px_rgba(255,138,42,0.2)]"
      >
        <div className="text-center mb-5">
          <div
            className="text-4xl text-dsos-flame leading-none"
            style={{ textShadow: "0 0 16px rgba(255,138,42,0.7)" }}
          >
            🜨
          </div>
          <div className="mono text-xs text-dsos-bone mt-1 tracking-widest">
            DEVIL&apos;S SUNRISE OS
          </div>
        </div>

        <div className="flex gap-2 mb-4 text-[11px] mono">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-1.5 rounded border ${
              mode === "login"
                ? "border-dsos-flame text-dsos-flame"
                : "border-dsos-ghost/30 text-dsos-ghost/60"
            }`}
          >
            SIGN IN
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 py-1.5 rounded border ${
              mode === "signup"
                ? "border-dsos-flame text-dsos-flame"
                : "border-dsos-ghost/30 text-dsos-ghost/60"
            }`}
          >
            CREATE ACCOUNT
          </button>
        </div>

        <label className="block text-[10px] mono text-dsos-bone/70 mb-1 tracking-wider">
          EMAIL
        </label>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 bg-dsos-night border border-dsos-ghost/30 focus:border-dsos-flame outline-none text-dsos-bone text-sm rounded"
        />

        <label className="block text-[10px] mono text-dsos-bone/70 mb-1 tracking-wider">
          PASSWORD
        </label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 bg-dsos-night border border-dsos-ghost/30 focus:border-dsos-flame outline-none text-dsos-bone text-sm rounded"
        />

        {error && (
          <div className="mb-3 text-xs text-red-400 mono">⚠ {error}</div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 rounded bg-dsos-flame/20 border border-dsos-flame text-dsos-flame hover:bg-dsos-flame/30 disabled:opacity-50 mono text-xs tracking-widest"
        >
          {busy ? "..." : mode === "login" ? "ENTER" : "SUMMON"}
        </button>

        {import.meta.env.DEV && (
          <>
            <div className="flex items-center gap-2 my-3 text-[9px] mono text-dsos-ghost/40 tracking-widest">
              <div className="flex-1 h-px bg-dsos-ghost/20" />
              DEV
              <div className="flex-1 h-px bg-dsos-ghost/20" />
            </div>
            <button
              type="button"
              onClick={quickSignIn}
              disabled={busy}
              className="w-full py-2 rounded border border-dashed border-dsos-ghost/40 text-dsos-bone/70 hover:text-dsos-flame hover:border-dsos-flame disabled:opacity-50 mono text-[10px] tracking-widest"
              title={`signs in as ${DEV_EMAIL}`}
            >
              ⚡ QUICK SIGN-IN (DEV)
            </button>
          </>
        )}

        <div className="mt-4 text-[10px] mono text-dsos-ghost/50 text-center">
          {mode === "login"
            ? "no account? create one to start the free tier."
            : "min 8-char password. free tier includes recon + hash tools."}
        </div>
      </form>
    </div>
  );
}
