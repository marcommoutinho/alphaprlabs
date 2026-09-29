// Test support for the real local Supabase stack (npm run db:start): keys,
// accounts, seeded invitations and the Mailpit inbox. Test data uses unique
// emails per run (uniqueEmail), so runs never depend on or reset each other.
import { execSync } from "node:child_process";
import { createECDH, createHash, randomBytes } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

export type LocalSupabase = {
  url: string;
  publishableKey: string;
  secretKey: string;
  mailpitUrl: string;
  /** Direct Postgres connection (tests that must run SQL as a given role, rolled back). */
  dbUrl: string;
};

let cached: LocalSupabase | undefined;

/** Keys from the environment, else from `supabase status` (the stack must be running). */
export function localSupabase(): LocalSupabase {
  if (cached) return cached;
  const env = process.env;
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY) {
    cached = {
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secretKey: env.SUPABASE_SECRET_KEY,
      mailpitUrl: env.MAILPIT_URL ?? "http://127.0.0.1:54424",
      dbUrl: env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres",
    };
    return cached;
  }
  let output: string;
  try {
    output = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error("Local Supabase is not running. Start it with `npm run db:start`.");
  }
  const value = (key: string) => {
    const match = new RegExp(`^${key}="?([^"\\n]*)"?$`, "m").exec(output);
    if (!match) throw new Error(`supabase status did not report ${key}`);
    return match[1];
  };
  cached = {
    url: value("API_URL"),
    publishableKey: value("PUBLISHABLE_KEY"),
    secretKey: value("SECRET_KEY"),
    mailpitUrl: value("MAILPIT_URL"),
    dbUrl: value("DB_URL"),
  };
  // Test worker processes inherit these instead of asking `supabase status` again.
  process.env.NEXT_PUBLIC_SUPABASE_URL = cached.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = cached.publishableKey;
  process.env.SUPABASE_SECRET_KEY = cached.secretKey;
  process.env.MAILPIT_URL = cached.mailpitUrl;
  process.env.SUPABASE_DB_URL = cached.dbUrl;
  return cached;
}

/**
 * Vitest globalSetup: asks `supabase status` once, before any test file runs,
 * and the workers inherit the keys through the environment (concurrent
 * `supabase status` calls from several files could fail spuriously). Unit
 * tests don't need the stack, so a stopped stack is reported by the tests
 * that use it.
 */
export function setup() {
  try {
    localSupabase();
  } catch {
    // Not running: integration tests throw the "not running" message themselves.
  }
}

// A throwaway VAPID key pair per test run (P-256, base64url), so no key is
// ever committed. Local automated tests never send real pushes.
const vapid = createECDH("prime256v1");
vapid.generateKeys();

/** Environment for the app under test (Next reads these; SMTP goes to Mailpit). */
export function appTestEnv(): Record<string, string> {
  const local = localSupabase();
  return {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"),
    VAPID_PRIVATE_KEY: Buffer.from(vapid.getPrivateKey("hex").padStart(64, "0"), "hex").toString("base64url"),
    VAPID_SUBJECT: "mailto:research@alphaprlabs.test",
    NEXT_PUBLIC_SUPABASE_URL: local.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
    SUPABASE_SECRET_KEY: local.secretKey,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "54425",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "Alpha PR Labs <research@alphaprlabs.test>",
  };
}

/**
 * Kong's own 502 body when the service behind it closed the connection
 * without answering ("upstream prematurely closed connection while reading
 * response header" in Kong's error log).
 */
const GATEWAY_NO_RESPONSE = "An invalid response was received from the upstream server";

