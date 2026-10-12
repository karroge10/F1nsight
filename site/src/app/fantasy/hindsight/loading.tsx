import { SkeletonIntro, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonIntro />
      <SkeletonTable rows={16} className="mt-10 sm:mt-14" />
    </>
  );
}
