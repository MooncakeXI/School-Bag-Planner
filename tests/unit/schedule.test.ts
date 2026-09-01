import { describe, expect, it } from "vitest";
import { applyExceptions } from "@/lib/schedule";

const slots = [
  { period: 1, subjectId: "math" },
  { period: 2, subjectId: "thai" },
  { period: 3, subjectId: "science" },
];

describe("applyExceptions", () => {
  it("returns the plain timetable on a normal day with no exceptions", () => {
    expect(applyExceptions(slots, [])).toEqual([
      { period: 1, subjectId: "math", source: "timetable" },
      { period: 2, subjectId: "thai", source: "timetable" },
      { period: 3, subjectId: "science", source: "timetable" },
    ]);
  });

  it("wipes the whole day on a school-wide holiday, ignoring any other exceptions", () => {
    const result = applyExceptions(slots, [
      { kind: "HOLIDAY", period: null, subjectId: null },
      { kind: "PERIOD_SWAP", period: 1, subjectId: "english" },
    ]);
    expect(result).toEqual([]);
  });

  it("substitutes the subject for a swapped period, leaving others untouched", () => {
    const result = applyExceptions(slots, [{ kind: "PERIOD_SWAP", period: 2, subjectId: "art" }]);
    expect(result).toEqual([
      { period: 1, subjectId: "math", source: "timetable" },
      { period: 2, subjectId: "art", source: "swap" },
      { period: 3, subjectId: "science", source: "timetable" },
    ]);
  });

  it("drops a cancelled period entirely", () => {
    const result = applyExceptions(slots, [{ kind: "CANCELLED_PERIOD", period: 3, subjectId: null }]);
    expect(result).toEqual([
      { period: 1, subjectId: "math", source: "timetable" },
      { period: 2, subjectId: "thai", source: "timetable" },
    ]);
  });

  it("substitutes the subject for an exam period, tagged distinctly from a swap", () => {
    const result = applyExceptions(slots, [{ kind: "EXAM", period: 1, subjectId: "math" }]);
    expect(result).toEqual([
      { period: 1, subjectId: "math", source: "exam" },
      { period: 2, subjectId: "thai", source: "timetable" },
      { period: 3, subjectId: "science", source: "timetable" },
    ]);
  });

  it("handles multiple exceptions on the same day together", () => {
    const result = applyExceptions(slots, [
      { kind: "CANCELLED_PERIOD", period: 1, subjectId: null },
      { kind: "PERIOD_SWAP", period: 2, subjectId: "art" },
    ]);
    expect(result).toEqual([
      { period: 2, subjectId: "art", source: "swap" },
      { period: 3, subjectId: "science", source: "timetable" },
    ]);
  });
});