/**
 * fetch for the test clients. Now and then PostgREST closes a keep-alive
 * connection from the local gateway (Kong) while Kong's next request on it is
 * already waiting, unread: Kong logs "upstream prematurely closed connection"
 * or "Connection reset by peer" and answers the 502 above, and PostgREST's
 * own TCP counters count one TCPAbortOnData (closed with unread data) per
 * 502. PostgREST logs nothing. It happens mostly in the first seconds of a
 * run, when every file signs in at once and the stack is busiest, and on no
 * particular request. Nothing in this repository can configure it: Kong
 * always keeps upstream connections alive (no setting in
 * supabase/config.toml), and PostgREST has no server keep-alive or timeout
 * setting. Kong itself resends a failed GET; a failed write reaches the test.
 * Fewer integration files at once keeps it away (vitest.config.mts).
 *
 * Only reads (GET/HEAD) are sent again, once, and reported. A write (POST,
 * PATCH, DELETE, and every RPC, which PostgREST takes as POST) is never
 * repeated: a closed connection does not prove the first attempt was not
 * applied, so the 502 reaches the test, and ok()/sqlState() fail with it.
 */
const RETRYABLE_METHODS = new Set(["GET", "HEAD"]);

async function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const retry = input instanceof Request ? input.clone() : input;
  const response = await fetch(input, init);
  if (response.status !== 502) return response;
  const url = input instanceof Request ? input.url : String(input);
  const body = await response.clone().text();
  if (!body.includes(GATEWAY_NO_RESPONSE)) return response;
  if (!RETRYABLE_METHODS.has(method)) {
    console.warn(`Local gateway 502 (upstream closed the connection); not repeating the write: ${method} ${url}`);
    return response;
  }
  console.warn(`Local gateway 502 (upstream closed the connection); reading once more: ${method} ${url}`);
  return fetch(retry, init);
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: gatewayFetch },
};

export const serviceClient = () =>
  createClient<Database>(localSupabase().url, localSupabase().secretKey, clientOptions);
export const anonClient = () =>
  createClient<Database>(localSupabase().url, localSupabase().publishableKey, clientOptions);

type ApiError = { message: string; code?: string; details?: string | null; hint?: string | null };
// A supabase-js response: data on success, an error (and null data) on failure.
type ApiResponse<T> = ({ data: T; error: null } | { data: null; error: ApiError }) & { status: number };

const describeFailure = (what: string, { error, status }: { error: ApiError | null; status: number }) =>
  `${what} failed (HTTP ${status}${error?.code ? `, ${error.code}` : ""}): ${error?.message ?? "no error body"}` +
  (error?.details ? ` — ${error.details}` : "");

/**
 * The data of a PostgREST call that must succeed. A failed call throws with
 * the real status and error instead of reading as `data: null`, so a test
 * never mistakes a failure for an empty or negative answer.
 */
export async function ok<T>(call: PromiseLike<ApiResponse<T>>, what = "Database call"): Promise<T> {
  const response = await call;
  if (response.error) throw new Error(describeFailure(what, response));
  return response.data;
}

/**
 * The SQLSTATE a PostgREST call was refused with, or "ok" when it succeeded.
 * An error without a SQLSTATE (the gateway, the network) throws instead:
 * it is neither a refusal nor a success.
 */
