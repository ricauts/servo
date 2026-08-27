// Fictional desk data mirroring the demo dataset shipped by npm run demo.
window.DESK = {
  user: { name: "Ana Rodríguez", role: "ADMIN" },
  nav: [
    { href: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { href: "tickets", label: "Tickets", icon: "inbox", count: 15 },
    { href: "approvals", label: "Approvals", icon: "shield-check", count: 2, attention: true },
    { href: "groups", label: "Groups", icon: "users-2" },
    { href: "agents", label: "Agents", icon: "bot" },
    { href: "integrations", label: "Integrations", icon: "plug" },
    { href: "settings", label: "Settings", icon: "settings-2" },
  ],
  kpis: [
    { label: "Open tickets", value: "15" },
    { label: "Resolved · 30d", value: "24" },
    { label: "Avg first response", value: "37", unit: "min" },
    { label: "Avg resolution", value: "3.6", unit: "h" },
    { label: "AI resolution rate", value: "54", unit: "%" },
    { label: "Pending approvals", value: "2", highlight: "warn" },
    { label: "SLA breached", value: "15", highlight: "critical" },
  ],
  flow: [
    [1,0],[0,1],[1,1],[0,0],[1,1],[1,0],[0,1],[1,1],[0,0],[1,1],[2,1],[1,2],[0,1],[1,1],[1,0],
    [2,1],[1,1],[0,1],[1,2],[1,1],[2,1],[1,1],[3,2],[4,3],[4,4],[5,4],[4,4],[3,3],[2,2],[2,2]
  ],
  categories: [
    { label: "Hardware", n: 3 }, { label: "Software", n: 3 }, { label: "Network", n: 3 },
    { label: "Access & identity", n: 2 }, { label: "Database", n: 2 }, { label: "DevOps & cloud", n: 1 }, { label: "Other", n: 1 },
  ],
  priorities: [ { label: "Urgent", n: 1 }, { label: "High", n: 4 }, { label: "Medium", n: 8 }, { label: "Low", n: 2 } ],
  split: { ai: 13, human: 11 },
  replies: [ { label: "Sent as-is", n: 2, tone: "var(--chart-1)" }, { label: "Edited & sent", n: 1, tone: "var(--chart-4)" }, { label: "Discarded", n: 0, tone: "var(--critical)" }, { label: "Awaiting review", n: 6, tone: "var(--text-faint)" } ],
  tickets: [
    { number: 1061, title: "Star on GitHub button is unreadable on servoai.org", requester: "Dana Whitfield", status: "RESOLVED", priority: "MEDIUM", category: "Software", assignee: "Servo Resolver", assigneeIsAi: true, slaState: "met", slaLabel: "met", updated: "2h ago" },
    { number: 1058, title: "Account locked — can't sign in", requester: "Carla Méndez", status: "WAITING_APPROVAL", priority: "URGENT", category: "Access & identity", assignee: "Servo Resolver", assigneeIsAi: true, slaState: "at_risk", slaLabel: "22m left", updated: "8m ago" },
    { number: 1054, title: "Warehouse scanner drops Wi-Fi every few minutes", requester: "Hiro Tanaka", status: "IN_PROGRESS", priority: "HIGH", category: "Network", assignee: "Iris Volkov", slaState: "ok", slaLabel: "3h left", updated: "40m ago" },
    { number: 1049, title: "Add read-only reporting user to the billing database", requester: "Farid Khan", status: "WAITING_APPROVAL", priority: "MEDIUM", category: "Database", assignee: "Servo Resolver", assigneeIsAi: true, slaState: "ok", slaLabel: "5h left", updated: "1h ago" },
    { number: 1046, title: "Laptop replacement for the new analyst", requester: "Gabriela Torres", status: "TRIAGED", priority: "LOW", category: "Hardware", assignee: "Elena Duarte", slaState: "ok", slaLabel: "2d left", updated: "3h ago" },
    { number: 1041, title: "Nightly ETL job failed with a timeout", requester: "Bruno Chen", status: "OPEN", priority: "HIGH", category: "DevOps & cloud", assignee: null, slaState: "breached", slaLabel: "35m over", updated: "5h ago" },
    { number: 1038, title: "Shared mailbox not receiving external email", requester: "Diego Fontaine", status: "CLOSED", priority: "MEDIUM", category: "Software", assignee: "Bruno Chen", slaState: "met", slaLabel: "met", updated: "yesterday" },
  ],
  approvals: [
    { ticketNumber: 1061, ticketTitle: "Star on GitHub button is unreadable on servoai.org", toolName: "github_merge_pr", risk: "HIGH", requestedAt: "4m ago", blockedFor: "4m", agentName: "Frontend Agent", canDecide: false,
      impact: "Merging deploys to production through the repo's existing workflow.",
      toolInput: '{\n  "repo": "ricauts/servo",\n  "pr": 412,\n  "title": "fix(nav): restore dark label on Star on GitHub button"\n}',
      diff: [{ op: "-", text: ".nav-links a, .nav-cta { color: var(--muted); }" }, { op: "+", text: ".nav-links a { color: var(--muted); }" }] },
    { ticketNumber: 1049, ticketTitle: "Add read-only reporting user to the billing database", toolName: "sql_write", risk: "MEDIUM", requestedAt: "18m ago", blockedFor: "18m", agentName: "Analytics Agent", canDecide: true,
      impact: "Creates one read-only role on the ops database. No data is modified.",
      toolInput: '{\n  "database": "ops",\n  "statement": "CREATE USER reporting_ro WITH PASSWORD :pw;\\nGRANT SELECT ON billing.* TO reporting_ro;"\n}' },
  ],
  approvalStats: { pending: 2, avgWait: "11m", decidedToday: 6, approvedRate: 83, byRisk: [{ label: "High", n: 1, tone: "var(--critical-chip-ink)" }, { label: "Medium", n: 1, tone: "var(--warn-chip-ink)" }, { label: "Low", n: 0, tone: "var(--good-chip-ink)" }] },
  deciders: [ { name: "Ana Rodríguez", role: "ADMIN", scope: "Any risk level" }, { name: "Bruno Chen", role: "AGENT", scope: "Low & medium" }, { name: "Iris Volkov", role: "AGENT", scope: "Low & medium" } ],
  decided: [
    { n: 1061, tool: "github_edit_file", outcome: "Approved", by: "Ana Rodríguez", when: "2h ago", tone: "good" },
    { n: 1055, tool: "password_reset", outcome: "Approved", by: "Bruno Chen", when: "5h ago", tone: "good" },
    { n: 1052, tool: "cloud_apply", outcome: "Rejected", by: "Ana Rodríguez", when: "yesterday", tone: "critical" },
  ],
  agents: [
    { name: "Frontend Agent", categories: "Software", tools: 9, key: "anthropic · desk-frontend", tokens: "412k", enabled: true },
    { name: "Analytics Agent", categories: "Database, Other", tools: 6, key: "zai · glm-analytics", tokens: "268k", enabled: true },
    { name: "Developer Agent", categories: "Software, DevOps & cloud", tools: 11, key: "anthropic · desk-dev", tokens: "731k", enabled: true },
    { name: "Cybersecurity Agent", categories: "Access & identity, Network", tools: 7, key: "anthropic · desk-sec", tokens: "94k", enabled: false },
  ],
};
