import { BackBar } from "@/components/alpha/back-bar";
import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BUSINESS_MAIN, STOCK_HREF } from "@/components/business/frame";

/** A4 Stock item · loading: the way back at once, then the title, the on-hand block and both lists at their size. */
export default function StockItemLoading() {
  return (
    <main className={BUSINESS_MAIN}>
      <BackBar href={STOCK_HREF} label="Stock" />
      <SkeletonRegion label="Loading the stock item">
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <div className="font-mono text-[13px] font-medium text-ink-3">Stock item</div>
          <Skeleton className="mt-1.5 h-[34px] w-[240px] max-w-full rounded-[8px]" />
        </header>
        <div className="mx-3 mt-4 flex flex-col gap-3 laptop:mx-0 laptop:flex-row laptop:items-end laptop:gap-4">
          <Skeleton className="h-[104px] rounded-now laptop:w-[360px]" />
          <div className="flex gap-2 laptop:pb-1">
            <Skeleton className="h-11 flex-1 rounded-full laptop:w-[160px] laptop:flex-none" />
            <Skeleton className="h-11 flex-1 rounded-full laptop:w-[130px] laptop:flex-none" />
          </div>
        </div>
        <div className="mt-7 grid gap-7 laptop:grid-cols-2 laptop:gap-4">
          {["Purchases", "Sales"].map((title) => (
            <section key={title} className="min-w-0">
              <h2 className="px-5 text-[20px] leading-6 font-semibold tracking-[-0.015em] laptop:px-0">{title}</h2>
              <Skeleton className="mx-3 mt-3 h-[132px] rounded-group laptop:mx-0" />
            </section>
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}
