import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordScan, recordTeacherScan, getPackingStatus, spotCheck } from "@/lib/packing";
import { balance, computeStreak, manualAdjustPoints, POINTS_PER_COMPLETION } from "@/lib/points";
import { InvalidScanError, ForbiddenError } from "@/lib/errors";
import { generateCode } from "@/lib/qr";
import { weekdayOf, schoolTomorrow } from "@/lib/time";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

// 2026-09-07 12:00 UTC = 19:00 Bangkok — inside the evening window, and
// schoolTomorrow() from there is 2026-09-08 (a Tuesday).
const EVENING_NOW = new Date("2026-09-07T12:00:00Z");
const TOMORROW = "2026-09-08";
const WEEKDAY = weekdayOf(TOMORROW);

// 2026-09-07 23:00 UTC = 2026-09-08 06:00 Bangkok — inside the default
// morning window (05:00-07:30). schoolToday() from there is 2026-09-08,
// i.e. the *same calendar date* the TOMORROW constant names — deliberately,
// so seedStudentWithItem's timetable slot (seeded for TOMORROW's weekday)
// lines up for morning-window tests without a second fixture.
const MORNING_NOW = new Date("2026-09-07T23:00:00Z");
// 2026-09-07 08:00 UTC = 2026-09-07 15:00 Bangkok — also between both
// former packing windows. schoolTomorrow() from here lands on TOMORROW
// (2026-09-08), the date seedStudentWithItem's timetable slot uses.
const BETWEEN_WINDOWS_BEFORE_TOMORROW = new Date("2026-09-07T08:00:00Z");

