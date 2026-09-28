import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";

/** The builder while its data loads: the nav, the progress bar, a title and the list at their size. */
export function BuilderLoading({ title }: { title: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper pt-[env(safe-area-inset-top)] text-ink laptop:static laptop:z-auto laptop:mx-auto laptop:w-full laptop:max-w-[720px] laptop:px-8 laptop:pt-6">
      <SkeletonRegion label="Loading the builder">
        <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center px-5 text-[17px] laptop:px-0">
          <span className="text-signal-ink">Cancel</span>
          <span className="font-semibold">{title}</span>
          <span />
        </div>
        <div className="mx-5 mt-1.5 grid grid-cols-3 gap-1 laptop:mx-0">
          <i className="h-1 rounded-[2px] bg-ink" />
          <i className="h-1 rounded-[2px] bg-line" />
          <i className="h-1 rounded-[2px] bg-line" />
        </div>
        <div className="px-5 pt-[22px] laptop:px-0">
          <Skeleton className="h-9 w-2/3 rounded-[10px]" />
          <Skeleton className="mt-2 h-4 w-5/6 rounded-[6px]" />
        </div>
        <Skeleton className="mx-3 mt-[18px] h-16 rounded-group laptop:mx-0" />
        <Skeleton className="mx-3 mt-3 h-12 rounded-[14px] laptop:mx-0" />
        <Skeleton className="mx-3 mt-[18px] h-[232px] rounded-group laptop:mx-0" />
      </SkeletonRegion>
    </div>
  );
}
