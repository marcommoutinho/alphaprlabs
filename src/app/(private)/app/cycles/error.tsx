"use client";

import { CyclesLoadError } from "@/components/research/cycles/load-error";

/** R10 error: couldn't load the cycles; Try again re-renders the segment. */
export default function CyclesError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <CyclesLoadError title="Cycles" heading="Couldn't load your cycles" error={error} retry={unstable_retry} />;
}
