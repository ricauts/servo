# Plugins — local bundles

A plugin is a local bundle under `plugins/<dir>/` that ships procedures,
agent profiles and MCP server entries together. Installing one is placing
the directory: `syncPlugins()` is the one installation system, run at
setup beside the bundled-skills sync.

## Bundle layout

```
plugins/
  my-plugin/
    .claude-plugin/plugin.json   # name (required, kebab-case); version, description optional
    skills/<dir>/SKILL.md        # Agent Skills shape, lenient parse
    agents/<dir>/profile.md      # the agent-profile format
    .mcp.json                    # optional MCP server entries
```

A malformed manifest, skill or profile is skipped with the reason named in
the sync report — a broken plugin never blocks boot.

## Disabled by default, namespaced always

Everything a plugin ships arrives **disabled**: skills
(`Skill.enabled=false`), agent profiles (`AgentProfile.enabled=false`) and
MCP servers (`McpServer.enabled=false`, the quarantine default described
in [connectors.md](connectors.md)). Installing enables nothing; an admin
promotes plugin content deliberately, item by item.

Plugin content is namespaced: a skill directory `greet` in plugin
`fixture-demo` lands as the slug `fixture-demo--greet`, and its
provenance is recorded as `origin: "plugin:fixture-demo"`. Two plugins
cannot collide with each other, and plugin content cannot shadow a
bundled skill.

`.mcp.json` entries become **disabled** `McpServer` rows through the same
model the admin UI uses — a plugin-shipped server behaves exactly like a
manually added one: the egress rules apply, and its tools arrive
quarantined with the high-risk approval triple on first sync.

Re-running the sync never reverts an admin's edits: promotion is
create-only.

## Remote install

Remote plugin installation — fetching a bundle from a registry — is
[Roadmap](../ROADMAP.md). v1 installs from the local filesystem only.
