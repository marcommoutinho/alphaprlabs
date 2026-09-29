import type { NextRequest } from "next/server";
import { usdRatePreview } from "@/lib/records/rate";
import { adminOr403, json } from "../respond";

/**
 * A5's rate card: GET ?date=YYYY-MM-DD → the stored Bank of Canada USD→CAD
 * rate the save would use for that date received (lib/records/rate.ts).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await adminOr403();
  if ("denied" in auth) return auth.denied;
  return json(await usdRatePreview(request.nextUrl.searchParams.get("date")));
}
