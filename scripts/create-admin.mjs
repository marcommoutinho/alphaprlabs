// Controlled admin bootstrap: creates an admin account, or promotes an
// existing account to admin. Uses the Supabase secret key, so it runs only
// where that key is available (never from the app, no public role selection).
//
//   npm run admin:create -- --email marco@example.com --name "Marco Moutinho" [--password '…']
//
// Without --password a new account gets a random password, printed once; the
// admin can also set one through "Forgot password?". An existing account keeps
// its password unless --password is given.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" } },
});

const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error('Usage: npm run admin:create -- --email <email> --name "<full name>" [--password <password>]');
  process.exit(1);
}
if (values.password !== undefined && values.password.length < 8) {
  console.error("The password needs at least 8 characters.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. in .env.local).");
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(target) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === target);
    if (match || data.users.length < 200) return match ?? null;
  }
}

let user = await findUserByEmail(email);
let generatedPassword = null;

if (user) {
  if (values.password) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password: values.password });
    if (error) throw error;
  }
} else {
  const password = values.password ?? (generatedPassword = randomBytes(18).toString("base64url"));
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  user = data.user;
}

const { error: profileError } = await supabase
  .from("profiles")
  .upsert({ id: user.id, email, name, role: "admin" }, { onConflict: "id" });
if (profileError) throw profileError;

console.log(`${email} is an admin.`);
if (generatedPassword) console.log(`Temporary password (shown once): ${generatedPassword}`);
