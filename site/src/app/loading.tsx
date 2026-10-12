import { SkeletonBlock, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-12">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <SkeletonBlock className="h-5 w-56" />
            <SkeletonBlock className="mt-3 h-[5.5rem] w-full max-w-3xl sm:h-[7rem]" />
            <SkeletonBlock className="mt-6 h-32 w-full max-w-xl" />
          </div>
          <div className="lg:col-span-5">
            <SkeletonBlock className="h-[22rem] w-full" />
          </div>
        </div>
      </div>
      <SkeletonTable rows={22} className="mt-10 sm:mt-14" />
    </>
  );
}
