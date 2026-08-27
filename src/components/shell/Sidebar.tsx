import { LogOut } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { getAuthConfig, needsSetup, signOut } from "@/lib/authjs";
import { can } from "@/lib/permissions";
import Avatar from "@/components/legacy/Avatar";
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-start justify-between px-5 pb-6 pt-6">
        <div>
          <div className="font-heading text-[26px] font-black leading-none tracking-tight">
            Servo<span className="text-primary">.</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">
            AI service desk
          </div>
        </div>
        <ThemeToggle />
      </div>

      <SidebarNav entries={entries} counts={counts} />

        <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border p-3">
          <p className="px-2 font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
            Search & jump{" "}
            <kbd className="ml-1 rounded border border-sidebar-border bg-sidebar-accent px-1 py-px text-[9.5px] normal-case text-sidebar-foreground/80">
              Ctrl K
            </kbd>
          </p>
          {ssoMode ? (
            <div className="flex items-center gap-2.5 px-2 py-1">
              <Avatar name={user.name} color={user.color} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-[13px] font-medium">
                  {user.name}
                </span>
                <span className="block font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
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
                  className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
