"use client";

import { ScreenError } from "@/components/admin/states";

/** A12 · couldn't load: nothing about the person is shown. */
export default function HistoryError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenError title="Researcher history" heading="Couldn't load this history" error={error} retry={unstable_retry} back={{ href: "/admin/people", label: "People" }} />;
}
