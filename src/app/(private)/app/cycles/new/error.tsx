"use client";

import { CyclesLoadError } from "@/components/research/cycles/load-error";

/** The builder couldn't load its library; Try again re-renders the segment. */
export default function NewCycleError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <CyclesLoadError title="New cycle" heading="Couldn't open the builder" error={error} retry={unstable_retry} back />;
}
