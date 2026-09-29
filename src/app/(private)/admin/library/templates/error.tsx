"use client";

import { ScreenError } from "@/components/admin/states";

/** A10 / D7 · couldn't load: no stale template is shown or saved. */
export default function TemplatesError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenError title="Templates" heading="Couldn't load templates" error={error} retry={unstable_retry} back={{ href: "/admin/library", label: "Library" }} />;
}
