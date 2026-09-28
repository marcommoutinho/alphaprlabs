"use client";

import { CyclesLoadError } from "@/components/research/cycles/load-error";

/** R3 error: couldn't load the cycle; Try again re-renders the segment. */
export default function CycleError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <CyclesLoadError title="Cycle" heading="Couldn't load this cycle" error={error} retry={unstable_retry} back />;
}