async function seedStudentWithItem(label: string, opts: { grading?: boolean } = {}) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  const term = await prisma.term.create({
    data: { schoolId: school.id, name: "Term", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
  });
  await prisma.timetableSlot.create({
    data: { termId: term.id, classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: subject.id },
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
  const { schoolId } = await prisma.classroom.findUniqueOrThrow({ where: { id: classroomId }, select: { schoolId: true } });
  const term = await prisma.term.findFirstOrThrow({ where: { schoolId } });
  const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  await prisma.timetableSlot.create({
    data: { termId: term.id, classroomId, weekday: WEEKDAY, period: 2, subjectId: subject.id },
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

  it("allows a scan at 09:00 and targets tomorrow", async () => {
    vi.setSystemTime(new Date("2026-09-07T02:00:00Z")); // 09:00 Bangkok
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });
    expect((await getPackingStatus(a.student.id, TOMORROW)).items[0].checked).toBe(true);
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

  it("a session that outlives its TTL carries its checks forward instead of losing them, marking the next session non-continuous", async () => {
    const a = await seedStudentWithItem("A");
    const second = await addSecondItem("A2", a.classroom.id, a.student.id);

    await recordScan(a.actor, { code: a.code }); // starts session 1, checks item 1

    vi.setSystemTime(new Date(EVENING_NOW.getTime() + 21 * 60 * 1000)); // +21 min, past the 20-min default TTL
    await recordScan(a.actor, { code: second.code }); // session 1 expires; session 2 inherits item 1's check, gets item 2's

    const sessions = await prisma.packingSession.findMany({ where: { studentId: a.student.id }, orderBy: { startedAt: "asc" } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].status).toBe("EXPIRED");
    expect(sessions[1].status).toBe("COMPLETED");
    expect(sessions[1].continuous).toBe(false);

    // The check itself moved onto session 2 — it isn't duplicated or left behind on session 1.
    expect(await prisma.packingCheck.count({ where: { sessionId: sessions[0].id } })).toBe(0);
    expect(await prisma.packingCheck.count({ where: { sessionId: sessions[1].id } })).toBe(2);

    // Progress wasn't discarded, so completion (and its award) still fires.
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);

    const status = await getPackingStatus(a.student.id, TOMORROW);
    expect(status.isComplete).toBe(true);
    expect(status.packedCount).toBe(2);
    expect(status.continuous).toBe(false);
  });

  it("a session completed in one sitting (no expiry) stays marked continuous", async () => {
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });

    const status = await getPackingStatus(a.student.id, TOMORROW);
    expect(status.isComplete).toBe(true);
    expect(status.continuous).toBe(true);
  });

  it("a scan during the morning window (06:00) targets TODAY, not tomorrow", async () => {
    vi.setSystemTime(MORNING_NOW);
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });

    // TOMORROW's calendar date (2026-09-08) is "today" as of MORNING_NOW —
    // that's the whole point being tested here.
    const session = await prisma.packingSession.findFirstOrThrow({ where: { studentId: a.student.id } });
    expect(session.forDate.toISOString().slice(0, 10)).toBe(TOMORROW);
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);
  });

  it("a scan during the evening window (19:00) still targets tomorrow", async () => {
    vi.setSystemTime(EVENING_NOW);
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });

    const session = await prisma.packingSession.findFirstOrThrow({ where: { studentId: a.student.id } });
    expect(session.forDate.toISOString().slice(0, 10)).toBe(TOMORROW);
  });

  it("allows a scan at 15:00 and targets tomorrow", async () => {
    vi.setSystemTime(BETWEEN_WINDOWS_BEFORE_TOMORROW);
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });
    expect((await getPackingStatus(a.student.id, TOMORROW)).items[0].checked).toBe(true);
  });

  it("a session completed in the morning is not re-completed or re-awarded by an evening scan for the same date", async () => {
    // Evening of the 7th packs for the 8th; morning of the 8th also targets
    // the 8th (MORNING_NOW) — same forDate reached through both windows, on
    // consecutive real evenings/mornings. Completing it once must be final.
    vi.setSystemTime(EVENING_NOW);
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);

    vi.setSystemTime(MORNING_NOW);
    await recordScan(a.actor, { code: a.code }); // re-scanning the same, already-packed item

    const sessions = await prisma.packingSession.findMany({ where: { studentId: a.student.id } });
    expect(sessions).toHaveLength(1); // the completed session was reused, not duplicated
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION); // not doubled
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
        delta: -POINTS_PER_COMPLETION,
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
    // spotCheck is homeroom-only (ARCHITECTURE.md §6.4/§10) — a subject
    // teaching assignment alone is not enough.
    await prisma.classroom.update({ where: { id: a.classroom.id }, data: { homeroomTeacherId: teacher.id } });
    const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    // Spot-checks happen the next morning — schoolToday() must land on
    // TOMORROW (the date the evening's session was packed for) for
    // spotCheck to find last night's check.
    vi.setSystemTime(new Date("2026-09-08T02:00:00Z")); // 09:00 Bangkok on the 8th
    await spotCheck(teacherActor, { itemCopyId: a.itemCopy.id, actuallyPacked: false });

    // The penalty reverses that evening's completion award exactly — one
    // catch costs at most one honest evening's worth, never more.
    expect(await balance(a.student.id)).toBe(0);
    const failRow = await prisma.pointLedger.findFirstOrThrow({ where: { studentId: a.student.id, reason: "MORNING_CHECK_FAIL" } });
    expect(failRow.actorUserId).toBe(teacherUser.id);
    expect(failRow.delta).toBe(-POINTS_PER_COMPLETION);
  });

  it("floors the penalty at the student's current balance — never drives the ledger sum negative", async () => {
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);

    const teacherUser = await prisma.user.create({ data: { email: "teacher-floor@example.com" } });
    const teacher = await prisma.teacher.create({
      data: { userId: teacherUser.id, email: teacherUser.email!, name: "Teacher Floor" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: teacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    await prisma.classroom.update({ where: { id: a.classroom.id }, data: { homeroomTeacherId: teacher.id } });
    const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    vi.setSystemTime(new Date("2026-09-08T02:00:00Z"));
    await spotCheck(teacherActor, { itemCopyId: a.itemCopy.id, actuallyPacked: false });
    expect(await balance(a.student.id)).toBe(0);

    // A second catch while the balance is already 0 costs nothing further
    // — the sum must never go negative — but is still recorded (a
    // zero-delta row), so the audit trail and streak reset still happen.
    await spotCheck(teacherActor, { itemCopyId: a.itemCopy.id, actuallyPacked: false });
    expect(await balance(a.student.id)).toBe(0);

    const failRows = await prisma.pointLedger.findMany({ where: { studentId: a.student.id, reason: "MORNING_CHECK_FAIL" } });
    expect(failRows).toHaveLength(2);
    expect(failRows[1].delta).toBe(0);
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

  it("the homeroom teacher can spot-check any subject's item in their classroom, not just their own", async () => {
    const a = await seedStudentWithItem("A");
    const second = await addSecondItem("A2", a.classroom.id, a.student.id); // a different subject's item
    await recordScan(a.actor, { code: a.code });
    await recordScan(a.actor, { code: second.code });
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);

    const teacherUser = await prisma.user.create({ data: { email: "homeroom-a@example.com" } });
    const teacher = await prisma.teacher.create({
      data: { userId: teacherUser.id, email: teacherUser.email!, name: "Homeroom Teacher" },
    });
    // Only assigned to teach the FIRST subject — the point is that homeroom
    // status alone, not a matching TeachingAssignment, is what authorizes
    // spot-checking the second (unrelated) subject's item below.
    await prisma.teachingAssignment.create({
      data: { teacherId: teacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    await prisma.classroom.update({ where: { id: a.classroom.id }, data: { homeroomTeacherId: teacher.id } });
    const homeroomActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    vi.setSystemTime(new Date("2026-09-08T02:00:00Z"));
    await spotCheck(homeroomActor, { itemCopyId: second.itemCopy.id, actuallyPacked: false });

    expect(await balance(a.student.id)).toBe(0);
    const failRow = await prisma.pointLedger.findFirstOrThrow({ where: { studentId: a.student.id, reason: "MORNING_CHECK_FAIL" } });
    expect(failRow.actorUserId).toBe(teacherUser.id);
  });

  it("a subject teacher assigned to the same classroom, but not homeroom, is denied", async () => {
    const a = await seedStudentWithItem("A");
    await recordScan(a.actor, { code: a.code });

    const subjectTeacherUser = await prisma.user.create({ data: { email: "subject-teacher-spotcheck@example.com" } });
    const subjectTeacher = await prisma.teacher.create({
      data: { userId: subjectTeacherUser.id, email: subjectTeacherUser.email!, name: "Subject Teacher" },
    });
    // Genuinely teaches this classroom (unlike the "outsider" test above) —
    // the denial here is specifically about not being homeroom.
    await prisma.teachingAssignment.create({
      data: { teacherId: subjectTeacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    const subjectActor: Actor = { userId: subjectTeacherUser.id, teacherId: subjectTeacher.id, parentId: null, studentId: null };

    vi.setSystemTime(new Date("2026-09-08T02:00:00Z"));
    await expect(spotCheck(subjectActor, { itemCopyId: a.itemCopy.id, actuallyPacked: false })).rejects.toThrow(ForbiddenError);
  });
});

describe("recordTeacherScan", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(BETWEEN_WINDOWS_BEFORE_TOMORROW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a homeroom teacher's scan awards points to the student", async () => {
    const a = await seedStudentWithItem("A");
    const teacherUser = await prisma.user.create({ data: { email: "homeroom-pack@example.com" } });
    const teacher = await prisma.teacher.create({
      data: { userId: teacherUser.id, email: teacherUser.email!, name: "Homeroom Teacher" },
    });
    await prisma.classroom.update({ where: { id: a.classroom.id }, data: { homeroomTeacherId: teacher.id } });
    const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    await recordTeacherScan(teacherActor, { studentId: a.student.id, code: a.code });

    const status = await getPackingStatus(a.student.id, schoolTomorrow());
    expect(status.isComplete).toBe(true);
    expect(await balance(a.student.id)).toBe(POINTS_PER_COMPLETION);
  });

  it("stamps startedByUserId with the acting teacher's userId; an ordinary student scan leaves it null", async () => {
    const a = await seedStudentWithItem("A");
    const teacherUser = await prisma.user.create({ data: { email: "homeroom-audit@example.com" } });
    const teacher = await prisma.teacher.create({
      data: { userId: teacherUser.id, email: teacherUser.email!, name: "Homeroom Teacher" },
    });
    await prisma.classroom.update({ where: { id: a.classroom.id }, data: { homeroomTeacherId: teacher.id } });
    const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    await recordTeacherScan(teacherActor, { studentId: a.student.id, code: a.code });
    const teacherRunSession = await prisma.packingSession.findFirstOrThrow({ where: { studentId: a.student.id } });
    expect(teacherRunSession.startedByUserId).toBe(teacherUser.id);

    // Same instant, different student: ordinary student scans remain
    // unattributed even though scanning is now allowed at any time.
    const b = await seedStudentWithItem("B");
    await recordScan(b.actor, { code: b.code });
    const studentRunSession = await prisma.packingSession.findFirstOrThrow({ where: { studentId: b.student.id } });
    expect(studentRunSession.startedByUserId).toBeNull();
  });

  it("a non-homeroom subject teacher in the same classroom is denied", async () => {
    const a = await seedStudentWithItem("A");
    const subjectTeacherUser = await prisma.user.create({ data: { email: "subject-pack@example.com" } });
    const subjectTeacher = await prisma.teacher.create({
      data: { userId: subjectTeacherUser.id, email: subjectTeacherUser.email!, name: "Subject Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: subjectTeacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    const subjectActor: Actor = { userId: subjectTeacherUser.id, teacherId: subjectTeacher.id, parentId: null, studentId: null };

    await expect(recordTeacherScan(subjectActor, { studentId: a.student.id, code: a.code })).rejects.toThrow(ForbiddenError);
  });
});

describe("manualAdjustPoints", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seedHomeroomTeacher(label: string, classroomId: string) {
    const user = await prisma.user.create({ data: { email: `homeroom-adjust-${label}@example.com` } });
    const teacher = await prisma.teacher.create({ data: { userId: user.id, email: user.email!, name: `Homeroom ${label}` } });
    await prisma.classroom.update({ where: { id: classroomId }, data: { homeroomTeacherId: teacher.id } });
    const actor: Actor = { userId: user.id, teacherId: teacher.id, parentId: null, studentId: null };
    return { user, teacher, actor };
  }

  it("a homeroom teacher's positive adjustment is recorded with the note and audit trail, and adds to the balance", async () => {
    const a = await seedStudentWithItem("A");
    const { user, actor } = await seedHomeroomTeacher("A", a.classroom.id);

    await manualAdjustPoints(actor, { studentId: a.student.id, delta: 15, note: "ช่วยเพื่อนจัดกระเป๋า" });

    expect(await balance(a.student.id)).toBe(15);
    const row = await prisma.pointLedger.findFirstOrThrow({ where: { studentId: a.student.id, reason: "MANUAL_ADJUST" } });
    expect(row.delta).toBe(15);
    expect(row.note).toBe("ช่วยเพื่อนจัดกระเป๋า");
    expect(row.actorUserId).toBe(user.id);
  });

  it("allows a negative adjustment even below the student's current balance — a deliberate correction, not the anti-cheat floor-at-zero penalty", async () => {
    const a = await seedStudentWithItem("A");
    const { actor } = await seedHomeroomTeacher("B", a.classroom.id);

    await manualAdjustPoints(actor, { studentId: a.student.id, delta: -5, note: "แก้ไขแต้มที่ให้ผิด" });

    expect(await balance(a.student.id)).toBe(-5);
  });

  it("rejects a blank reason", async () => {
    const a = await seedStudentWithItem("A");
    const { actor } = await seedHomeroomTeacher("C", a.classroom.id);

    await expect(manualAdjustPoints(actor, { studentId: a.student.id, delta: 10, note: "   " })).rejects.toThrow();
    expect(await balance(a.student.id)).toBe(0);
  });

  it("rejects a zero delta", async () => {
    const a = await seedStudentWithItem("A");
    const { actor } = await seedHomeroomTeacher("D", a.classroom.id);

    await expect(manualAdjustPoints(actor, { studentId: a.student.id, delta: 0, note: "เหตุผล" })).rejects.toThrow();
  });

  it("denies a subject teacher who isn't homeroom", async () => {
    const a = await seedStudentWithItem("A");
    const subjectTeacherUser = await prisma.user.create({ data: { email: "subject-adjust@example.com" } });
    const subjectTeacher = await prisma.teacher.create({
      data: { userId: subjectTeacherUser.id, email: subjectTeacherUser.email!, name: "Subject Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: subjectTeacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    const subjectActor: Actor = { userId: subjectTeacherUser.id, teacherId: subjectTeacher.id, parentId: null, studentId: null };

    await expect(
      manualAdjustPoints(subjectActor, { studentId: a.student.id, delta: 10, note: "เหตุผล" }),
    ).rejects.toThrow(ForbiddenError);
  });
});
