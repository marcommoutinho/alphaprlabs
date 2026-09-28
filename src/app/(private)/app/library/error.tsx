"use client";

import { ScreenLoadError } from "@/components/research/screen-load-error";

/** R11 / R12 error: couldn't load the library; Try again re-renders the segment. */
export default function LibraryError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenLoadError title="Library" heading="Couldn't load the library" error={error} retry={unstable_retry} />;
}
