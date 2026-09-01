import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordScan, getPackingStatus, spotCheck } from "@/lib/packing";
import { balance, computeStreak, POINTS_PER_COMPLETION, MORNING_CHECK_FAIL_PENALTY } from "@/lib/points";
import { PackingWindowClosedError, InvalidScanError, ForbiddenError } from "@/lib/errors";
import { generateCode } from "@/lib/qr";
import { weekdayOf } from "@/lib/time";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

// 2026-09-07 12:00 UTC = 19:00 Bangkok — inside the evening window, and
// schoolTomorrow() from there is 2026-09-08 (a Tuesday).
const EVENING_NOW = new Date("2026-09-07T12:00:00Z");
const TOMORROW = "2026-09-08";
const WEEKDAY = weekdayOf(TOMORROW);

async function seedStudentWithItem(label: string, opts: { grading?: boolean } = {}) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  await prisma.timetableSlot.create({
    data: { classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: subject.id },
  });

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-01-01") },
  });

  const itemCopy = await prisma.itemCopy.create({
    data: { studentId: student.id, subjectItemId: subjectItem.id, state: opts.grading ? "GRADING" : "WITH_STUDENT" },
  });
  const code = generateCode();
  await prisma.qRCode.create({ data: { code, state: "ASSIGNED", itemCopyId: itemCopy.id, boundAt: new Date() } });

  const actor: Actor = { userId: `user-${label}`, teacherId: null, parentId: null, studentId: student.id };
  return { student, itemCopy, code, actor, classroom, subject };
}

async function addSecondItem(label: string, classroomId: string, studentId: string) {
  const subject = await prisma.subject.create({ data: { name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  await prisma.timetableSlot.create({
    data: { classroomId, weekday: WEEKDAY, period: 2, subjectId: subject.id },
  });
  const itemCopy = await prisma.itemCopy.create({
    data: { studentId, subjectItemId: subjectItem.id, state: "WITH_STUDENT" },
  });
  const code = generateCode();
  await prisma.qRCode.create({ data: { code, state: "ASSIGNED", itemCopyId: itemCopy.id, boundAt: new Date() } });
  return { itemCopy, code };
}

describe("packing anti-cheat & completion", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a scan, completes the session, and awards points exactly once", async () => {
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });

    const status = await getPackingStatus(a.student.id, TOMORROW);
    expect(status.isComplete).toBe(true);
    expect(status.items[0].checked).toBe(true);
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);

    // Re-scanning the same book is idempotent, not a double-award.
    await recordScan(a.actor, { code: a.code });
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);
  });

  it("excludes a GRADING item from what's required — invariant 5 holds inside the packing flow too", async () => {
    const a = await seedStudentWithItem("A", { grading: true });
    const status = await getPackingStatus(a.student.id, TOMORROW);
    expect(status.total).toBe(0);
  });

  it("rejects a scan outside the configured evening window", async () => {
    vi.setSystemTime(new Date("2026-09-07T02:00:00Z")); // 09:00 Bangkok
    const a = await seedStudentWithItem("A");
    await expect(recordScan(a.actor, { code: a.code })).rejects.toThrow(PackingWindowClosedError);
  });

  it("rejects scanning another student's item", async () => {
    const a = await seedStudentWithItem("A");
    const b = await seedStudentWithItem("B");
    await expect(recordScan(b.actor, { code: a.code })).rejects.toThrow(ForbiddenError);
  });

  it("rejects an unknown or unassigned code", async () => {
    const a = await seedStudentWithItem("A");
    await expect(recordScan(a.actor, { code: "bk_DOESNOTEXIST0000" })).rejects.toThrow(InvalidScanError);
  });

  it("a session that outlives its TTL does not let a later scan complete it — must finish in one sitting", async () => {
    const a = await seedStudentWithItem("A");
    const second = await addSecondItem("A2", a.classroom.id, a.student.id);

    await recordScan(a.actor, { code: a.code }); // starts session 1, checks item 1

    vi.setSystemTime(new Date(EVENING_NOW.getTime() + 11 * 60 * 1000)); // +11 min, past the 10-min TTL
    await recordScan(a.actor, { code: second.code }); // item 1's session has expired -> fresh session 2

    const sessions = await prisma.packingSession.findMany({ where: { studentId: a.student.id }, orderBy: { startedAt: "asc" } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].status).toBe("EXPIRED");
    // Session 2 only ever saw item 2 checked in its own window, never item 1 — so it can't complete.
    expect(sessions[1].status).toBe("ACTIVE");
    expect(await balance(a.student.id)).toBe(0);

    // The checklist reflects the fresh session's own progress, not the stale one's.
    const status = await getPackingStatus(a.student.id, TOMORROW);
    expect(status.isComplete).toBe(false);
    expect(status.packedCount).toBe(1);
  });
});

