import { Skeleton } from "@/components/alpha/skeleton";
import { cn } from "@/lib/utils";

const WIDTHS = [150, 120, 170, 110, 140];

/** A6b's rows: placeholders at real row height, the count column on the right (Stock loading, and the component gallery). */
export function StockSkeletonRows({ className }: { className?: string }) {
  return (
    <div className={cn("divide-y divide-line overflow-hidden rounded-group border border-line bg-surface", className)} data-testid="stock-skeleton">
      {WIDTHS.map((width, index) => (
        <div key={index} className="flex h-[60px] items-center gap-3 px-4">
          <Skeleton className="h-4 rounded-[4px]" style={{ width }} />
          <Skeleton className="ml-auto h-[22px] w-9 rounded-[5px]" />
        </div>
      ))}
    </div>
  );
}
