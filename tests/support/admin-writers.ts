// Library entries and templates as test fixtures, through the app's writers
// admin_save_peptide and admin_save_template (V7): the older
// save_library_peptide and save_cycle_template are no longer an API (no
// expected version, no request key, no change row). Each call is a fresh
// request, as the given signed-in client, over the version stored now, and
// answers like the older RPCs did ({ data: the id, error, status }), so a
// fixture keeps its shape. A peptide and a template are saved published (a
// template as a draft when asked); `p_available` is the peptide's
// "Offered for new cycles" switch. An unknown `p_id` is refused (P0002).
import { randomBytes, randomUUID } from "node:crypto";
import { serviceClient, type signedInClient } from "./local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;
type ApiError = { message: string; code?: string; details?: string | null; hint?: string | null };
export type WriterAnswer = ({ data: string; error: null } | { data: null; error: ApiError }) & { status: number };

const requestHash = () => randomBytes(32).toString("hex");

export type PeptideFixture = {
  p_name: string;
  p_information: string;
  p_cycling_off_guidance?: string;
  p_supplement_guidance?: string;
  p_available?: boolean;
  p_id?: string | null;
};

/** Creates (no `p_id`) or edits a published library entry as `db`'s admin. */
export async function savePeptideAs(db: Client, args: PeptideFixture): Promise<WriterAnswer> {
  const id = args.p_id ?? null;
  const current = id
    ? (await serviceClient().from("peptides").select("version, short_description, vial_strengths_mg").eq("id", id).maybeSingle()).data
    : null;
  const response = await db
    .rpc("admin_save_peptide", {
      p_request_key: randomUUID(),
      p_request_hash: requestHash(),
      p_id: id,
      p_expected_version: id ? (current?.version ?? 1) : null,
      p_name: args.p_name,
      p_short_description: current?.short_description ?? "",
      p_vial_strengths_mg: (current?.vial_strengths_mg ?? []).map(String),
      p_information: args.p_information,
      p_cycling_off_guidance: args.p_cycling_off_guidance ?? "",
      p_supplement_guidance: args.p_supplement_guidance ?? "",
      p_offered: args.p_available ?? true,
      p_publish: true,
      // The generated types can't express the nullable arguments.
    } as never)
    .single<{ peptide_id: string }>();
  return response.error ? { data: null, error: response.error, status: response.status } : { data: response.data.peptide_id, error: null, status: response.status };
}

/** `p_published`: the state it is left in, published unless false (a draft, hidden from researchers). */
export type TemplateFixture = { p_name: string; p_guidance?: string; p_plans: unknown; p_id?: string | null; p_published?: boolean };

/** Creates (no `p_id`) or edits a cycle template as `db`'s admin, published unless `p_published` is false. */
export async function saveTemplateAs(db: Client, args: TemplateFixture): Promise<WriterAnswer> {
  const id = args.p_id ?? null;
  const current = id ? (await serviceClient().from("cycle_templates").select("version").eq("id", id).maybeSingle()).data : null;
  const response = await db
    .rpc("admin_save_template", {
      p_request_key: randomUUID(),
      p_request_hash: requestHash(),
      p_id: id,
      p_expected_version: id ? (current?.version ?? 1) : null,
      p_name: args.p_name,
      p_guidance: args.p_guidance ?? "",
      p_plans: args.p_plans,
      p_published: args.p_published ?? true,
    } as never)
    .single<{ template_id: string }>();
  return response.error ? { data: null, error: response.error, status: response.status } : { data: response.data.template_id, error: null, status: response.status };
}
