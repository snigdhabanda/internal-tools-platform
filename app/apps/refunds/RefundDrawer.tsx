"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** URL-driven drawer: rendered open when ?refund=<id> is present; closing drops the param. */
export function RefundDrawer({ title, description, closeHref, children }: { title: ReactNode; description: ReactNode; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(o) => !o && router.push(closeHref, { scroll: false })}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl" data-testid="refund-drawer">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-3 text-xl">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
