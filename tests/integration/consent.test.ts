import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { recordScan } from "@/lib/packing";
import { hasActiveConsent, grantConsentOnline, recordPaperConsent, revokeConsent, CURRENT_CONSENT_VERSION } from "@/lib/consent";
import { localPhotoFilePath, photoStorage } from "@/lib/photo-storage";
import { generateCode } from "@/lib/qr";
import { weekdayOf } from "@/lib/time";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

// 2026-09-07 12:00 UTC = 19:00 Bangkok — inside the evening window, and
// schoolTomorrow() from there is 2026-09-08 (a Tuesday).
const EVENING_NOW = new Date("2026-09-07T12:00:00Z");
const TOMORROW = "2026-09-08";
const WEEKDAY = weekdayOf(TOMORROW);

// A minimal valid 1x1 PNG data URL — matches lib/photo-storage.ts's
// savePhoto regex (`data:image/(png|jpe?g|webp);base64,...`).
const PHOTO_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function seedStudentWithItem(label: string) {
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
    data: { studentId: student.id, subjectItemId: subjectItem.id, state: "WITH_STUDENT" },
  });
  const code = generateCode();
  await prisma.qRCode.create({ data: { code, state: "ASSIGNED", itemCopyId: itemCopy.id, boundAt: new Date() } });

  const actor: Actor = { userId: `user-${label}`, teacherId: null, parentId: null, studentId: student.id };
  return { school, classroom, subject, student, itemCopy, code, actor };
}

/** Same fixture plus a guardian parent and the classroom's homeroom
 * teacher — everything lib/consent.ts's three mutating functions need an
 * actor for. */
async function seedFamilyAndHomeroom(label: string) {
  const base = await seedStudentWithItem(label);

  const parentUser = await prisma.user.create({ data: { email: `parent-${label}@example.com` } });
  const parent = await prisma.parent.create({
    data: { userId: parentUser.id, email: parentUser.email!, name: `Parent ${label}` },
  });
  await prisma.guardianship.create({ data: { parentId: parent.id, studentId: base.student.id } });
  const parentActor: Actor = { userId: parentUser.id, teacherId: null, parentId: parent.id, studentId: null };

  const teacherUser = await prisma.user.create({ data: { email: `homeroom-${label}@example.com` } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: `Homeroom ${label}` },
  });
  await prisma.teachingAssignment.create({
    data: { teacherId: teacher.id, classroomId: base.classroom.id, subjectId: base.subject.id },
  });
  await prisma.classroom.update({ where: { id: base.classroom.id }, data: { homeroomTeacherId: teacher.id } });
  const homeroomActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

  return { ...base, parentActor, homeroomActor };
}

