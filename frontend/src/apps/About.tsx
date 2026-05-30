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
        A self-contained security workbench that lives in a browser tab.
        Recon, CVE lookups, breach checks, phishing analysis, payload
        libraries &mdash; every &ldquo;program&rdquo; is a thin UI over a
        real local tool. No installer, no VM. Just spin it up.
      </p>

      <div className="mt-6 w-full max-w-md glass rounded-md p-4 text-left border border-dsos-flame/30">
        <div className="script text-2xl text-dsos-glow text-glow leading-none">
          Meet your Shadow.
        </div>
        <p className="text-xs text-dsos-bone mt-2 leading-relaxed">
          You&rsquo;re not in here alone. <span className="text-dsos-flame">Shadow</span>{" "}
          is your operator &mdash; Matt&rsquo;s always-on stand-in. Runs the
          tools, reads the output, tells it to you straight. When a job
          needs the real Matt, Shadow knows when to step aside.
        </p>
        <p className="text-[11px] text-dsos-ghost mt-2 leading-relaxed">
          <span className="text-dsos-flame">Pro tier:</span> bring your own
          VRM and persona &mdash; your Shadow, your face, your voice.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-left w-full max-w-md text-xs">
        <div className="glass rounded-md p-3">
          <div className="text-dsos-flame font-semibold">recon</div>
          <div className="text-dsos-ghost">DNS &middot; headers &middot; TLS &middot; subdomains &middot; WHOIS</div>
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
