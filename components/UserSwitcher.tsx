"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Option = { id: string; name: string; roles: string[] };

export function UserSwitcher({ users, currentId }: { users: Option[]; currentId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function onChange(userId: string) {
    await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">Signed in as</span>
      <select
        data-testid="user-switcher"
        className="rounded-md border border-slate-300 bg-white px-2 py-1"
        value={currentId ?? ""}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
      >
        {!currentId && <option value="">— choose a user —</option>}
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.roles.join(", ")})
          </option>
        ))}
      </select>
    </label>
  );
}
