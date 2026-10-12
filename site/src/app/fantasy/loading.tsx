import { SkeletonBlock, SkeletonIntro, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonIntro />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <SkeletonBlock className="h-80 w-full" />
      </div>
      <SkeletonTable rows={22} className="mt-10 sm:mt-14" />
    </>
  );
}
