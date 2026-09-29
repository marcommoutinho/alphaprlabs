import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BUSINESS_MAIN } from "@/components/business/frame";

/**
 * Business loading (§7.16): the title renders at once; the Now block,
 * actions, tiles, chart and rows at their real size. The Business page's own
 * Suspense fallback rather than a route loading.tsx: see
 * src/app/(private)/admin/business/page.tsx.
 */
export function OverviewSkeleton() {
  return (
    <main className={BUSINESS_MAIN}>
      <SkeletonRegion label="Loading the business figures">
        <header className="px-5 pt-2 laptop:px-0">
          <Skeleton className="h-4 w-36 rounded-[6px]" />
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">
            <span className="laptop:hidden">Business</span>
            <span className="hidden laptop:inline">Overview</span>
          </h1>
          <Skeleton className="mt-3.5 h-11 laptop:hidden" />
        </header>
        <div className="mt-4 flex flex-col gap-3 px-3 laptop:mt-5 laptop:grid laptop:grid-cols-12 laptop:gap-4 laptop:px-0">
          <Skeleton className="h-[292px] rounded-now laptop:col-span-8 laptop:h-[250px] laptop:rounded-[24px]" />
          <div className="grid grid-cols-2 gap-2 laptop:col-span-4 laptop:gap-3">
            <Skeleton className="h-14 rounded-btn laptop:hidden" />
            <Skeleton className="h-14 rounded-btn laptop:hidden" />
            <Skeleton className="h-[98px] rounded-group" />
            <Skeleton className="h-[98px] rounded-group" />
            <Skeleton className="hidden h-[98px] rounded-group laptop:block" />
            <Skeleton className="hidden h-[98px] rounded-group laptop:block" />
          </div>
          <Skeleton className="h-[160px] rounded-group laptop:col-span-5" />
          <Skeleton className="h-[200px] rounded-group laptop:col-span-7" />
        </div>
      </SkeletonRegion>
    </main>
  );
}
