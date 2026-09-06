import type { Prisma, PointReason } from "@prisma/client";
import { prisma } from "./prisma";
import { schoolDateToUtcMidnight, toSchoolDate, type SchoolDate } from "./time";
import { requireHomeroomAccessForStudent } from "./roster";
import type { Actor } from "./actor";

// CLAUDE.md invariant 4: points are an append-only ledger. Never store a
// running total on Student — balance is always SUM(delta), and a
// correction is a new negative row, never an update or delete.

// Default only — the live, per-school value lives on School (see
// lib/school-settings.ts) and is what award()'s callers actually use.
// Kept as a display fallback (components/tomorrow-view.tsx) and the school
// columns' own DB default.
export const POINTS_PER_COMPLETION = 20;

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
  opts: { refId?: string; actorUserId?: string; note?: string } = {},
  db: Executor = prisma,
) {
  return db.pointLedger.create({
    data: { studentId, delta, reason, refId: opts.refId, actorUserId: opts.actorUserId, note: opts.note },
  });
}

/**
 * Same append-only insert as award(), but for a penalty whose magnitude is
 * capped at the student's current balance — so the ledger sum can never go
 * negative. Invariant 4 stays intact: balance() itself is never clamped and
 * no existing row is ever mutated, only the size of this one new row is
 * limited at insertion time (a student already at 0 gets a 0-delta row —
 * still an auditable record that a catch happened, just no further point
 * loss to invisibly "owe back" later). Wrapped in its own Serializable
 * transaction, same reasoning as lib/rewards.ts's redeem, so two concurrent
 * penalties can't both read the same balance and jointly overshoot zero.
 */
export async function awardPenaltyCappedAtZero(
  studentId: string,
  maxPenalty: number,
  reason: PointReason,
  opts: { refId?: string; actorUserId?: string } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      const current = await balance(studentId, tx);
      const delta = -Math.min(maxPenalty, Math.max(current, 0));
      return award(studentId, delta, reason, opts, tx);
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * The other half of invariant 7's manual-override story: a homeroom
 * teacher correcting a student's point balance by hand (e.g. reversing a
 * mistaken award, or crediting something the automated flows don't cover),
 * always with a stated reason. Homeroom-gated the same way as
 * `linkParent`/`issueStudentCredentials`/`recordTeacherScan` (`lib/roster.ts`'s
 * `requireHomeroomAccessForStudent`, ARCHITECTURE.md §4.5) — not any subject
 * teacher, and not the automatic `spotCheck`/`awardPenaltyCappedAtZero` path,
 * which is bounded to exactly one day's completion award and never asks for
 * a reason string. `delta` is taken as given, un-capped, positive or
 * negative — unlike `awardPenaltyCappedAtZero`, this is a deliberate,
 * human-reviewed correction, not an automatic penalty computed from a
 * suspected cheat, so there's no "never below zero" floor to enforce here.
 * `note` is required and non-blank — the "reason string" CLAUDE.md calls
 * for — and is the one case `PointLedger.note` is ever set.
 */
export async function manualAdjustPoints(actor: Actor, params: { studentId: string; delta: number; note: string }) {
  await requireHomeroomAccessForStudent(actor, params.studentId);

  const note = params.note.trim();
  if (note === "") throw new Error("A manual point adjustment requires a reason.");
  if (params.delta === 0) throw new Error("A manual point adjustment must be nonzero.");

  return award(params.studentId, params.delta, "MANUAL_ADJUST", { actorUserId: actor.userId, note });
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
