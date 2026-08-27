# Desk app UI kit

A click-through recreation of Servo's service desk (the Next.js app in
`src/app` of [ricauts/Servo](https://github.com/ricauts/Servo)), rebranded onto
the dark Servo identity in this design system. Open `index.html`.

| File | What it holds |
|---|---|
| `index.html` | Loads the bundle + Lucide, holds the router (dashboard → tickets → ticket detail → approvals → agents) |
| `AppShell.jsx` | Sidebar shell: wordmark, `SidebarNav`, user footer, ⌘/Ctrl-K palette |
| `Screens.jsx` | The five screens, composed from the design system's components |
| `Charts.jsx` | Cosmetic SVG stand-ins for the app's Recharts charts (same `--chart-*` order) |
| `data.js` | Fictional demo data modelled on `npm run demo` |

Interactions that work: nav, ⌘K palette (jump to a ticket or page), queue
filtering, opening a ticket, editing and sending the AI reply draft, approving or
rejecting a gated tool, toggling an agent on and off.

Sources: `src/app/dashboard`, `src/app/tickets`, `src/app/approvals`,
`src/app/agents`, `src/components/{shell,tickets,dashboard,admin}`.
Groups, Integrations and Settings are intentionally stubbed.
