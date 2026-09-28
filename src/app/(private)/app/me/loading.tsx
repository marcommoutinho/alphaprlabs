import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";

/** R8 loading: the profile, the support card and the setting groups at their size. */
export default function Loading() {
  return (
    <main className={CYCLES_MAIN}>
      <SkeletonRegion label="Loading your profile" className="laptop:grid laptop:grid-cols-12 laptop:gap-x-8">
        <div className="laptop:col-span-7">
          <div className="flex items-center gap-4 px-5 pt-4 laptop:px-0 laptop:pt-2">
            <Skeleton className="size-16 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-7 w-44 rounded-[8px]" />
              <Skeleton className="h-4 w-52 rounded-[6px]" />
              <Skeleton className="h-4 w-36 rounded-[6px]" />
            </div>
          </div>
          <Skeleton className="mx-5 mt-7 h-4 w-28 rounded-[6px] laptop:mx-0" />
          <Skeleton className="mx-3 mt-2 h-[136px] rounded-group laptop:mx-0" />
        </div>
        <div className="laptop:col-span-5 laptop:mt-2">
          {[168, 168, 112].map((height, index) => (
            <div key={index} className="mt-6 laptop:first:mt-0">
              <Skeleton className="mx-5 h-4 w-24 rounded-[6px] laptop:mx-0" />
              <Skeleton className="mx-3 mt-2 rounded-group laptop:mx-0" style={{ height }} />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}