describe("recordScan + photo capture consent", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("with no consent on file, the scan still succeeds but the photo is not saved", async () => {
    const a = await seedStudentWithItem("A");

    const result = await recordScan(a.actor, { code: a.code, photoDataUrl: PHOTO_DATA_URL });
    expect(result.itemCopyId).toBe(a.itemCopy.id);

    const check = await prisma.packingCheck.findFirstOrThrow({ where: { itemCopyId: a.itemCopy.id } });
    expect(check.photoPath).toBeNull();
  });

  it("with active consent on file, the photo is actually written and referenced", async () => {
    const a = await seedStudentWithItem("A");
    await prisma.consent.create({
      data: {
        studentId: a.student.id,
        scope: "PHOTO_CAPTURE",
        version: CURRENT_CONSENT_VERSION.PHOTO_CAPTURE,
        method: "ONLINE",
      },
    });

    await recordScan(a.actor, { code: a.code, photoDataUrl: PHOTO_DATA_URL });

    const check = await prisma.packingCheck.findFirstOrThrow({ where: { itemCopyId: a.itemCopy.id } });
    expect(check.photoPath).not.toBeNull();
    const filePath = localPhotoFilePath(check.photoPath!);
    expect(existsSync(filePath)).toBe(true);
    await unlink(filePath); // this test's own cleanup — nothing under test deletes it
  });

  it("still records the scan when optional photo storage is unavailable", async () => {
    const a = await seedStudentWithItem("storage-down");
    await prisma.consent.create({
      data: {
        studentId: a.student.id,
        scope: "PHOTO_CAPTURE",
        version: CURRENT_CONSENT_VERSION.PHOTO_CAPTURE,
        method: "ONLINE",
      },
    });
    vi.spyOn(photoStorage, "save").mockRejectedValueOnce(new Error("read-only filesystem"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(recordScan(a.actor, { code: a.code, photoDataUrl: PHOTO_DATA_URL })).resolves.toEqual({
      itemCopyId: a.itemCopy.id,
    });
    const check = await prisma.packingCheck.findFirstOrThrow({ where: { itemCopyId: a.itemCopy.id } });
    expect(check.photoPath).toBeNull();
  });

  it("a consent row whose version no longer matches the current one counts as absent", async () => {
    const a = await seedStudentWithItem("A");
    await prisma.consent.create({
      data: { studentId: a.student.id, scope: "PHOTO_CAPTURE", version: "0-stale", method: "ONLINE" },
    });

    expect(await hasActiveConsent(a.student.id, "PHOTO_CAPTURE")).toBe(false);

    await recordScan(a.actor, { code: a.code, photoDataUrl: PHOTO_DATA_URL });
    const check = await prisma.packingCheck.findFirstOrThrow({ where: { itemCopyId: a.itemCopy.id } });
    expect(check.photoPath).toBeNull();
  });
});

describe("lib/consent.ts", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a parent can grant online consent for their own child", async () => {
    const f = await seedFamilyAndHomeroom("A");

    const consent = await grantConsentOnline(f.parentActor, { studentId: f.student.id, scope: "PHOTO_CAPTURE" });
    expect(consent.method).toBe("ONLINE");
    expect(consent.grantedByParentId).toBe(f.parentActor.parentId);
    expect(consent.recordedByUserId).toBeNull();
    expect(await hasActiveConsent(f.student.id, "PHOTO_CAPTURE")).toBe(true);
  });

  it("a parent is denied granting consent for a child they don't guard", async () => {
    const a = await seedFamilyAndHomeroom("A");
    const b = await seedFamilyAndHomeroom("B");

    await expect(grantConsentOnline(a.parentActor, { studentId: b.student.id, scope: "PHOTO_CAPTURE" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("the homeroom teacher can record a paper consent form", async () => {
    const f = await seedFamilyAndHomeroom("A");

    const consent = await recordPaperConsent(f.homeroomActor, { studentId: f.student.id, scope: "PHOTO_CAPTURE" });
    expect(consent.method).toBe("PAPER");
    expect(consent.recordedByUserId).toBe(f.homeroomActor.userId);
    expect(consent.grantedByParentId).toBeNull();
    expect(await hasActiveConsent(f.student.id, "PHOTO_CAPTURE")).toBe(true);
  });

  it("a subject teacher who isn't homeroom is denied recording a paper form", async () => {
    const f = await seedFamilyAndHomeroom("A");

    const outsiderUser = await prisma.user.create({ data: { email: "outsider-teacher@example.com" } });
    const outsider = await prisma.teacher.create({
      data: { userId: outsiderUser.id, email: outsiderUser.email!, name: "Outsider" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: outsider.id, classroomId: f.classroom.id, subjectId: f.subject.id },
    });
    const outsiderActor: Actor = { userId: outsiderUser.id, teacherId: outsider.id, parentId: null, studentId: null };

    await expect(recordPaperConsent(outsiderActor, { studentId: f.student.id, scope: "PHOTO_CAPTURE" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("revoking deletes every stored photo and nulls its reference, without deleting the historical consent record", async () => {
    const f = await seedFamilyAndHomeroom("A");
    await grantConsentOnline(f.parentActor, { studentId: f.student.id, scope: "PHOTO_CAPTURE" });

    await recordScan(f.actor, { code: f.code, photoDataUrl: PHOTO_DATA_URL });
    const before = await prisma.packingCheck.findFirstOrThrow({ where: { itemCopyId: f.itemCopy.id } });
    expect(before.photoPath).not.toBeNull();
    const filePath = localPhotoFilePath(before.photoPath!);
    expect(existsSync(filePath)).toBe(true);

    await revokeConsent(f.parentActor, { studentId: f.student.id, scope: "PHOTO_CAPTURE" });

    const after = await prisma.packingCheck.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.photoPath).toBeNull();
    expect(existsSync(filePath)).toBe(false);

    expect(await hasActiveConsent(f.student.id, "PHOTO_CAPTURE")).toBe(false);
    // Marked revoked, never deleted — the historical record of what was
    // once granted (and when it was withdrawn) survives.
    const consentRow = await prisma.consent.findFirstOrThrow({ where: { studentId: f.student.id } });
    expect(consentRow.revokedAt).not.toBeNull();
  });

  it("revoking with no active consent is a no-op, not an error", async () => {
    const f = await seedFamilyAndHomeroom("A");
    await expect(revokeConsent(f.parentActor, { studentId: f.student.id, scope: "PHOTO_CAPTURE" })).resolves.toBeUndefined();
  });
});
