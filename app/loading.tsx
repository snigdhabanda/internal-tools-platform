import { PageSkeleton } from "@/components/shared";

export default function Loading() {
  return <PageSkeleton stats={4} rows={5} />;
}
