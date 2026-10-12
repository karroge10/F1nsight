import { SkeletonBlock, SkeletonIntro } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonIntro compact />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <SkeletonBlock className="h-11 w-full" />
        <div className="mt-4 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <SkeletonBlock className="aspect-[4/3] w-full" />
          </div>
          <div className="lg:col-span-6">
            <SkeletonBlock className="h-[40rem] w-full" />
          </div>
        </div>
      </div>
    </>
  );
}
