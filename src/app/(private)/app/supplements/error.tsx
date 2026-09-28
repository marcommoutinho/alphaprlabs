"use client";

import { ScreenLoadError } from "@/components/research/screen-load-error";

/** R13 error: couldn't load the supplements; Try again re-renders the segment. */
export default function SupplementsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenLoadError title="Supplies" heading="Couldn't load your supplements" error={error} retry={unstable_retry} back={{ href: "/app/me", label: "Me" }} />;
}
