import "server-only";
import { usdCadRate } from "@/lib/inventory/fx";
import { calendarDate, PURCHASE_DATE_FUTURE, PURCHASE_DATE_REQUIRED } from "@/lib/inventory/rules";
import { businessToday, FX_UNAVAILABLE, fxNoRateMessage } from "@/lib/inventory/screens";

/** A rate for the card, or why there is none (`retry`: the lookup failed, not the rate missing). */
export type UsdRatePreview = { rate?: string; rateDate?: string; error?: string; retry?: boolean };

/**
 * A5's rate card: the stored Bank of Canada USD→CAD rate a purchase received
 * on `receivedOn` would be converted with (fx.ts: the same lookup the save
 * makes). Display only; the save looks it up again on the server. The rate
 * is never typed or overridden (Marco: the stored rate only).
 */
export async function usdRatePreview(receivedOn: unknown): Promise<UsdRatePreview> {
  const date = calendarDate(receivedOn);
  if (!date) return { error: PURCHASE_DATE_REQUIRED };
  if (date > businessToday()) return { error: PURCHASE_DATE_FUTURE };
  const fx = await usdCadRate(date);
  if (!fx.ok) return fx.reason === "no_rate" ? { error: fxNoRateMessage(date) } : { error: FX_UNAVAILABLE, retry: true };
  return { rate: fx.rate, rateDate: fx.rateDate };
}
