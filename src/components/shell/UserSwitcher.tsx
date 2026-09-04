"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import Avatar from "@/components/common/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SwitcherUser {
  id: string;
  name: string;
  role: string;
  color: string;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  AGENT: "Agent",
  REQUESTER: "Requester",
};

export default function UserSwitcher({
  users,
  currentUserId,
}: {
  users: SwitcherUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = users.find((u) => u.id === currentUserId) ?? users[0];

  async function switchTo(userId: string) {
    await fetch("/api/auth/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    startTransition(() => router.refresh());
  }

  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={pending}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
          title="Switch demo user"
        >
          <Avatar name={current.name} color={current.color} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-heading text-[13px] font-medium text-text-strong">
              {current.name}
            </span>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-text-faint">
              {ROLE_LABEL[current.role] ?? current.role}
            </span>
          </span>
          <ChevronsUpDown size={14} className="text-text-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuLabel className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
          Switch demo user
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {users.map((u) => (
          <DropdownMenuItem
            key={u.id}
            onSelect={() => switchTo(u.id)}
            className="gap-2.5"
          >
            <Avatar name={u.name} color={u.color} size={22} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{u.name}</span>
              <span className="block font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                {ROLE_LABEL[u.role] ?? u.role}
              </span>
            </span>
            {u.id === currentUserId && (
              <Check size={14} className="text-primary-strong" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
