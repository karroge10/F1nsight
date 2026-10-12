import { SkeletonIntro, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonIntro />
      <SkeletonTable rows={14} className="mt-6" />
    </>
  );
}
