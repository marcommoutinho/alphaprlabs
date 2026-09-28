"use client";

import { ScreenLoadError } from "@/components/research/screen-load-error";

/** R5 error: couldn't load Progress; Try again re-renders the segment. */
export default function ProgressError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenLoadError title="Progress" heading="Couldn't load your progress" error={error} retry={unstable_retry} />;
}
