import { useEffect, useState } from "react";
import { api, type BillingStatus } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useWindowStore } from "../store/windowStore";

export function Account() {
  const { user, logout, refresh } = useAuthStore();
  const restoreOrFocus = useWindowStore((s) => s.restoreOrFocus);

  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyMasked, setKeyMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    api.billing.status().then(setStatus).catch(() => {});
    api.auth
      .me()
      .then((r) =>
        setKeyMasked(r.user.hasByoKey ? "sk-ant-•••• (set)" : null)
      )
      .catch(() => {});
  }, []);

  const saveKey = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const { hasByoKey } = await api.auth.setByoKey(keyInput);
      setKeyMasked(hasByoKey ? "sk-ant-•••• (set)" : null);
      setKeyInput("");
      setInfo(hasByoKey ? "key saved." : "key cleared.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  const openBilling = async () => {
    if (!status) return;
    const isPro =
      status.subscription.tier === "pro" &&
      (status.subscription.status === "active" ||
        status.subscription.status === "trialing");

    if (isPro) {
      try {
        const { url } = await api.billing.portal();
        window.location.href = url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "portal failed");
      }
    } else {
      restoreOrFocus("pricing");
    }
  };

  const tokensUsed = (status?.usage.tokensIn ?? 0) + (status?.usage.tokensOut ?? 0);
  const tokenQuota = status?.limits.monthlyTokenQuota ?? 0;
  const tokenPct =
    tokenQuota > 0 ? Math.min(100, Math.round((tokensUsed / tokenQuota) * 100)) : 0;

  const scansUsed = status?.usage.scans ?? 0;
  const scanLimit = status?.limits.scansPerMonth ?? 0;
  const scanPct =
    scanLimit > 0 ? Math.min(100, Math.round((scansUsed / scanLimit) * 100)) : 0;

  return (
    <div className="p-5 text-dsos-bone space-y-4">
      <div>
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">
          DSOS // ACCOUNT
        </div>
        <div className="text-lg text-dsos-flame mt-1 break-all">{user?.email}</div>
      </div>

      {/* Plan + usage */}
      <section className="rounded border border-dsos-ghost/30 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider">
              PLAN
            </div>
            <div className="text-dsos-bone">
              {status?.effectiveTier === "pro" ? (
                <span className="text-dsos-flame">Pro</span>
              ) : (
                "Free"
              )}
              {status && (
                <span className="text-dsos-ghost/60 text-xs mono ml-2">
                  ({status.subscription.status})
                </span>
              )}
            </div>
          </div>
          <button
            onClick={openBilling}
            className="px-3 py-1.5 rounded bg-dsos-flame/20 border border-dsos-flame text-dsos-flame hover:bg-dsos-flame/30 mono text-[10px] tracking-widest"
          >
            {status?.effectiveTier === "pro" ? "MANAGE" : "UPGRADE"}
          </button>
        </div>

        {scanLimit > 0 && (
          <Meter
            label="scans this month"
            used={scansUsed}
            total={scanLimit}
            pct={scanPct}
          />
        )}
        {tokenQuota > 0 && (
          <Meter
            label="platform AI tokens"
            used={tokensUsed}
            total={tokenQuota}
            pct={tokenPct}
          />
        )}
      </section>

      {/* BYO AI key */}
      <section className="rounded border border-dsos-ghost/30 p-3 space-y-2">
        <div className="text-[10px] mono text-dsos-ghost/60 tracking-wider">
          BRING YOUR OWN ANTHROPIC KEY
        </div>
        <div className="text-xs text-dsos-bone/70">
          Saved here, used for all Shadows calls. Skips platform quota.{" "}
          {keyMasked && <span className="text-dsos-flame">{keyMasked}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-dsos-night border border-dsos-ghost/30 focus:border-dsos-flame outline-none text-dsos-bone text-sm rounded"
          />
          <button
            onClick={saveKey}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-dsos-flame/20 border border-dsos-flame text-dsos-flame hover:bg-dsos-flame/30 disabled:opacity-50 mono text-[10px] tracking-widest"
          >
            {busy ? "..." : keyInput ? "SAVE" : "CLEAR"}
          </button>
        </div>
        {info && <div className="text-xs mono text-dsos-flame">{info}</div>}
        {error && <div className="text-xs mono text-red-400">⚠ {error}</div>}
      </section>

      <button
        onClick={logout}
        className="w-full py-2 rounded border border-dsos-ghost/40 text-dsos-ghost hover:text-dsos-bone hover:border-dsos-bone mono text-[10px] tracking-widest"
      >
        SIGN OUT
      </button>
    </div>
  );
}

function Meter({
  label,
  used,
  total,
  pct,
}: {
  label: string;
  used: number;
  total: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mono text-dsos-ghost/60 mb-1">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-dsos-night rounded overflow-hidden border border-dsos-ghost/20">
        <div
          className="h-full bg-dsos-flame"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
