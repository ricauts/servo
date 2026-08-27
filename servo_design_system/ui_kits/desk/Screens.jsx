const { PageHeader, StatTile, Card, TicketsTable, ApprovalCard, ReplyDraftCard, RunSummary, RunStep, TimelineEntry, Badge, Button, Icon, Select, Field, Switch, Tabs, EmptyState, Avatar, Table, Separator, Input } = window.ServoDesignSystem_824c45;
const D = window.DESK;
const PAD = { padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: "var(--space-7)" };

function DashboardScreen() {
  return (
    <div>
      <PageHeader eyebrow="Last 30 days" title="Dashboard" subtitle="Operational KPIs across tickets, agents and approvals." />
      <div style={PAD}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 10 }}>
          {D.kpis.map((k) => <StatTile key={k.label} {...k} />)}
        </div>
        <div style={{ borderTop: "1px solid var(--line)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
          <Card title="Ticket flow — last 30 days" action={<span style={{ display: "flex", gap: 14, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-2)" }} />Created</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-1)" }} />Resolved</span></span>}>
            <AreaFlow data={D.flow} />
          </Card>
          <Card title="Open load by category"><BarList rows={D.categories} /></Card>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Card title="By priority"><BarList rows={D.priorities} /></Card>
          <Card title="AI vs human resolutions"><Donut ai={D.split.ai} human={D.split.human} /></Card>
          <Card title="AI replies — 30d" description="How much typing the desk saved.">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em", color: "var(--text-brand)" }}>67%</span>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>accepted as-is</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {D.replies.map((r) => (
                <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-ui)", color: "var(--text-muted)", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: r.tone }} />
                  <span style={{ flex: 1 }}>{r.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-strong)" }}>{r.n}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TicketsScreen({ onOpen }) {
  const [status, setStatus] = React.useState("All statuses");
  const rows = D.tickets.filter((t) => status === "All statuses" || t.status === status.toUpperCase().replace(/ /g, "_"));
  return (
    <div>
      <PageHeader title="Tickets" subtitle="Every request in the desk, human- and AI-assigned."
        actions={<><Button variant="outline" size="md" iconStart={<Icon name="filter" size={14} />}>Filters</Button><Button variant="primary" size="md" iconStart={<Icon name="plus" size={14} />}>New ticket</Button></>} />
      <div style={PAD}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ width: 210 }}><Input placeholder="Search by number, title or text…" /></span>
          <span style={{ width: 170 }}><Select value={status} onChange={(e) => setStatus(e.target.value)} options={["All statuses", "Open", "Triaged", "In progress", "Waiting approval", "Resolved", "Closed"]} /></span>
          <span style={{ width: 150 }}><Select options={["All priorities", "Urgent", "High", "Medium", "Low"]} /></span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-faint)" }}>{rows.length} of {D.tickets.length} shown</span>
        </div>
        <Card padded={false} style={{ overflow: "hidden" }}>
          {rows.length ? <TicketsTable rows={rows} onRowClick={(t) => onOpen(t)} /> : <div style={{ padding: 16 }}><EmptyState icon="inbox" title="No tickets match">Clear a filter to see the rest of the queue.</EmptyState></div>}
        </Card>
      </div>
    </div>
  );
}

