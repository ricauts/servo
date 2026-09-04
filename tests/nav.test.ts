// ux-01: the nav registry is the single owner of navigation. navForUser is
// pure, so the role trees are unit-testable without a database; the two
// deleted hardcoded arrays must never come back.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NAV_ENTRIES, navForUser } from "@/components/shell/nav-items";
import { NAV_ICONS } from "@/components/shell/nav-icons";

const role = (r: "ADMIN" | "AGENT" | "REQUESTER" | "AI_AGENT") => ({ role: r });
const hrefs = (entries: ReturnType<typeof navForUser>) => entries.map((e) => e.href);

describe("navForUser — the four role trees", () => {
  it("a REQUESTER gets only My tickets and New request", () => {
    const entries = navForUser(role("REQUESTER"));
    expect(hrefs(entries)).toEqual(["/tickets", "/tickets/new"]);
    expect(entries.map((e) => e.label)).toEqual(["My tickets", "New request"]);
  });

  it("an AGENT gets the desk tree but no Integrations or Settings", () => {
    const entries = navForUser(role("AGENT"));
    expect(hrefs(entries)).not.toContain("/integrations");
    expect(hrefs(entries)).not.toContain("/settings");
    for (const href of ["/dashboard", "/tickets", "/approvals", "/groups", "/agents", "/runs", "/skills", "/kb"]) {
      expect(hrefs(entries)).toContain(href);
    }
  });

  it("an ADMIN gets everything", () => {
    expect(hrefs(navForUser(role("ADMIN")))).toEqual(hrefs(NAV_ENTRIES));
  });

  it("an AI_AGENT gets an empty list — agents never sign into the UI", () => {
    expect(navForUser(role("AI_AGENT"))).toEqual([]);
  });
});

describe("the registry itself", () => {
  it("names no marketplace entry and nothing referencing a hosted offering", () => {
    for (const entry of NAV_ENTRIES) {
      expect(entry.label.toLowerCase()).not.toContain("marketplace");
      expect(`${entry.href} ${entry.label}`.toLowerCase()).not.toMatch(/hosted|cloud|sign[ -]?up/);
    }
  });

  it("is the complete map of the app's pages", () => {
    // The admin tree includes the two adminOnly pages; the operator tree is
    // a strict subset. If a page is added without a NavEntry, this count is
    // where the drift shows first.
    expect(NAV_ENTRIES).toHaveLength(13); // + Knowledge (kb-16), + Runs (ux-05), + Sources (xds-09), + Packs (kb-lib-5)
  });

  it("addresses icons by name — entries cross the server/client boundary", () => {
    // Regression rail for a production crash: NavEntry.icon once held the
    // lucide component itself, and React cannot serialize functions, so the
    // server layout handing entries to the client SidebarNav/CommandPalette
    // killed every authenticated page with "Functions cannot be passed
    // directly to Client Components". Icons must stay names, resolved to
    // components only where they are rendered (nav-icons.ts).
    for (const entry of NAV_ENTRIES) {
      expect(
        typeof entry.icon,
        `${entry.href} carries a component instead of an icon name`,
      ).toBe("string");
      expect(entry.icon in NAV_ICONS, `NAV_ICONS is missing "${entry.icon}"`).toBe(true);
    }
    // And the map carries no dead icons.
    expect(new Set(NAV_ENTRIES.map((e) => e.icon)).size).toBe(
      Object.keys(NAV_ICONS).length,
    );
  });
});

describe("the hardcoded arrays must not return (ux-01)", () => {
  it("SidebarNav.tsx carries no static item list and CommandPalette.tsx no PAGES array", () => {
    const sidebarNav = readFileSync("src/components/shell/SidebarNav.tsx", "utf8");
    expect(
      sidebarNav.includes("const items: NavItem[]"),
      "SidebarNav.tsx regrew a static nav array — add a NavEntry to nav-items.ts instead",
    ).toBe(false);
    expect(sidebarNav.includes('href: "/dashboard"'), "SidebarNav.tsx hardcodes an href").toBe(
      false,
    );

    const palette = readFileSync("src/components/shell/CommandPalette.tsx", "utf8");
    expect(
      palette.includes("const PAGES"),
      "CommandPalette.tsx regrew the PAGES array — it renders the registry entries prop",
    ).toBe(false);
    expect(palette.includes('href: "/dashboard"'), "CommandPalette.tsx hardcodes an href").toBe(
      false,
    );
  });
});
