// Test support for the real local Supabase stack (npm run db:start): keys,
// accounts, seeded invitations and the Mailpit inbox. Test data uses unique
// emails per run (uniqueEmail), so runs never depend on or reset each other.
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

export type LocalSupabase = { url: string; publishableKey: string; secretKey: string; mailpitUrl: string };

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
  };
  // Test worker processes inherit these instead of asking `supabase status` again.
  process.env.NEXT_PUBLIC_SUPABASE_URL = cached.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = cached.publishableKey;
  process.env.SUPABASE_SECRET_KEY = cached.secretKey;
  process.env.MAILPIT_URL = cached.mailpitUrl;
  return cached;
}

/** Environment for the app under test (Next reads these; SMTP goes to Mailpit). */
export function appTestEnv(): Record<string, string> {
  const local = localSupabase();
  return {
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

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const serviceClient = () =>
  createClient<Database>(localSupabase().url, localSupabase().secretKey, noSession);
export const anonClient = () =>
  createClient<Database>(localSupabase().url, localSupabase().publishableKey, noSession);

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
    const { data: profile } = await admin.from("profiles").select("id").eq("email", opts.email).maybeSingle();
    if (!profile) throw created.error ?? new Error(`Could not create ${opts.email}`);
    userId = profile.id;
    await admin.auth.admin.updateUserById(userId, { password });
  }
  const acknowledged = opts.role === "researcher" && opts.acknowledged !== false;
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
 * Inserts an invitation directly (secret key) and returns its raw token.
 * `sentDaysAgo` > 30 makes a pending invitation expired.
 */
export async function seedInvitation(opts: {
  email: string;
  name: string;
  state?: "pending" | "failed";
  sentDaysAgo?: number;
  invitedBy?: string;
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

/** Signs in through the C1 form (Playwright). */
export async function signInAs(page: Page, origin: string, email: string, password = TEST_PASSWORD) {
  await page.goto(`${origin}/auth`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Number of emails Mailpit holds for `to`. */
export async function emailCount(to: string): Promise<number> {
  const { mailpitUrl } = localSupabase();
  const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await search.json()) as { messages: MailpitMessage[] }).messages.length;
}
