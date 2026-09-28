// Design v3 display formatting for times and dates (COMPONENTS_AND_THEMING
// §5 "Number formatting rules"). Pure and client-safe. The mocks use the
// 12-hour clock ("7:30 AM"); dates in lists are "Thu, Sep 24". Times are
// wall-clock times already resolved in the right zone ("HH:MM").

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "08:05" → "8:05 AM", "00:00" → "12:00 AM", "12:30" → "12:30 PM". */
export function clock12(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${suffix}`;
}

const parts = (date: string) => {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return { weekday: WEEKDAYS[d.getUTCDay()], month: MONTHS[d.getUTCMonth()], day: d.getUTCDate() };
};

/** "2026-09-24" → "Thu, Sep 24". */
export function shortDate(date: string): string {
  const p = parts(date);
  return `${p.weekday}, ${p.month} ${p.day}`;
}

/** "2026-09-24" → "Thu". */
export const weekdayOf = (date: string) => parts(date).weekday;

/** A wall-clock "YYYY-MM-DDTHH:MM" as "Wed 8:00 PM", or "8:00 PM" on `today`. */
export function wallWhen(wall: string, today: string): string {
  const time = clock12(wall.slice(11, 16));
  return wall.slice(0, 10) === today ? time : `${weekdayOf(wall)} ${time}`;
}

/** "In 10 h 48 min", "In 25 min", "In 2 h" (never "In 0 min": "In 1 min"). */
export function untilLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `In ${rest} min`;
  return rest === 0 ? `In ${hours} h` : `In ${hours} h ${rest} min`;
}
