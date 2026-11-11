import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist."
      action={<Button asChild><Link href="/">Back to dashboard</Link></Button>}
    />
  );
}
