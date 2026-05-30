import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/authStore";

export function Pricing() {
  const { subscription, refresh } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // pick up subscription updates if the user just came back from checkout
    refresh();
  }, [refresh]);

  const isPro =
    subscription?.tier === "pro" &&
    (subscription.status === "active" || subscription.status === "trialing");

  const subscribe = async () => {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.billing.checkout();
      window.location.href = url;
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 500
          ? "Stripe isn't configured on the server yet. See README."
          : e instanceof Error
          ? e.message
          : "checkout failed"
      );
      setBusy(false);
    }
  };

  const managePortal = async () => {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.billing.portal();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not open portal");
      setBusy(false);
    }
  };

  return (
    <div className="p-5 text-dsos-bone space-y-4">
      <div>
        <div className="mono text-xs text-dsos-ghost/70 tracking-wider">
          DSOS // SUBSCRIPTION
        </div>
        <div className="text-2xl text-dsos-flame mt-1">Choose a tier</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TierCard
          name="Free"
          price="$0"
          features={[
            "Recon (DNS, headers, TLS, subdomains, WHOIS)",
            "Hash identifier",
            "150 scans / month",
            "BYO Anthropic key required for Shadows",
          ]}
          highlight={!isPro}
          tag={!isPro ? "CURRENT" : undefined}
        />

        <TierCard
          name="Pro"
          price="$19/mo"
          features={[
            "Everything in Free",
            "CVE search, breach check, phish analyzer",
            "Unlimited scans",
            "500k Shadows tokens/month included",
            "Still bring your own key any time",
          ]}
          highlight={isPro}
          tag={isPro ? "ACTIVE" : undefined}
        />
      </div>

      {error && (
        <div className="text-xs mono text-red-400 border border-red-400/40 rounded p-2">
          ⚠ {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {isPro ? (
          <button
            onClick={managePortal}
            disabled={busy}
            className="px-4 py-2 rounded bg-dsos-flame/20 border border-dsos-flame text-dsos-flame hover:bg-dsos-flame/30 disabled:opacity-50 mono text-xs tracking-widest"
          >
            {busy ? "..." : "MANAGE BILLING"}
          </button>
        ) : (
          <button
            onClick={subscribe}
            disabled={busy}
            className="px-4 py-2 rounded bg-dsos-flame/20 border border-dsos-flame text-dsos-flame hover:bg-dsos-flame/30 disabled:opacity-50 mono text-xs tracking-widest"
          >
            {busy ? "..." : "UPGRADE TO PRO"}
          </button>
        )}
      </div>

      <div className="text-[10px] mono text-dsos-ghost/50 pt-2 border-t border-dsos-ghost/20">
        Billing via Stripe. Cancel anytime from the Manage Billing portal.
      </div>
    </div>
  );
}

function TierCard({
  name,
  price,
  features,
  highlight,
  tag,
}: {
  name: string;
  price: string;
  features: string[];
  highlight?: boolean;
  tag?: string;
}) {
  return (
    <div
      className={`relative rounded border p-3 ${
        highlight
          ? "border-dsos-flame bg-dsos-flame/5"
          : "border-dsos-ghost/30 bg-dsos-night/40"
      }`}
    >
      {tag && (
        <div className="absolute top-2 right-2 text-[9px] mono px-1.5 py-0.5 rounded bg-dsos-flame/20 text-dsos-flame tracking-wider">
          {tag}
        </div>
      )}
      <div className="text-dsos-bone text-lg">{name}</div>
      <div className="text-dsos-flame text-2xl mb-2">{price}</div>
      <ul className="space-y-1 text-xs text-dsos-bone/80">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-dsos-flame">▸</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
