import type { Prisma, PointReason } from "@prisma/client";
import { prisma } from "./prisma";
import { schoolDateToUtcMidnight, toSchoolDate, type SchoolDate } from "./time";

// CLAUDE.md invariant 4: points are an append-only ledger. Never store a
// running total on Student — balance is always SUM(delta), and a
// correction is a new negative row, never an update or delete.

export const POINTS_PER_COMPLETION = 20;
export const MORNING_CHECK_FAIL_PENALTY = 30;

type Executor = Prisma.TransactionClient | typeof prisma;

export async function balance(studentId: string, db: Executor = prisma): Promise<number> {
  const result = await db.pointLedger.aggregate({
    where: { studentId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

/** Single append-only insert. `actorUserId` is the audit trail for a teacher override (invariant 7); omit it for system-awarded rows. */
export async function award(
  studentId: string,
  delta: number,
  reason: PointReason,
  opts: { refId?: string; actorUserId?: string } = {},
  db: Executor = prisma,
) {
  return db.pointLedger.create({
    data: { studentId, delta, reason, refId: opts.refId, actorUserId: opts.actorUserId },
  });
}

/**
 * Streak = consecutive days since the most recent MORNING_CHECK_FAIL (or
 * since forever if there isn't one). Deliberately NOT "consecutive fully
 * packed days" — the design this app follows is explicit that a missed or
 * incomplete evening does not break the streak, only a teacher catching a
 * faked scan does (CLAUDE.md "Anti-cheat": "a mismatch deducts points and
 * breaks the streak"). Reading this off the append-only ledger means no
 * extra mutable counter is needed.
 */
export async function computeStreak(studentId: string, asOf: SchoolDate): Promise<number> {
  const asOfMidnight = schoolDateToUtcMidnight(asOf);
  const lastFail = await prisma.pointLedger.findFirst({
    where: { studentId, reason: "MORNING_CHECK_FAIL", createdAt: { lt: addOneDay(asOfMidnight) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!lastFail) {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { createdAt: true } });
    return daysBetween(student.createdAt, asOfMidnight);
  }
  return daysBetween(lastFail.createdAt, asOfMidnight);
}

function addOneDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

// Both instants are first normalized to a SCHOOL_TZ calendar date (never
// diffed as raw UTC instants — CLAUDE.md's date-handling rule), then
// compared as UTC-midnight day markers, which is safe integer arithmetic.
function daysBetween(from: Date, toMidnight: Date): number {
  const fromMidnight = schoolDateToUtcMidnight(toSchoolDate(from));
  const days = Math.floor((toMidnight.getTime() - fromMidnight.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}
