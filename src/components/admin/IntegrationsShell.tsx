"use client";

// Master-detail shell for /integrations — a thin wrapper over the shared
// MasterDetail: it owns the per-integration icons and hands the page's
// sections through. Every section stays mounted so unsaved edits survive
// switching; the selection is mirrored to `?section=<id>` so the Packs
// catalog links straight to a form and Back returns to it.

import type { ReactNode } from "react";
import {
  Cloud,
  GitBranch,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  Plug2,
  Server,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import MasterDetail from "@/components/common/MasterDetail";

const ICONS: Record<string, LucideIcon> = {
  sso: KeyRound,
  smtp: Mail,
  inbound: Inbox,
  github: GitBranch,
  azure: Cloud,
  webhooks: Webhook,
  egress: Globe,
  mcp: Plug2,
  "mcp-servers": Server,
};

export interface IntegrationSection {
  id: string;
  title: string;
  /** Detail-pane description — the long, honest sentence. */
  blurb: string;
  /** One-line rail subtitle; falls back to the blurb, truncated. */
  subtitle?: string;
  /** Extra rail-search terms (provider names, tool names…). */
  keywords?: string[];
  status: { label: string; tone: "good" | "brand" | "neutral" | "warn" };
  body: ReactNode;
}

export default function IntegrationsShell({
  sections,
  initialId,
}: {
  sections: IntegrationSection[];
  /** kb-lib-5: `/integrations?section=<id>` opens that section — the Packs
   *  catalog links straight to the form it describes. */
  initialId?: string;
}) {
  return (
    <MasterDetail
      title="Integrations"
      param="section"
      initialId={initialId}
      keepMounted
      items={sections.map((section) => {
        const Icon = ICONS[section.id] ?? Plug2;
        return {
          id: section.id,
          title: section.title,
          subtitle: section.subtitle ?? section.blurb,
          description: section.blurb,
          icon: <Icon size={16} />,
          status: section.status,
          keywords: section.keywords,
          body: section.body,
        };
      })}
    />
  );
}
