import "server-only";
import { createHash } from "node:crypto";

// The request hash of the idempotent writers (20260928120000_save_cycle_mixtures.sql,
// 20260928130000_supplies_v3.sql): the screen makes a request key once and
// sends it again on a retry; the server hashes what was sent, so the same
// key with other details is refused instead of replayed.

/** The JSON of a value with object keys sorted (undefined members dropped), so a submission always reads the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${members.map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 (hex) of a submission's canonical JSON. */
export function saveRequestHash(submission: unknown): string {
  return createHash("sha256").update(canonicalJson(submission)).digest("hex");
}