describe("computeStreak", () => {
  beforeEach(resetDb);

  it("counts days since student creation when there is no MORNING_CHECK_FAIL yet", async () => {
    const student = await prisma.student.create({
      data: { name: "Manee", createdAt: new Date("2026-09-01T00:00:00Z") },
    });
    const streak = await computeStreak(student.id, "2026-09-08");
    expect(streak).toBe(7);
  });

  it("is unaffected by an incomplete evening — only a MORNING_CHECK_FAIL resets it", async () => {
    const student = await prisma.student.create({
      data: { name: "Manee", createdAt: new Date("2026-09-01T00:00:00Z") },
    });
    // No packing sessions at all for the days in between — streak still counts, per the
    // design's "ลืมของก็ไม่เสียสตรีค" (forgetting something doesn't cost the streak).
    const streak = await computeStreak(student.id, "2026-09-08");
    expect(streak).toBe(7);
  });

  it("resets to days-since-the-fail after a MORNING_CHECK_FAIL", async () => {
    const student = await prisma.student.create({
      data: { name: "Manee", createdAt: new Date("2026-09-01T00:00:00Z") },
    });
    await prisma.pointLedger.create({
      data: {
        studentId: student.id,
        delta: -MORNING_CHECK_FAIL_PENALTY,
        reason: "MORNING_CHECK_FAIL",
        createdAt: new Date("2026-09-05T00:00:00Z"),
      },
    });
    const streak = await computeStreak(student.id, "2026-09-08");
    expect(streak).toBe(3);
  });
});

describe("spotCheck", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deducts points and is auditable when a teacher catches a mismatch", async () => {
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);

    const teacherUser = await prisma.user.create({ data: { email: "teacher-a@example.com" } });
    const teacher = await prisma.teacher.create({
      data: { userId: teacherUser.id, email: teacherUser.email!, name: "Teacher A" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: teacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    // Spot-checks happen the next morning — schoolToday() must land on
    // TOMORROW (the date the evening's session was packed for) for
    // spotCheck to find last night's check.
    vi.setSystemTime(new Date("2026-09-08T02:00:00Z")); // 09:00 Bangkok on the 8th
    await spotCheck(teacherActor, { itemCopyId: a.itemCopy.id, actuallyPacked: false });

    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION - MORNING_CHECK_FAIL_PENALTY);
    const failRow = await prisma.pointLedger.findFirstOrThrow({ where: { studentId: a.student.id, reason: "MORNING_CHECK_FAIL" } });
    expect(failRow.actorUserId).toBe(teacherUser.id);
  });

  it("denies a teacher who doesn't teach that classroom", async () => {
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });

    const outsiderUser = await prisma.user.create({ data: { email: "outsider@example.com" } });
    const outsider = await prisma.teacher.create({
      data: { userId: outsiderUser.id, email: outsiderUser.email!, name: "Outsider" },
    });
    const outsiderActor: Actor = { userId: outsiderUser.id, teacherId: outsider.id, parentId: null, studentId: null };

    await expect(spotCheck(outsiderActor, { itemCopyId: a.itemCopy.id, actuallyPacked: false })).rejects.toThrow(ForbiddenError);
  });
});
