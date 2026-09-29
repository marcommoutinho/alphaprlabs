"use client";

import { ScreenError } from "@/components/admin/states";

/** A8 / D6 · couldn't load: nothing is shown stale; drafts stay as last saved. */
export default function LibraryError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenError title="Library" heading="Couldn't load the library" error={error} retry={unstable_retry} back={{ href: "/admin/business", label: "Business" }} />;
}
