"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Route-level error boundary: shown instead of a blank page when a server component throws. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <Card className="mx-auto mt-16 max-w-md text-center">
      <CardContent className="p-8">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page couldn&apos;t load. Nothing was changed. Try again, and if it keeps happening, share reference{" "}
          <span className="font-mono">{error.digest ?? "n/a"}</span> with the platform team.
        </p>
        <Button className="mt-6" onClick={reset}>Try again</Button>
      </CardContent>
    </Card>
  );
}
