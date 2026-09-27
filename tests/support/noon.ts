// A zone where it is about noon now, for tests whose doses must be due or
// ahead whenever they run. No server-only imports: Playwright specs use it.
import { day } from "./cycles";

/** An IANA fixed-offset zone where the local time now is 12:xx (Etc/GMT signs are inverted). */
export const NOON = (() => {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
})();

/** A local date `days` from today in the NOON zone. */
export const d = (days: number) => day(days, NOON);

/** An instant at a local date and "HH:MM" in the NOON zone (a fixed offset, so no DST). */
export function noonZoneInstant(date: string, time: string): string {
  const match = /^Etc\/GMT(?:([+-])(\d+))?$/.exec(NOON);
  const hours = match?.[1] ? (match[1] === "-" ? Number(match[2]) : -Number(match[2])) : 0;
  const local = Date.parse(`${date}T${time}:00Z`);
  return new Date(local - hours * 3_600_000).toISOString();
}
