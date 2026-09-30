import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * True when a cron request carries `Authorization: Bearer <CRON_SECRET>`
 * (what Vercel Cron sends), compared in constant time. Without CRON_SECRET
 * set, every call is refused (and logged, naming the job).
 */
export function cronAuthorized(request: Request, job: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) {
    console.error(`CRON_SECRET is not set: the ${job} refuses every call.`);
    return false;
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
