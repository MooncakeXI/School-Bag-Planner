import { describe, expect, it } from "vitest";
import { schoolDateToUtcMidnight, toSchoolDate, weekdayOf } from "@/lib/time";

describe("weekdayOf", () => {
  it("maps a known date to the right SCHOOL_TZ weekday", () => {
    // 2026-09-01 is a Tuesday.
    expect(weekdayOf("2026-09-01")).toBe("TUE");
    // 2026-09-07 is a Monday.
    expect(weekdayOf("2026-09-07")).toBe("MON");
  });
});

describe("toSchoolDate", () => {
  it("keeps an instant on the same Bangkok calendar day when it is safely inside it", () => {
    // 2026-09-01 12:00 UTC = 2026-09-01 19:00 Bangkok (+7).
    expect(toSchoolDate(new Date("2026-09-01T12:00:00Z"))).toBe("2026-09-01");
  });

  it("rolls an instant just after UTC midnight forward to the next Bangkok day", () => {
    // 2026-09-01 00:30 UTC = 2026-09-01 07:30 Bangkok — still the 1st.
    expect(toSchoolDate(new Date("2026-09-01T00:30:00Z"))).toBe("2026-09-01");
    // 2026-08-31 18:00 UTC = 2026-09-01 01:00 Bangkok — already the next day.
    expect(toSchoolDate(new Date("2026-08-31T18:00:00Z"))).toBe("2026-09-01");
  });
});

describe("schoolDateToUtcMidnight", () => {
  it("round-trips through toSchoolDate", () => {
    const date = schoolDateToUtcMidnight("2026-09-01");
    expect(date.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(toSchoolDate(date)).toBe("2026-09-01");
  });
});
