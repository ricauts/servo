repo: ricauts/Servo
branch: main

## Last sync

date: 2026-08-14T01:58:00Z

### Updated in this project

- Built the Servo design system from the repo: tokens, 30 components, foundation cards.
- New dark-first brand direction (Chivo + IBM Plex Mono, signal green on near-black).
- Recreated the desk app (dashboard, queue, ticket detail, approvals, agents) as a UI kit.
- Recreated the servoai.org landing page as a UI kit.

## Screen map

| Screen | Built from |
|---|---|
| `ui_kits/desk/index.html` (router, shell) | `src/app/layout.tsx`, `src/components/shell/Sidebar.tsx`, `SidebarNav.tsx`, `CommandPalette.tsx` |
| `ui_kits/desk/Screens.jsx` → Dashboard | `src/app/dashboard/`, `src/components/dashboard/{StatTile,AiVsHumanBar,CategoryBars,PriorityBars,FlowChart,DraftRepliesTile,ApprovalsTile}.tsx` |
| `ui_kits/desk/Screens.jsx` → Tickets | `src/app/tickets/`, `src/components/tickets/{TicketsTable,TicketFilters,SlaBadge}.tsx`, `src/lib/labels.ts` |
| `ui_kits/desk/Screens.jsx` → Ticket detail | `src/components/tickets/{Timeline,RunGroup,ReplyDraftCard,PropertiesPanel,AttachmentGallery,EscalatePanel}.tsx` |
| `ui_kits/desk/Screens.jsx` → Approvals | `src/app/approvals/`, `src/components/admin/{ApprovalCard,ApprovalHistoryTable,DraftQueueCard}.tsx` |
| `ui_kits/desk/Screens.jsx` → Agents | `src/app/agents/`, `src/components/agents/AgentsManager.tsx`, `agents/*.md` |
| `ui_kits/site/Landing.jsx` | `README.md` (features, quickstart), landing page visible in `docs/assets/screenshot-ticket-detail.png` |
| `tokens/*.css` | `src/app/globals.css`, `docs/DESIGN.md` |
| `components/core/*`, `components/product/*` | `src/components/{ui,legacy,shell,tickets,dashboard,admin}/*` |
