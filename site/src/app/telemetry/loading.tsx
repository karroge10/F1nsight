import { SkeletonBlock, SkeletonIntro } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonIntro />
      <div className="mx-auto mt-10 max-w-[1440px] px-4 sm:mt-14 sm:px-6" aria-busy="true" aria-label="Loading">
        <div className="flex flex-wrap gap-4">
          <SkeletonBlock className="h-11 w-72" />
          <SkeletonBlock className="h-11 w-56" />
          <SkeletonBlock className="h-11 w-56" />
        </div>
        <div className="mt-8 grid gap-10 xl:grid-cols-12">
          <SkeletonBlock className="h-[26rem] xl:col-span-8" />
          <SkeletonBlock className="h-80 xl:col-span-4" />
        </div>
      </div>
    </>
  );
}
