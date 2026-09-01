import { DateTime } from "luxon";
import type { Weekday } from "@prisma/client";

// All scheduling is calendar-day arithmetic in the school's local timezone.
// Store/compare instants in UTC, but a "school day" is a Bangkok calendar
// date, never a `Date` manipulated in the server's local time.
export const SCHOOL_TZ = "Asia/Bangkok";

/** A calendar date in SCHOOL_TZ, formatted 'YYYY-MM-DD'. */
export type SchoolDate = string;

export function schoolNow(): DateTime {
  return DateTime.now().setZone(SCHOOL_TZ);
}

export function schoolToday(): SchoolDate {
  return isoDate(schoolNow());
}

export function schoolTomorrow(): SchoolDate {
  return isoDate(schoolNow().plus({ days: 1 }));
}

/** Which SCHOOL_TZ calendar date a UTC instant falls on. */
export function toSchoolDate(instant: Date): SchoolDate {
  return isoDate(DateTime.fromJSDate(instant, { zone: "utc" }).setZone(SCHOOL_TZ));
}

const WEEKDAY_BY_LUXON: Record<number, Weekday> = {
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THU",
  5: "FRI",
  6: "SAT",
  7: "SUN",
};

export function weekdayOf(date: SchoolDate): Weekday {
  const dt = DateTime.fromISO(date, { zone: SCHOOL_TZ });
  return WEEKDAY_BY_LUXON[dt.weekday];
}

/**
 * A `@db.Date` column stores a bare calendar date with no timezone; Prisma
 * represents it as a JS Date at UTC midnight. Build/read it that way so a
 * school day never shifts by the server's local offset.
 */
export function schoolDateToUtcMidnight(date: SchoolDate): Date {
  return DateTime.fromISO(date, { zone: "utc" }).toJSDate();
}

export function addSchoolDays(date: SchoolDate, days: number): SchoolDate {
  return isoDate(DateTime.fromISO(date, { zone: "utc" }).plus({ days }));
}

/** The Monday of the SCHOOL_TZ week containing `date`. */
export function mondayOf(date: SchoolDate): SchoolDate {
  const dt = DateTime.fromISO(date, { zone: SCHOOL_TZ });
  return isoDate(dt.minus({ days: dt.weekday - 1 }));
}

function isoDate(dt: DateTime): SchoolDate {
  const iso = dt.toISODate();
  if (!iso) throw new Error("Invalid DateTime, cannot format as SchoolDate");
  return iso;
}
