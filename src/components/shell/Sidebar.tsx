import { LogOut } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { getAuthConfig, needsSetup, signOut } from "@/lib/authjs";
import { can } from "@/lib/permissions";
import Avatar from "@/components/common/Avatar";
import SidebarNav from "@/components/shell/SidebarNav";
import UserSwitcher from "@/components/shell/UserSwitcher";
import ThemeToggle from "@/components/shell/ThemeToggle";
import MobileTopbar from "@/components/shell/MobileTopbar";
import { navForUser } from "@/components/shell/nav-items";

export default async function Sidebar() {
  // On /setup (fresh install) or /login (no session) the shell hides itself.
  if (await needsSetup()) return null;
  const user = await getCurrentUserOrNull();
  if (!user) return null;

  const config = await getAuthConfig();
  const ssoMode = config.mode === "oidc";

  // Counts are role-scoped (§9.2): a requester sees their OWN open tickets
  // and no approvals chip at all — global queue numbers never reach them.
  const seesApprovals = can(user, "approval.view");
  const [pendingApprovals, openTickets, users] = await Promise.all([
    seesApprovals
      ? db.approval.count({ where: { status: "PENDING" } })
      : Promise.resolve(undefined),
    db.ticket.count({
      where: {
        status: { notIn: ["RESOLVED", "CLOSED"] },
        ...(user.role === "REQUESTER" ? { requesterId: user.id } : {}),
      },
    }),
    ssoMode
      ? Promise.resolve([])
      : db.user.findMany({
          where: { role: { notIn: ["AI_AGENT"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, role: true, color: true },
        }),
  ]);
  const counts = { tickets: openTickets, approvals: pendingApprovals };
  const entries = navForUser(user);

  return (
    <>
      <MobileTopbar
        entries={entries}
        counts={counts}
        users={users}
        currentUserId={user.id}
        hideSwitcher={ssoMode}
      />
      {/* The ds sidebar: a fixed 240px panel, sticky full height, hairline
          on the right; the wordmark (Chivo black, brand period) with its
          mono tagline; ink from the text ramp, never an alpha of it. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-start justify-between px-5 pb-6 pt-6">
          <div>
            <div className="font-heading text-[26px] font-black leading-none tracking-[-0.04em] text-text-strong">
              Servo<span className="text-primary">.</span>
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
              AI desk for the team
            </div>
          </div>
          <ThemeToggle />
        </div>

        <SidebarNav entries={entries} counts={counts} />

        <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border p-3">
          <p className="px-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
            Search & jump{" "}
            <kbd className="ml-1 rounded border border-line-strong bg-surface-2 px-1 py-px font-mono text-[9.5px] normal-case tracking-normal text-text-muted">
              Ctrl K
            </kbd>
          </p>
          {ssoMode ? (
            <div className="flex items-center gap-2.5 px-2 py-1">
              <Avatar name={user.name} color={user.color} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-[13px] font-medium text-text-strong">
                  {user.name}
                </span>
                <span className="block font-mono text-[10px] uppercase tracking-wider text-text-faint">
                  {user.role}
                </span>
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  title="Sign out"
                  aria-label="Sign out"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
                >
                  <LogOut size={15} />
                </button>
              </form>
            </div>
          ) : (
            <UserSwitcher users={users} currentUserId={user.id} />
          )}
        </div>
      </aside>
    </>
  );
}