function TicketDetailScreen({ ticket, onBack }) {
  const t = ticket || D.tickets[0];
  const [draft, setDraft] = React.useState("Hi Dana,\n\nThanks for flagging the contrast issue with the \"Star on GitHub\" button — the label was rendering grey instead of the intended dark ink, which is why it was so hard to read. The fix is committed on a branch and a screenshot of the result is attached to this ticket, so you can see it before it ships.\n\nI'll follow up here once it's merged and live.");
  const [sent, setSent] = React.useState(false);
  return (
    <div>
      <div style={{ padding: "var(--space-8) var(--page-pad) 0" }}>
        <button className="svo-btn v-ghost sz-sm" onClick={onBack} style={{ paddingLeft: 0 }}><Icon name="arrow-left" size={14} /><span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", letterSpacing: ".14em", textTransform: "uppercase" }}>Tickets</span></button>
      </div>
      <div style={{ padding: "var(--space-6) var(--page-pad) var(--space-8)", borderBottom: "1px solid var(--line)" }}>
        <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-.015em" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-brand)", marginRight: 12 }}>#{t.number}</span>{t.title}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
          <Badge tone="good">Resolved</Badge><Badge tone="brand">Medium</Badge><Badge tone="neutral">Software</Badge><Badge tone="neutral">Development</Badge><Badge tone="good">SLA met · resolution</Badge>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            <Avatar name={t.requester} size={20} />{t.requester} · opened 2h ago · updated 2h ago
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: "var(--space-8)", padding: "var(--page-pad)", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-7)" }}>
          <Card title="Screenshots (2)" description="Captured by an agent while working this ticket — review these before approving a change.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[["Before — live site: the button label is barely readable", "var(--text-faint)"], ["After — rendered from the fix branch, before it is merged", "var(--brand-ink)"]].map(([cap, ink], i) => (
                <figure key={i} style={{ margin: 0 }}>
                  <div className="svo-sidepanel" style={{ height: 132, borderRadius: "var(--radius-3)", border: "1px solid var(--line)", background: "var(--ink-950)", backgroundImage: "var(--dot-grid)", backgroundSize: "18px 18px", padding: 12, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 13, letterSpacing: "-.04em", color: "var(--text-strong)" }}>Servo<span style={{ color: "var(--brand)" }}>.</span></span>
                      <span style={{ background: "var(--brand)", color: ink, fontSize: 9, padding: "3px 7px", borderRadius: 4, fontWeight: 600 }}>★ Star on GitHub</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", color: "var(--text-strong)", lineHeight: 1.15 }}>Ticketing your whole team<br />works in — <span style={{ color: "var(--brand)" }}>with nobody waiting.</span></div>
                  </div>
                  <figcaption style={{ marginTop: 8, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{cap} · 2h ago</figcaption>
                </figure>
              ))}
            </div>
          </Card>

          {!sent ? (
            <ReplyDraftCard draftedBy="Developer Agent" when="2h ago" recipient={t.requester} value={draft} onChange={setDraft} onApprove={() => setSent(true)} onDiscard={() => setSent(true)} />
          ) : (
            <TimelineEntry author="Ana Rodríguez" action="sent the AI reply" when="just now">{draft}</TimelineEntry>
          )}

          <TimelineEntry author={t.requester} action="opened this ticket" when="2h ago">
            {"Hi team,\n\nOn the servoai.org landing page the \"Star on GitHub\" button in the top navigation has text I can barely read - it looks like grey text on the green button. Everything else on the page reads fine."}
          </TimelineEntry>
          <TimelineEntry author="Servo Triage" isAi badge={{ tone: "brand", label: "AI" }} action="triaged this ticket" when="2h ago" system>
            Category Software · priority Medium · routed to the Frontend Agent (matches available tools).
          </TimelineEntry>
          <RunSummary agentName="Frontend Agent" status="COMPLETED" qaVerdict="PASS" qaNotes="Contrast fix verified at 9.4:1; no unrelated files touched." took="42s" when="2h ago" stepCount={9} open={false}
            summary="Read the nav styles, found the rule overriding the dark label ink, committed the fix on a branch, captured before/after screenshots and opened a PR."
            toolTrail={["github_read_file ×2", "github_edit_file", "take_screenshot ×2", "github_open_pr"]} decisions={[{ approved: true, by: "Ana" }]}>
            <RunStep kind="thought">The .nav-links colour rule cascades over the button label; scope it to links only.</RunStep>
            <RunStep kind="tool"><pre className="svo-code">github_edit_file · servoai-site/styles.css</pre></RunStep>
            <RunStep kind="result">Committed on fix/nav-contrast · 1 file changed</RunStep>
          </RunSummary>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: "var(--space-7)", position: "sticky", top: "var(--space-7)" }}>
          <Card title="Properties">
            <Field label="Status"><Select options={["Open", "Triaged", "In progress", "Waiting approval", "Resolved", "Closed"]} defaultValue="Resolved" /></Field>
            <Field label="Priority"><Select options={["Low", "Medium", "High", "Urgent"]} defaultValue="Medium" /></Field>
            <Field label="Category"><Select options={["Software", "Hardware", "Network", "Database"]} defaultValue="Software" /></Field>
            <Field label="Assignee"><Select options={["Servo Resolver (AI)", "Ana Rodríguez", "Bruno Chen"]} defaultValue="Servo Resolver (AI)" /></Field>
          </Card>
          <Card title="Group & escalation" action={<Badge tone="neutral">Junior tier</Badge>}>
            <div style={{ fontSize: "var(--text-ui)", color: "var(--text-body)" }}>Development</div>
            <Button variant="outline" size="sm" iconStart={<Icon name="arrow-up-right" size={14} />}>Escalate a tier</Button>
          </Card>
          <Card title="AI resolver" description="Works the ticket with tools and pauses for human approval on risky actions.">
            <Button variant="primary" iconStart={<Icon name="sparkles" size={14} />}>Run AI resolver</Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ApprovalsScreen() {
  const [tab, setTab] = React.useState("pending");
  const [decided, setDecided] = React.useState([]);
  const pending = D.approvals.filter((a) => !decided.includes(a.ticketNumber));
  const st = D.approvalStats;
  return (
    <div>
      <PageHeader eyebrow={pending.length + " runs paused · oldest waiting 18m"} title="Approvals"
        subtitle="Work stops here until a human decides. Everything on this page is time somebody is waiting."
        actions={<><Button variant="outline" size="md" iconStart={<Icon name="bell" size={14} />}>Notify deciders</Button><Button variant="primary" size="md" iconStart={<Icon name="check-check" size={14} />}>Approve all low risk</Button></>} />
      <div style={PAD}>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "pending", label: "Pending", count: pending.length }, { value: "history", label: "History", count: st.decidedToday }]} />
        {tab === "pending" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: "var(--space-7)", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-7)" }}>
              {pending.length ? pending.map((a) => (
                <ApprovalCard key={a.ticketNumber} {...a} onApprove={() => setDecided((d) => [...d, a.ticketNumber])} onReject={() => setDecided((d) => [...d, a.ticketNumber])} />
              )) : <EmptyState icon="shield-check" title="Nothing waiting">Approvals land here when an agent reaches a gated tool, or drafts a reply.</EmptyState>}
            </div>
            <aside style={{ display: "flex", flexDirection: "column", gap: "var(--space-7)", position: "sticky", top: "var(--space-7)" }}>
              <Card title="What's blocked" description={"Average wait " + st.avgWait + " · " + st.approvedRate + "% approved"}>
                <div className="svo-meter">
                  {st.byRisk.filter((b) => b.n).map((b) => <span key={b.label} style={{ background: b.tone, flex: b.n }} />)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {st.byRisk.map((b) => (
                    <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: b.tone, opacity: b.n ? 1 : .3 }} />
                      <span style={{ flex: 1 }}>{b.label} risk</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: b.n ? "var(--text-strong)" : "var(--text-faint)" }}>{b.n}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Who can decide">
                {D.deciders.map((p) => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={p.name} size={24} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: "var(--text-ui)", color: "var(--text-strong)" }}>{p.name}</span>
                      <span style={{ display: "block", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{p.scope}</span>
                    </span>
                    <Badge tone={p.role === "ADMIN" ? "brand" : "neutral"} quiet>{p.role}</Badge>
                  </div>
                ))}
              </Card>
              <Card title="Recently decided">
                {D.decided.map((h) => (
                  <div key={h.n} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}>#{h.n}</span>
                    <span style={{ flex: 1, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.tool}</span>
                    <Badge tone={h.tone} quiet>{h.outcome}</Badge>
                  </div>
                ))}
              </Card>
            </aside>
          </div>
        ) : (
          <Card padded={false} style={{ overflow: "hidden" }}>
            <Table columns={[
              { key: "n", label: "#", mono: true }, { key: "tool", label: "Tool" },
              { key: "risk", label: "Risk", render: (r) => <Badge tone={r.riskTone}>{r.risk}</Badge> },
              { key: "outcome", label: "Outcome", render: (r) => <Badge tone={r.tone}>{r.outcome}</Badge> },
              { key: "by", label: "Decided by" }, { key: "when", label: "When", align: "right" }]}
              rows={D.decided.map((h) => ({ ...h, n: "#" + h.n, risk: h.tool === "cloud_apply" ? "High" : "Medium", riskTone: h.tool === "cloud_apply" ? "critical" : "warn" }))} />
          </Card>
        )}
      </div>
    </div>
  );
}

