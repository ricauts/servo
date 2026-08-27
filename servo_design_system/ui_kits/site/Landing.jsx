const { Wordmark, Button, Badge, Icon, Card } = window.ServoDesignSystem_824c45;

const LABEL = { fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-faint)" };
const WRAP = { width: "min(var(--container),100% - 48px)", margin: "0 auto" };

function CropFrame({ children, style }) {
  return (
    <div style={{ position: "relative", ...style }}>
      {["top:-1px;left:-1px;border-top:1px solid var(--brand);border-left:1px solid var(--brand)",
        "top:-1px;right:-1px;border-top:1px solid var(--brand);border-right:1px solid var(--brand)",
        "bottom:-1px;left:-1px;border-bottom:1px solid var(--brand);border-left:1px solid var(--brand)",
        "bottom:-1px;right:-1px;border-bottom:1px solid var(--brand);border-right:1px solid var(--brand)"].map((css, i) => (
        <span key={i} style={{ position: "absolute", width: 10, height: 10, pointerEvents: "none", ...cssToObj(css) }} />
      ))}
      {children}
    </div>
  );
}
function cssToObj(css) {
  const o = {};
  css.split(";").forEach((d) => { const [k, v] = d.split(":"); o[k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v; });
  return o;
}

function SiteNav() {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 10, borderBottom: "1px solid var(--line)", background: "var(--bg-elevated)", backdropFilter: "var(--blur-panel)" }}>
      <div style={{ ...WRAP, display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
        <Wordmark size={22} />
        <nav style={{ display: "flex", gap: 28, fontSize: "var(--text-md)" }}>
          {["Features", "How it works", "Permissions", "Docs"].map((l) => (
            <a key={l} href="#" style={{ color: "var(--text-muted)", textDecoration: "none" }}>{l}</a>
          ))}
        </nav>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="ghost" size="lg">Sign in</Button>
          <Button variant="primary" size="lg" iconStart={<Icon name="star" size={14} />}>Star on GitHub</Button>
        </div>
      </div>
    </header>
  );
}

