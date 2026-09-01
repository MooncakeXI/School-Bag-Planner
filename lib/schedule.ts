import type { ExceptionKind } from "@prisma/client";

// Pure — no DB access. Callers fetch the weekday's slots and the date's
// exceptions, already scoped to one classroom/school-wide, and this
// function reconciles them (CLAUDE.md invariant 6: exceptions are the
// normal case, not an edge case).

export type TimetableSlotLike = {
  period: number;
  subjectId: string;
};

export type ScheduleExceptionLike = {
  kind: ExceptionKind;
  period: number | null;
  subjectId: string | null;
};

export type EffectiveSlot = {
  period: number;
  subjectId: string;
  source: "timetable" | "swap" | "exam";
};

export function applyExceptions(
  slots: TimetableSlotLike[],
  exceptions: ScheduleExceptionLike[],
): EffectiveSlot[] {
  if (exceptions.some((e) => e.kind === "HOLIDAY")) {
    return [];
  }

  const byPeriod = new Map<number, EffectiveSlot>();
  for (const slot of slots) {
    byPeriod.set(slot.period, { period: slot.period, subjectId: slot.subjectId, source: "timetable" });
  }

  for (const exception of exceptions) {
    if (exception.period == null) continue;

    if (exception.kind === "CANCELLED_PERIOD") {
      byPeriod.delete(exception.period);
      continue;
    }

    if ((exception.kind === "PERIOD_SWAP" || exception.kind === "EXAM") && exception.subjectId != null) {
      byPeriod.set(exception.period, {
        period: exception.period,
        subjectId: exception.subjectId,
        source: exception.kind === "EXAM" ? "exam" : "swap",
      });
    }
  }

  return Array.from(byPeriod.values()).sort((a, b) => a.period - b.period);
}