function AgentsScreen() {
  const [agents, setAgents] = React.useState(D.agents);
  return (
    <div>
      <PageHeader title="Agents" subtitle="Specialised resolver personas, their tools and their throughput."
        actions={<Button variant="primary" size="md" iconStart={<Icon name="plus" size={14} />}>New agent</Button>} />
      <div style={PAD}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {agents.map((a, i) => (
            <Card key={a.name} title={a.name} description={a.categories}
              action={<Switch checked={a.enabled} onChange={(v) => setAgents((prev) => prev.map((p, j) => j === i ? { ...p, enabled: v } : p))} />}
              footer={<><Badge tone="neutral">{a.tools} tools</Badge><span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", color: "var(--text-faint)" }}>{a.key}</span><span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", color: "var(--text-muted)" }}>{a.tokens} tok · 7d</span></>}>
              <pre className="svo-code" style={{ fontSize: "var(--text-mono-xs)" }}>{"---\nname: " + a.name + "\ncategories: [" + a.categories + "]\n---"}</pre>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {["github_read_file", "github_edit_file", "take_screenshot", "sql_read"].map((t) => <Badge key={t} tone={t.includes("edit") ? "warn" : "good"} square>{t}</Badge>)}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function StubScreen({ title }) {
  return (
    <div>
      <PageHeader title={title} subtitle="Not recreated in this kit." />
      <div style={PAD}><EmptyState icon="construction" title={title + " is out of scope for this kit"}>Only the desk's core surfaces — dashboard, queue, ticket detail, approvals and agents — are recreated here.</EmptyState></div>
    </div>
  );
}
Object.assign(window, { DashboardScreen, TicketsScreen, TicketDetailScreen, ApprovalsScreen, AgentsScreen, StubScreen });
