"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import SidebarNav from "@/components/shell/SidebarNav";
import UserSwitcher from "@/components/shell/UserSwitcher";
import ThemeToggle from "@/components/shell/ThemeToggle";
import type { NavEntry } from "@/components/shell/nav-items";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface SwitcherUser {
  id: string;
  name: string;
  role: string;
  color: string;
}

export default function MobileTopbar({
  entries,
  counts,
  hideSwitcher = false,
  users,
  currentUserId,
}: {
  /** The registry filtered by the server — same single owner as the sidebar. */
  entries: NavEntry[];
  counts?: { tickets: number; approvals?: number };
  hideSwitcher?: boolean;
  users: SwitcherUser[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 py-2.5 text-sidebar-foreground md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation"
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-sidebar-accent"
          >
            <Menu size={18} />
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="px-5 pb-2 pt-5">
            <SheetTitle className="text-left font-heading text-[22px] font-black leading-none tracking-tight text-sidebar-foreground">
              Servo<span className="text-primary">.</span>
            </SheetTitle>
          </SheetHeader>
          <SidebarNav entries={entries} counts={counts} onNavigate={() => setOpen(false)} />
          {!hideSwitcher && (
            <div className="mt-auto border-t border-sidebar-border p-3">
              <UserSwitcher users={users} currentUserId={currentUserId} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <div className="font-heading text-lg font-black leading-none tracking-tight">
        Servo<span className="text-primary">.</span>
      </div>

      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  );
}
