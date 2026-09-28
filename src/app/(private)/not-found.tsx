import Link from "next/link";

// notFound() anywhere in the private area (an unknown cycle, template, item…),
// in the v3 look and the person's Appearance. Unmatched URLs use
// src/app/global-not-found.tsx instead.
export default function PrivateNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center text-ink">
      <title>404: This page could not be found.</title>
      <p className="font-mono text-[13px] text-ink-3">404</p>
      <h1 className="text-[22px] leading-7 font-semibold">This page could not be found.</h1>
      <Link
        href="/app/today"
        className="mt-2 inline-flex min-h-11 items-center rounded-btn px-4 text-[15px] font-semibold text-signal-ink"
      >
        Go to Today
      </Link>
    </main>
  );
}
