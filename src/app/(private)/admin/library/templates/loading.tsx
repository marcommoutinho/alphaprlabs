import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BackBar } from "@/components/admin/states";
import { BUSINESS_MAIN } from "@/components/business/frame";

/** A10 · loading: the title at once, the control, then cards at real height. */
export default function TemplatesLoading() {
  return (
    <main className={BUSINESS_MAIN}>
      <BackBar href="/admin/business" label="Business" />
      <SkeletonRegion label="Loading templates">
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">Library</h1>
          <Skeleton className="mt-3.5 h-11 rounded-[12px] laptop:mt-4 laptop:h-10 laptop:max-w-[360px]" />
        </header>
        <div className="mx-3 mt-4 grid gap-2.5 laptop:mx-0 laptop:grid-cols-2 laptop:gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[132px] rounded-group" />
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}
