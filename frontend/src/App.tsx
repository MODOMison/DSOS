import { useEffect, useState } from "react";
import { BootScreen } from "./components/BootScreen";
import { CompanionShell } from "./components/CompanionShell";
import { Desktop } from "./components/Desktop";
import { LoginScreen } from "./components/LoginScreen";
import { useWindowStore } from "./store/windowStore";
import { useAuthStore } from "./store/authStore";

export default function App() {
  const isCompanion =
    new URLSearchParams(window.location.search).get("mode") === "companion";

  if (isCompanion) return <CompanionShell />;

  return <Gate />;
}

function Gate() {
  const { status, bootstrap } = useAuthStore();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (status === "loading") {
    return (
      <div className="fixed inset-0 bg-dsos-night flex items-center justify-center">
        <div className="mono text-xs text-dsos-ghost/60 tracking-widest animate-pulse">
          INITIALIZING SUNRISE...
        </div>
      </div>
    );
  }

  if (status === "anon") return <LoginScreen />;

  return <FullDesktop />;
}

function FullDesktop() {
  const [booted, setBooted] = useState(false);
  const open = useWindowStore((s) => s.open);
  const params = new URLSearchParams(window.location.search);
  const billing = params.get("billing");

  useEffect(() => {
    if (!booted) return;
    if (billing) {
      open("pricing");
      // strip the query so a reload doesn't keep reopening it
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [booted, billing, open]);

  return (
    <>
      <Desktop />
      {!booted && <BootScreen onComplete={() => setBooted(true)} />}
    </>
  );
}
