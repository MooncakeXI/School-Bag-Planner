import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { shouldCapturePhoto } from "@/lib/photo-storage";
import { resetDb } from "../db-utils";

async function seedStudentWithItem(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  return { student, subjectItem };
}

/** Creates `count` already-stored (photoPath set) PackingChecks against one
 * (student, subjectItem) pair's single ItemCopy — one PackingSession per
 * check, since the uniqueness that matters here is `itemCopy: {studentId,
 * subjectItemId}`, exactly what shouldCapturePhoto counts against. */
async function createStoredPhotoChecks(studentId: string, subjectItemId: string, count: number) {
  const itemCopy = await prisma.itemCopy.upsert({
    where: { subjectItemId_studentId: { subjectItemId, studentId } },
    create: { studentId, subjectItemId, state: "WITH_STUDENT" },
    update: {},
  });
  for (let i = 0; i < count; i++) {
    const session = await prisma.packingSession.create({
      data: { studentId, forDate: new Date(2026, 0, i + 1), status: "ACTIVE" },
    });
    await prisma.packingCheck.create({
      data: { sessionId: session.id, itemCopyId: itemCopy.id, photoPath: `stub-${i}.jpeg` },
    });
  }
}

// The dataset Phase 4 needs is a few hundred varied photos per item, not
// fifty thousand near-identical shots of the same eight books — see
// ARCHITECTURE.md §8.6. These tests pin the two rules that produce that:
// an unconditional floor per (student, subjectItem), and a sample rate
// past it. Math.random is mocked so the rate check is deterministic rather
// than flaky.
describe("shouldCapturePhoto", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always captures below the minimum-samples floor for that (student, item) pair, regardless of the sample rate", async () => {
    const { student, subjectItem } = await seedStudentWithItem("A");
    vi.spyOn(Math, "random").mockReturnValue(0.99); // would fail the default 10% rate on its own

    expect(await shouldCapturePhoto(student.id, subjectItem.id)).toBe(true);

    await createStoredPhotoChecks(student.id, subjectItem.id, 4); // still under the default floor of 5
    expect(await shouldCapturePhoto(student.id, subjectItem.id)).toBe(true);
  });

  it("once the floor is met, respects the configured sample rate instead", async () => {
    const { student, subjectItem } = await seedStudentWithItem("A");
    await createStoredPhotoChecks(student.id, subjectItem.id, 5); // meets the default floor

    vi.spyOn(Math, "random").mockReturnValue(0.05); // below the default 10% rate
    expect(await shouldCapturePhoto(student.id, subjectItem.id)).toBe(true);

    vi.spyOn(Math, "random").mockReturnValue(0.5); // above the default 10% rate
    expect(await shouldCapturePhoto(student.id, subjectItem.id)).toBe(false);
  });

  it("coverage is scoped per (student, subjectItem) — another student's count doesn't raise this one's floor", async () => {
    const { student: studentA, subjectItem } = await seedStudentWithItem("A");
    const { student: studentB } = await seedStudentWithItem("B");
    await createStoredPhotoChecks(studentB.id, subjectItem.id, 10); // well past the floor, for a DIFFERENT student

    vi.spyOn(Math, "random").mockReturnValue(0.99); // would fail the rate on its own
    expect(await shouldCapturePhoto(studentA.id, subjectItem.id)).toBe(true); // studentA's own count is still 0
  });
});
