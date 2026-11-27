/**
 * Calendar math with integers only (proleptic Gregorian, UTC, no time zones).
 * Algorithms after Howard Hinnant's "chrono-compatible low-level date algorithms".
 */

export const HOURS_PER_DAY = 24;

export interface GameDate {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  /** 0–23 */
  hour: number;
}

/** Days since 1970-01-01 for a civil date. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Civil date for a number of days since 1970-01-01. */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** Converts a tick (hours since the scenario start) to a calendar date. */
export function tickToDate(tick: number, startDay: number): GameDate {
  const dayOffset = Math.floor(tick / HOURS_PER_DAY);
  const hour = tick - dayOffset * HOURS_PER_DAY;
  return { ...civilFromDays(startDay + dayOffset), hour };
}

/** Converts a calendar date and hour to a tick relative to the scenario start. */
export function dateToTick(date: GameDate, startDay: number): number {
  return (daysFromCivil(date.year, date.month, date.day) - startDay) * HOURS_PER_DAY + date.hour;
}

/** Formats as "1936-01-01 00:00", the form used in content files and logs. */
export function formatDate(date: GameDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)} ${pad(date.hour, 2)}:00`;
}

/** Parses "YYYY-MM-DD" (as used in content files) into days since 1970-01-01. */
export function parseDay(text: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`Invalid date "${text}", expected YYYY-MM-DD`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const days = daysFromCivil(year, month, day);
  const back = civilFromDays(days);
  if (back.year !== year || back.month !== month || back.day !== day) {
    throw new Error(`Invalid date "${text}": no such day`);
  }
  return days;
}
