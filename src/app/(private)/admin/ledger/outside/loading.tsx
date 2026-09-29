import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BUSINESS_MAIN } from "@/components/business/frame";
import { OUTSIDE_TITLE } from "@/lib/inventory/seller-screens";

/**
 * Outside buyers loading (§7.16): its own title at once (not the Ledger's
 * skeleton, which this route would otherwise inherit), then the search and
 * the list at their real size.
 */
export default function OutsideBuyersLoading() {
  return (
    <main className={BUSINESS_MAIN}>
      <SkeletonRegion label="Loading outside buyers">
        <div className="h-11 laptop:mb-2 laptop:h-5" />
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">{OUTSIDE_TITLE}</h1>
          <Skeleton className="mt-2.5 h-4 w-64 max-w-full rounded-[6px]" />
        </header>
        <Skeleton className="mx-3 mt-4 h-11 rounded-[12px] laptop:mx-0 laptop:max-w-[520px]" />
        <Skeleton className="mx-3 mt-4 h-[196px] rounded-[20px] laptop:mx-0 laptop:max-w-[720px]" />
      </SkeletonRegion>
    </main>
  );
}
