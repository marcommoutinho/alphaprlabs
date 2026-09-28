import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BUSINESS_MAIN } from "@/components/business/frame";
import { StockSkeletonRows } from "@/components/business/stock-skeleton";

/** A6b Stock · loading: the title at once, then row placeholders at real row height with the count column on the right. */
export default function StockLoading() {
  return (
    <main className={BUSINESS_MAIN}>
      <div className="flex h-11 items-center pr-3 pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <span aria-hidden className="mr-0.5 text-[26px] leading-none">‹</span>
        Business
      </div>
      <SkeletonRegion label="Loading stock">
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Skeleton className="hidden h-4 w-[190px] rounded-[4px] laptop:block" />
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:mt-0.5">Stock</h1>
          <Skeleton className="mt-2 h-4 w-[190px] rounded-[4px] laptop:hidden" />
        </header>
        <Skeleton className="mx-3 mt-3.5 h-11 rounded-[12px] laptop:mx-0 laptop:mt-4 laptop:h-10 laptop:w-[420px]" />
        <StockSkeletonRows className="mx-3 mt-7 laptop:mx-0 laptop:mt-4" />
      </SkeletonRegion>
    </main>
  );
}
