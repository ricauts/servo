"use client";

// Master-detail shell for /integrations: a left rail listing every
// integration with its live status, one detail panel on the right. Replaces
// the old stacked-cards page that scrolled forever and wasted the viewport.

import { useState, type ReactNode } from "react";
import {
  Cloud,
  GitBranch,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  Plug2,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Badge from "@/components/common/Badge";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  sso: KeyRound,
  smtp: Mail,
  inbound: Inbox,
  github: GitBranch,
  azure: Cloud,
  webhooks: Webhook,
  egress: Globe,
  mcp: Plug2,
};

export interface IntegrationSection {
  id: string;
  title: string;
  blurb: string;
  status: { label: string; tone: "good" | "brand" | "neutral" | "warn" };
  body: ReactNode;
}

export default function IntegrationsShell({
  sections,
}: {
  sections: IntegrationSection[];
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id);
  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:p-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start xl:h-[calc(100vh-97px)] xl:overflow-hidden">
      {/* Rail */}
      <nav
        aria-label="Integrations"
        className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-x-visible"
      >
        {sections.map((section) => {
          const Icon = ICONS[section.id] ?? Plug2;
          const selected = section.id === active?.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveId(section.id)}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors lg:w-full",
                selected
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:bg-muted/60",
              )}
            >
              <Icon
                size={16}
                className={selected ? "text-primary-strong" : "text-muted-foreground"}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate font-heading text-[13px] font-semibold",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {section.title}
                </span>
              </span>
              <Badge tone={section.status.tone}>{section.status.label}</Badge>
            </button>
          );
        })}
      </nav>

      {/* Detail panel */}
      <Card className="min-h-0 xl:flex xl:h-full xl:flex-col">
        <CardHeader>
          <CardTitle className="font-heading">{active?.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{active?.blurb}</p>
        </CardHeader>
        <CardContent className="min-h-0 xl:flex-1 xl:overflow-y-auto">
          {/* Every section stays mounted so unsaved edits survive switching. */}
          {sections.map((section) => (
            <div key={section.id} hidden={section.id !== active?.id}>
              {section.body}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
