import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BackBar } from "@/components/admin/states";

/** A12 · loading: nothing about the person until access is checked; placeholders at real size. */
export default function HistoryLoading() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col pb-24 laptop:px-9 laptop:pt-7">
      <BackBar href="/admin/people" label="People" />
      <SkeletonRegion label="Loading the history" className="laptop:max-w-[760px]">
        <Skeleton className="mx-3 h-10 rounded-[14px] laptop:mx-0 laptop:mt-8" />
        <div className="px-5 pt-4 laptop:px-0">
          <Skeleton className="h-9 w-[220px] rounded-[8px]" />
          <Skeleton className="mt-2 h-4 w-[240px] rounded-[4px]" />
        </div>
        <Skeleton className="mx-3 mt-4 h-[196px] rounded-now laptop:mx-0" />
        <div className="mx-5 mt-6 flex flex-col gap-4 laptop:mx-0">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-6 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-[55%] rounded-[4px]" />
                <Skeleton className="mt-2 h-3 w-[40%] rounded-[4px]" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}
