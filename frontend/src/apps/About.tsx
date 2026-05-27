export function About() {
  return (
    <div className="flex-1 overflow-y-auto dsos-scrollbar p-6 flex flex-col items-center text-center">
      <div className="w-full max-w-md rounded-lg overflow-hidden border border-dsos-flame/25 shadow-ember">
        <img
          src="/eclipse.png"
          alt=""
          className="w-full h-36 object-cover"
          style={{ objectPosition: "center 58%" }}
        />
      </div>

      <h1 className="script text-4xl text-dsos-glow text-glow mt-4 leading-none">
        Devil&#39;s Sunrise
      </h1>
      <div className="mono text-[11px] text-dsos-ghost mt-1">
        DSOS v0.3.0 &middot; sunrise build
      </div>

      <p className="text-sm text-dsos-bone mt-5 max-w-md leading-relaxed">
        A self-contained security workstation that runs in a browser tab.
        The desktop, windows, and taskbar are a React app; every &ldquo;program&rdquo;
        is a thin UI over a real local tool. No installer, no VM image &mdash;
        just <span className="mono text-dsos-glow">npm run dev</span> and an
        open port.
      </p>

      <p className="text-sm text-dsos-bone mt-3 max-w-md leading-relaxed">
        Drop in an Anthropic API key to wake the Oracle AI panel.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 text-left w-full max-w-md text-xs">
        <div className="glass rounded-md p-3">
          <div className="text-dsos-flame font-semibold">recon</div>
          <div className="text-dsos-ghost">DNS · headers · TLS · subdomains · WHOIS</div>
        </div>
        <div className="glass rounded-md p-3">
          <div className="text-dsos-flame font-semibold">vuln</div>
          <div className="text-dsos-ghost">live NVD lookups, CVSS, references</div>
        </div>
        <div className="glass rounded-md p-3">
          <div className="text-dsos-flame font-semibold">defense</div>
          <div className="text-dsos-ghost">phishing analyzer, k-anonymous breach checks</div>
        </div>
        <div className="glass rounded-md p-3">
          <div className="text-dsos-flame font-semibold">practice</div>
          <div className="text-dsos-ghost">CTF payload library + lab pointers</div>
        </div>
      </div>

      <div className="mt-6 text-[11px] text-dsos-ghost max-w-md">
        Authorized targets only. Built for learning and authorized testing.
      </div>
    </div>
  );
}