export async function sqlState(call: PromiseLike<{ error: ApiError | null; status: number }>, what = "Database call"): Promise<string> {
  const response = await call;
  if (!response.error) return "ok";
  if (!response.error.code) throw new Error(describeFailure(what, response));
  return response.error.code;
}

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@example.test`;

export const TEST_PASSWORD = "correct-horse-42";

/** Creates (or resets the password of) an account with a profile of the given role. */
export async function ensureAccount(opts: {
  email: string;
  name: string;
  role: "admin" | "researcher";
  acknowledged?: boolean;
  password?: string;
}): Promise<string> {
  const admin = serviceClient();
  const password = opts.password ?? TEST_PASSWORD;
  let userId: string;
  const created = await admin.auth.admin.createUser({ email: opts.email, password, email_confirm: true });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    const { data: profile, error: lookupError } = await admin.from("profiles").select("id").eq("email", opts.email).maybeSingle();
    if (lookupError) throw lookupError;
    if (!profile) throw created.error ?? new Error(`Could not create ${opts.email}`);
    userId = profile.id;
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
    if (passwordError) throw passwordError;
  }
  // Admins are researchers too (S3.2): both roles are acknowledged unless asked not to be.
  const acknowledged = opts.acknowledged !== false;
  const { error } = await admin.from("profiles").upsert({
    id: userId,
    email: opts.email,
    name: opts.name,
    role: opts.role,
    acknowledgement_version: acknowledged ? "test" : null,
    acknowledged_at: acknowledged ? new Date().toISOString() : null,
  });
  if (error) throw error;
  return userId;
}

/** Signs in with the publishable key, as a browser would. */
export async function signedInClient(email: string, password = TEST_PASSWORD) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/**
 * A client signed in as `email` whose calls matching `lose` reach the
 * database and run to completion, but whose answer is lost on the way back:
 * as a dropped connection ("fetch failed") or as the gateway's 502. That is
 * how supabase-js reports both, as an ordinary error, although the write
 * committed. `lose` is read on every call, so a test can turn it off.
 */
export async function answerLostClient(
  email: string,
  lose: (url: string) => "dropped" | "gateway" | null,
  password = TEST_PASSWORD,
) {
  const lossy = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const response = await fetch(input, init);
    const how = lose(url);
    if (!how) return response;
    await response.arrayBuffer(); // the database has answered: it committed.
    if (how === "dropped") throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ message: GATEWAY_NO_RESPONSE }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>(localSupabase().url, localSupabase().publishableKey, {
    ...clientOptions,
    global: { fetch: lossy },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/**
 * Inserts an invitation directly (secret key) and returns its raw token.
 * `sentDaysAgo` > 30 makes a pending invitation expired.
 */
export async function seedInvitation(opts: {
  email: string;
  name: string;
  state?: "pending" | "failed";
  sentDaysAgo?: number;
  invitedBy?: string;
  /** The role the account is created with (default researcher). */
  role?: "researcher" | "admin";
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const sentAt = new Date(Date.now() - (opts.sentDaysAgo ?? 0) * 86_400_000);
  const { error } = await serviceClient()
    .from("invitations")
    .insert({
      email: opts.email,
      name: opts.name,
      token_hash: createHash("sha256").update(token).digest("hex"),
      state: opts.state ?? "pending",
      sent_at: sentAt.toISOString(),
      expires_at: new Date(sentAt.getTime() + 30 * 86_400_000).toISOString(),
      last_send_error: opts.state === "failed" ? "ECONNREFUSED: seeded failure" : null,
      invited_by: opts.invitedBy ?? null,
      role: opts.role ?? "researcher",
    });
  if (error) throw error;
  return token;
}

type MailpitMessage = { ID: string; Subject: string };

/** Waits for the newest email to `to` in Mailpit and returns its subject and body. */
export async function latestEmail(to: string, timeoutMs = 10_000): Promise<{ subject: string; text: string; html: string }> {
  const { mailpitUrl } = localSupabase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: MailpitMessage[] };
    if (messages.length > 0) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`)).json()) as {
        Subject: string;
        Text: string;
        HTML: string;
      };
      return { subject: message.Subject, text: message.Text, html: message.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}

/**
 * Waits until React has hydrated the element (Playwright), so a click or typing
 * reaches its handlers. The server-rendered form is usable before that: text
 * typed into a controlled input then never reaches React state and is wiped
 * by the next render, and a click submits the bare HTML form. React attaches
 * its props to each element it hydrates.
 */
export async function hydrated(locator: Locator): Promise<Locator> {
  const element = await locator.elementHandle();
  await locator
    .page()
    .waitForFunction((node) => node !== null && Object.keys(node).some((key) => key.startsWith("__reactProps$")), element);
  await element?.dispose();
  return locator;
}

/** Signs in through the C1 form (Playwright). */
export async function signInAs(page: Page, origin: string, email: string, password = TEST_PASSWORD) {
  await page.goto(`${origin}/auth`);
  await (await hydrated(page.getByLabel("Email"))).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Number of emails Mailpit holds for `to`. */
export async function emailCount(to: string): Promise<number> {
  const { mailpitUrl } = localSupabase();
  const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await search.json()) as { messages: MailpitMessage[] }).messages.length;
}
