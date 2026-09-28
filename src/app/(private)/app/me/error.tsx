"use client";

import { ScreenLoadError } from "@/components/research/screen-load-error";

/** R8 error: couldn't load Me; Try again re-renders the segment. */
export default function MeError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenLoadError title="Me" heading="Couldn't load your profile" error={error} retry={unstable_retry} />;
}
