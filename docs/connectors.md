# Connectors — MCP servers

How Servo talks to external tool servers over the Model Context Protocol,
and the gates every imported tool passes before an agent may call it.

## Adding a server

An admin adds an MCP server under **Settings → Integrations** (or
`POST /api/mcp-servers`): a slug, a display name, and the server's
Streamable HTTP URL. v1 speaks the `http` transport only; `stdio` and
OAuth are [Roadmap](../ROADMAP.md). A server may carry headers and a
sealed secret — the secret is sealed at rest and opened only inside the
client at call time; it is never returned by any API.

The first sync calls `tools/list` and snapshots what the server reports.
The snapshot is compared on every later sync: a tool whose
`sha256(name + description + inputSchema)` changed is treated as a new
definition.

## The quarantine default

Every imported tool arrives quarantined, with no exception:

- `enabled: false` — invisible to every agent until an admin enables it.
- `requiresApproval: true` — even once enabled, each call pauses the run
  for a human decision.
- `riskLevel: "HIGH"` — the approval queue shows it as high-risk.

A risk level the server *declares* about its own tools is recorded beside
the policy, for the audit trail, and **ignored**: the server's claims
about its own risk are data, never policy.

## How `requiresApproval` pauses a run

When an agent calls a gated tool, the run and its ticket enter
`WAITING_APPROVAL` *before* the tool executes: an Approval row carries the
exact input and the conversation's own tool-use id. An approver sees the
input verbatim in the queue; approving resumes the run and the call then
executes exactly once; rejecting collapses the script to an acknowledge
and resolve. Nothing about the gate depends on the tool's kind — built-in
and imported tools ride the same rail.

## Egress and private hosts

Outbound requests to a configured server go through the egress guard. A
loopback or private address is refused unless an admin names the host
exactly in the egress allowlist (`integration.egress.allowlist`) — the
same rule a real internal MCP server needs, with no wildcard form. A
server URL is also refused outright when it is not `http`/`https`, carries
credentials, or points at a host outside loopback, RFC1918/ULA or a
compose service name.
