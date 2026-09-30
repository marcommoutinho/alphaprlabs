// Local timer for the reminder dispatcher: what Vercel Cron does in
// production (vercel.json), once a minute, at the start of each minute:
//
//   npm run reminders:tick [-- --url http://localhost:3000] [--once]
//
// It calls GET <url>/api/cron/reminders with `Authorization: Bearer
// $CRON_SECRET` (from .env.local) and prints each answer. The app must be
// running (npm run dev, or next start) with CRON_SECRET, REMINDERS_ENABLED=true
// and the VAPID keys in its environment; otherwise the dispatcher answers 401
// or { enabled: false } and sends nothing. /api works on every host, so the
// plain local origin is fine. Stop it with Ctrl+C.
import { parseArgs } from "node:util";

const TIMEOUT_MS = 55_000;

let values;
try {
  ({ values } = parseArgs({ options: { url: { type: "string" }, once: { type: "boolean" } } }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set (add it to .env.local, and give the app the same value).");
  process.exit(1);
}
const base = (values.url ?? process.env.REMINDERS_TICK_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const target = `${base}/api/cron/reminders`;

async function tick() {
  const at = new Date().toISOString();
  try {
    const response = await fetch(target, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.text();
    console.log(`${at} ${response.status} ${body}`);
  } catch (error) {
    console.error(`${at} ${target} failed: ${error instanceof Error ? error.message : error}`);
  }
}

if (values.once) {
  await tick();
} else {
  console.log(`Calling ${target} every minute. Ctrl+C stops.`);
  let timer;
  const schedule = () => {
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, 60_000 - (Date.now() % 60_000));
  };
  process.on("SIGINT", () => {
    clearTimeout(timer);
    process.exit(0);
  });
  await tick();
  schedule();
}
