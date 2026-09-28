import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";

/**
 * R9b Today loading: the real header, then skeletons at the size and place
 * of the progress bar, the Now block, an overdue row and the check-in card.
 */
export default function TodayLoading() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-8 laptop:pt-6 laptop:pb-16">
      <SkeletonRegion label="Loading today's plan">
        <header className="px-5 pt-2 laptop:px-0">
          <Skeleton className="h-4 w-44 rounded-[6px]" />
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Today</h1>
          <Skeleton className="mt-3.5 h-1.5 rounded-[3px]" />
          <Skeleton className="mt-2 h-4 w-24 rounded-[6px]" />
        </header>
        <div className="mt-4 flex flex-col gap-3 px-3 laptop:w-7/12 laptop:px-0">
          <Skeleton className="flex h-[330px] flex-col justify-end gap-3 rounded-now p-5 laptop:rounded-[24px]">
            <Skeleton inner className="h-14 w-2/3" />
            <Skeleton inner className="h-14" />
          </Skeleton>
          <Skeleton className="h-16 rounded-[18px]" />
          <Skeleton className="h-[124px] rounded-[24px]" />
        </div>
      </SkeletonRegion>
    </main>
  );
}