function TicketDemo() {
  const steps = [
    { tag: "INTAKE", body: <><b style={{ color: "var(--text-strong)", fontFamily: "var(--font-mono)" }}>user@acme.com</b> — “Account locked — can’t sign in”</> },
    { tag: "ROUTED", body: <>ACCESS · URGENT · <b style={{ color: "var(--text-brand)" }}>Engineering</b> · senior tier · Iris Volkov</> },
    { tag: "WORK", body: <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)" }}>directory_lookup · unlock_account<span style={{ color: "var(--warn)" }}> · paused for approval</span></span> },
    { tag: "APPROVAL", body: <>Ana signs it off. The work resumes where it stopped, and the reply goes out.</> },
  ];
  return (
    <div style={{ border: "1px solid var(--line-strong)", borderRadius: "var(--radius-5)", background: "var(--surface)", boxShadow: "var(--shadow-3),var(--inset-top)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
        {["var(--critical)", "var(--warn)", "var(--brand)"].map((c) => <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: c, opacity: .75 }} />)}
        <span style={{ ...LABEL, marginLeft: 8 }}>servo · ticket #1058</span>
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map((s) => (
          <div key={s.tag} style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: 12, alignItems: "start" }}>
            <span style={{ ...LABEL, color: "var(--text-faint)", paddingTop: 2 }}>{s.tag}</span>
            <span style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)", lineHeight: "var(--leading-relaxed)" }}>{s.body}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <Button variant="primary" size="sm" iconStart={<Icon name="check" size={14} />}>Approve &amp; send</Button>
          <Button variant="outline" size="sm">Edit draft</Button>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section style={{ borderBottom: "1px solid var(--line)", backgroundImage: "var(--dot-grid)", backgroundSize: "var(--dot-grid-size)" }}>
      <div style={{ ...WRAP, display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 56, alignItems: "center", padding: "88px 0 96px" }}>
        <div>
          <span style={{ ...LABEL, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", gap: 8, padding: "5px 10px", borderRadius: "var(--radius-2)", background: "var(--brand-chip)", border: "1px solid var(--brand-chip-line)", color: "var(--brand-chip-ink)" }}>
            <Icon name="git-branch" size={12} />open-source ticketing · ai integrated
          </span>
          <h1 style={{ marginTop: 22, fontSize: "var(--display-md)", lineHeight: 1.02, letterSpacing: "var(--tracking-display)", fontWeight: 600, color: "var(--text-strong)" }}>
Ticketing your whole team<br />works in — <span style={{ color: "var(--text-brand)" }}>with nobody waiting.</span>
          </h1>
          <p style={{ marginTop: 22, maxWidth: "52ch", fontSize: "var(--text-lg)", lineHeight: "var(--leading-relaxed)", color: "var(--text-muted)" }}>
Open-source ticketing with roles, assignment groups and approval gates in one self-hostable desk — and AI integrated exactly where it saves time: triage, drafted replies, and tool work that always stops for a human. Less time lost to handoffs, sign-offs and status chasing.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
            <Button variant="primary" size="xl" iconStart={<Icon name="terminal" size={15} />}>Self-host in one command</Button>
            <Button variant="outline" size="xl">Read the docs</Button>
          </div>
          <div style={{ display: "flex", gap: 22, marginTop: 26, ...LABEL }}>
            <span>MIT licensed</span><span>Self-hosted</span><span>Bring your own model</span>
          </div>
        </div>
        <CropFrame style={{ padding: 10 }}><TicketDemo /></CropFrame>
      </div>
    </section>
  );
}

const STEPS = [
  { n: "01", t: "Intake", d: "Email, a form or an API call opens a ticket. Unknown senders become requesters; a subject carrying #1029 files as a comment on that ticket instead." },
  { n: "02", t: "Routing", d: "Assignment groups own categories and members carry junior→senior tiers. Priority sets the minimum tier; anyone can escalate up a tier or across a group." },
  { n: "03", t: "Work", d: "Humans and AI agents work the same queue. Agents triage, draft replies and operate real tools — every step lands on the ticket timeline, verbatim." },
  { n: "04", t: "Approval", d: "Anything risky pauses for a named human. On approval the work resumes exactly where it stopped; a rejection is logged with its reason and flows back." },
];

const FEATURES = [
  { i: "users-2", t: "Roles & permissions", d: "Admin, agent and requester roles with a permission matrix. Requesters only ever see their own tickets; group management and high-risk sign-offs are admin-only." },
  { i: "shield-check", t: "Approval gates", d: "Every action carries a risk level and an editable approval policy. Gated work waits in one queue with its exact input, for whoever is allowed to decide it." },
  { i: "git-branch", t: "Groups & escalation", d: "Groups own categories, members carry tiers. Escalate up a tier or across to another group and the least-loaded eligible member picks it up — logged on the timeline." },
  { i: "timer", t: "SLA targets", d: "Per-priority response and resolution targets, live SLA state on every ticket, and a scan that escalates missed targets before anyone has to chase them." },
  { i: "list", t: "Readable audit trail", d: "Who acted, what ran, who approved what — folded into one line per run, never truncated. Unfold it and every step is there verbatim." },
  { i: "plug", t: "AI where it pays", d: "Triage, reply drafts and tool work, on Anthropic, Z.AI GLM or any OpenAI-compatible endpoint — or the deterministic mock provider, entirely offline." },
];

function Landing() {
  return (
    <div>
      <SiteNav />
      <Hero />

      <section style={{ borderBottom: "1px solid var(--line)", background: "var(--bg-elevated)" }}>
        <div style={{ ...WRAP, padding: "56px 0 64px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 24 }}>
            <span style={LABEL}>the loop</span>
            <span style={{ ...LABEL, color: "var(--text-muted)" }}>intake → routing → work → approval → resolved</span>
          </div>
          <div style={{ marginTop: 18, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-5)", overflow: "hidden", background: "var(--surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
              {["var(--critical)", "var(--warn)", "var(--brand)"].map((c) => <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: c, opacity: .75 }} />)}
              <span style={LABEL}>servo — ticket #1061 · frontend agent</span>
              <span style={{ ...LABEL, marginLeft: "auto" }}>the loop</span>
            </div>
            <image-slot id="site-hero-film" shape="rect" style={{ display: "block", width: "100%", height: 460 }} placeholder="Drop the product film or a full-bleed desk screenshot"></image-slot>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
            {[["queue", "site-shot-queue"], ["approvals", "site-shot-approvals"], ["run trace", "site-shot-run"]].map(([cap, id]) => (
              <figure key={id} style={{ margin: 0 }}>
                <image-slot id={id} shape="rounded" radius="10" style={{ display: "block", width: "100%", height: 180 }} placeholder={"Drop the " + cap + " screenshot"}></image-slot>
                <figcaption style={{ ...LABEL, marginTop: 8 }}>{cap}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderBottom: "1px solid var(--line)" }}>
        <div style={{ ...WRAP, padding: "72px 0" }}>
          <span style={LABEL}>how it works</span>
          <h2 style={{ marginTop: 14, fontSize: "var(--display-sm)", letterSpacing: "var(--tracking-display)", fontWeight: 600 }}>One ticket, end to end</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, marginTop: 40, background: "var(--line)", border: "1px solid var(--line)", borderRadius: "var(--radius-4)", overflow: "hidden" }}>
            {STEPS.map((s) => (
              <div key={s.n} style={{ background: "var(--surface)", padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ ...LABEL, color: "var(--text-brand)" }}>{s.n}</span>
                <span style={{ fontSize: "var(--text-xl)", fontWeight: 600, letterSpacing: "var(--tracking-heading)", color: "var(--text-strong)" }}>{s.t}</span>
                <span style={{ fontSize: "var(--text-md)", lineHeight: "var(--leading-relaxed)", color: "var(--text-muted)" }}>{s.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderBottom: "1px solid var(--line)" }}>
        <div style={{ ...WRAP, padding: "72px 0" }}>
          <span style={LABEL}>features</span>
          <h2 style={{ marginTop: 14, fontSize: "var(--display-sm)", letterSpacing: "var(--tracking-display)", fontWeight: 600 }}>Built so nothing sits waiting</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 40 }}>
            {FEATURES.map((x) => (
              <Card key={x.t} title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><Icon name={x.i} size={16} color="var(--text-brand)" />{x.t}</span>}>
                <span style={{ fontSize: "var(--text-md)", lineHeight: "var(--leading-relaxed)", color: "var(--text-muted)" }}>{x.d}</span>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div style={{ ...WRAP, padding: "80px 0", display: "grid", gridTemplateColumns: "1fr auto", gap: 40, alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "var(--display-sm)", letterSpacing: "var(--tracking-display)", fontWeight: 600 }}>Run it on your own hardware.</h2>
            <p style={{ marginTop: 16, maxWidth: "56ch", fontSize: "var(--text-lg)", color: "var(--text-muted)", lineHeight: "var(--leading-relaxed)" }}>
              SQLite, real OIDC sign-in, secrets encrypted at rest, and a first-run wizard that takes a clean install to a working desk in one screen.
            </p>
          </div>
          <pre className="svo-code" style={{ fontSize: "var(--text-mono-md)", padding: "var(--space-8)", whiteSpace: "pre", overflow: "visible", lineHeight: 1.9 }}>{"$ docker compose up --build\n$ open http://localhost:3000"}</pre>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--line)", background: "var(--bg-elevated)" }}>
        <div style={{ ...WRAP, padding: "34px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark size={20} tagline="MIT licensed · 2026" />
          <div style={{ display: "flex", gap: 24, ...LABEL }}>
            <a href="#" style={{ color: "var(--text-muted)" }}>GitHub</a>
            <a href="#" style={{ color: "var(--text-muted)" }}>Docs</a>
            <a href="#" style={{ color: "var(--text-muted)" }}>Security</a>
            <a href="#" style={{ color: "var(--text-muted)" }}>Roadmap</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
Object.assign(window, { Landing });
