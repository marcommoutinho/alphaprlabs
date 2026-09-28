"use client";

import { ScreenLoadError } from "@/components/research/screen-load-error";

/** R7 error: couldn't load the vials; Try again re-renders the segment. */
export default function SuppliesError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenLoadError title="Supplies" heading="Couldn't load your vials" error={error} retry={unstable_retry} back={{ href: "/app/me", label: "Me" }} />;
}
