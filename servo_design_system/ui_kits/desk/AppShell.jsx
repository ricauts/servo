const { SidebarNav, Wordmark, Icon, Avatar, Button, CommandPalette } = window.ServoDesignSystem_824c45;

function AppShell({ route, onRoute, children }) {
  const [cmdk, setCmdk] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { document.body.classList.toggle("servo-light", !dark); }, [dark]);
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk((v) => !v); }
      if (e.key === "Escape") setCmdk(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <aside className="svo-sidepanel" style={{ width: "var(--sidebar-w)", flex: "none", display: "flex", flexDirection: "column", borderRight: "1px solid var(--line)", position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 20px 22px" }}>
          <Wordmark size={26} tagline="open-source ticketing" color="var(--text-strong)" />
          <Button variant="ghost" size="sm" icon title={dark ? "Light mode" : "Dark mode"} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setDark((v) => !v)}>
            <Icon name={dark ? "sun" : "moon"} size={14} />
          </Button>
        </div>
        <SidebarNav items={window.DESK.nav} active={route} onNavigate={onRoute} />
        <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={() => setCmdk(true)} className="svo-navitem" style={{ justifyContent: "flex-start" }}>
            <Icon name="search" size={15} /><span style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}>Search &amp; jump</span>
            <span className="svo-kbd" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>Ctrl K</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 8px" }}>
            <Avatar name={window.DESK.user.name} size={28} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: "var(--text-ui)", fontWeight: 500, color: "var(--text-strong)" }}>{window.DESK.user.name}</span>
              <span className="lbl" style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".14em", color: "var(--text-faint)" }}>{window.DESK.user.role}</span>
            </span>
            <Icon name="log-out" size={15} color="var(--text-faint)" />
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>

      {cmdk && (
        <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "start center", paddingTop: "12vh", zIndex: 20 }}>
          <div className="svo-scrim" style={{ position: "fixed" }} onClick={() => setCmdk(false)} />
          <div style={{ position: "relative", width: "min(560px,90vw)" }}>
            <CommandPalette
              query=""
              activeIndex={0}
              onSelect={(it) => { setCmdk(false); if (it.route) onRoute(it.route); }}
              groups={[
                { label: "Tickets", items: window.DESK.tickets.slice(0, 3).map((t) => ({ number: t.number, label: t.title, route: "ticket" })) },
                { label: "Jump to", items: [{ label: "Approvals", icon: "shield-check", route: "approvals" }, { label: "Agents", icon: "bot", route: "agents" }, { label: "Dashboard", icon: "layout-dashboard", route: "dashboard" }] },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
Object.assign(window, { AppShell });
