import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { APPS } from "@/lib/apps/registry";
import { getCurrentUser } from "@/lib/platform/auth";

export default async function Home() {
  const user = await getCurrentUser();
  const apps = APPS.filter((a) => user && a.roles.some((r) => user.roles.includes(r)));
  return (
    <div>
      <PageHeader
        title={user ? `Welcome, ${user.name.split(" ")[0]}` : "Welcome"}
        description={user ? `Your roles: ${user.roles.join(", ")}` : "Pick a user from the switcher in the header."}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {apps.map((a) => (
          <Link key={a.id} href={`/apps/${a.id}`} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-300">
            <div className="font-semibold">{a.name}</div>
            <p className="mt-1 text-sm text-slate-500">{a.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
