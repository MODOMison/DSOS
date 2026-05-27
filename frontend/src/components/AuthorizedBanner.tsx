/**
 * Persistent reminder bar shown inside any window that runs against an
 * external target. Re-states the rule: only test systems you own or have
 * explicit written permission to test.
 */
export function AuthorizedBanner({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="text-[10px] uppercase tracking-wider text-dsos-glow/70 px-3 py-1 border-b border-dsos-flame/20 bg-black/30">
        ⚠ authorized targets only — you are responsible for your testing
      </div>
    );
  }
  return (
    <div className="text-[11px] leading-tight px-3 py-2 border-b border-dsos-flame/20 bg-black/30 text-dsos-ghost">
      <span className="text-dsos-flame font-semibold">⚠ Authorized use only.</span>{" "}
      Run these tools against systems you own or are explicitly authorized to
      test. Practice on lab targets like{" "}
      <a
        className="underline hover:text-dsos-glow"
        href="https://portswigger.net/web-security"
        target="_blank"
        rel="noreferrer"
      >
        PortSwigger Academy
      </a>
      ,{" "}
      <a
        className="underline hover:text-dsos-glow"
        href="https://www.hackthebox.com/"
        target="_blank"
        rel="noreferrer"
      >
        HackTheBox
      </a>
      , or{" "}
      <a
        className="underline hover:text-dsos-glow"
        href="https://github.com/digininja/DVWA"
        target="_blank"
        rel="noreferrer"
      >
        DVWA
      </a>
      .
    </div>
  );
}
