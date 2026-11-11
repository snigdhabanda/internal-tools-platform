"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Avatar } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Option = { id: string; name: string; email: string; roles: string[] };

/** Mock sign-in: picks the current user (stored in a cookie by POST /api/session). */
export function UserSwitcher({ users, currentId }: { users: Option[]; currentId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = users.find((u) => u.id === currentId) ?? null;

  async function choose(userId: string) {
    if (userId === currentId) return;
    await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="user-switcher" disabled={pending} className="h-auto gap-3 py-1.5 pl-1.5 pr-2.5">
          {current ? <Avatar name={current.name} /> : <span className="size-8 rounded-full bg-muted" />}
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight">{current?.name ?? "Choose a user"}</span>
            <span className="block text-xs font-normal capitalize leading-tight text-muted-foreground">{current ? current.roles.join(" · ") : "Mock sign-in"}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          <div>Switch user</div>
          <div className="text-xs font-normal text-muted-foreground">Demo sign-in. Production uses SSO.</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {users.map((u) => (
          <DropdownMenuItem key={u.id} data-testid={`switch-to-${u.id}`} onSelect={() => choose(u.id)} className="gap-3 py-2">
            <Avatar name={u.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{u.name}</span>
              <span className="block text-xs capitalize text-muted-foreground">{u.roles.join(" · ")}</span>
            </span>
            {u.id === currentId && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
