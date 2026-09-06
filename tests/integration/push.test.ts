import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as packingModule from "@/lib/packing";
import { weekdayOf } from "@/lib/time";
import { resetDb } from "../db-utils";

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { sendNotification, setVapidDetails },
  sendNotification,
  setVapidDetails,
}));

// Imported after the mock so lib/push.ts's `import webpush from "web-push"`
// resolves to the mocked module.
const { sendEveningReminders, sendHomeworkDeadlineReminders } = await import("@/lib/push");

// A fixed "now" so schoolTomorrow() is deterministic — push.ts doesn't care
// about time-of-day (unlike lib/packing.ts's anti-cheat windows), only the
// calendar date, so any fixed instant works.
const NOW = new Date("2026-09-07T12:00:00Z"); // 19:00 Bangkok
const TOMORROW = "2026-09-08";
const WEEKDAY = weekdayOf(TOMORROW);

function webPushError(statusCode: number, message = "push failed") {
  return Object.assign(new Error(message), { statusCode });
}

/** A student with one subject scheduled tomorrow and a tracked, unscanned
 * copy of its item — i.e. requiredItemsFor(tomorrow) has a missing item, so
 * sendEveningReminders actually attempts a send for them. */
async function seedStudentWithMissingItem(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const term = await prisma.term.create({
    data: { schoolId: school.id, name: "Term", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
  });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  await prisma.timetableSlot.create({
    data: { termId: term.id, classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: subject.id },
  });

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-01-01") },
  });
  await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: subjectItem.id, state: "WITH_STUDENT" } });

  return { student };
}

async function subscribe(studentId: string, endpoint: string) {
  return prisma.pushSubscription.create({
    data: { studentId, endpoint, p256dh: "p256dh-key", auth: "auth-key" },
  });
}

describe("sendEveningReminders", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sendNotification.mockReset();
    setVapidDetails.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a 500 from one endpoint doesn't stop delivery to everyone else — collected in `failed`, not thrown", async () => {
    const a = await seedStudentWithMissingItem("A");
    const b = await seedStudentWithMissingItem("B");
    await subscribe(a.student.id, "https://push.example.com/dead-500");
    await subscribe(b.student.id, "https://push.example.com/fine");

    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint.includes("dead-500")) return Promise.reject(webPushError(500));
      return Promise.resolve();
    });

    const result = await sendEveningReminders();

    expect(result).toEqual({ sent: 1, pruned: 0, failed: 1 });
    // A 500 is not pruned — the subscription might still be good later.
    const remaining = await prisma.pushSubscription.findMany();
    expect(remaining).toHaveLength(2);
  });

  it("a 410 still prunes that subscription row", async () => {
    const a = await seedStudentWithMissingItem("A");
    const sub = await subscribe(a.student.id, "https://push.example.com/gone-410");

    sendNotification.mockRejectedValue(webPushError(410));

    const result = await sendEveningReminders();

    expect(result).toEqual({ sent: 0, pruned: 1, failed: 0 });
    expect(await prisma.pushSubscription.findUnique({ where: { id: sub.id } })).toBeNull();
  });

  it("a student with two devices triggers exactly one packing-status computation", async () => {
    const a = await seedStudentWithMissingItem("A");
    await subscribe(a.student.id, "https://push.example.com/phone");
    await subscribe(a.student.id, "https://push.example.com/tablet");

    sendNotification.mockResolvedValue(undefined);
    const getPackingStatusSpy = vi.spyOn(packingModule, "getPackingStatus");

    const result = await sendEveningReminders();

    expect(result).toEqual({ sent: 2, pruned: 0, failed: 0 });
    expect(getPackingStatusSpy).toHaveBeenCalledTimes(1);
    expect(getPackingStatusSpy).toHaveBeenCalledWith(a.student.id, TOMORROW);
  });
});

describe("sendHomeworkDeadlineReminders", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sendNotification.mockReset();
    setVapidDetails.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("notifies an enrolled student once when an assignment enters the 24-hour window", async () => {
    const school = await prisma.school.create({ data: { name: "Homework school" } });
    const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "Homework room" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
    const student = await prisma.student.create({ data: { name: "Homework student" } });
    await prisma.enrollment.create({ data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-01-01") } });
    const homework = await prisma.homework.create({
      data: {
        classroomId: classroom.id,
        subjectId: subject.id,
        description: "Finish the worksheet",
        deadlineAt: new Date("2026-09-08T11:00:00Z"),
        postedByUserId: "teacher-user",
      },
    });
    await subscribe(student.id, "https://push.example.com/homework");
    sendNotification.mockResolvedValue(undefined);

    expect(await sendHomeworkDeadlineReminders(NOW)).toEqual({ sent: 1, pruned: 0, failed: 0 });
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({
      title: "การบ้านใกล้ถึงกำหนดส่ง",
      url: "/student/homework",
    });
    expect(await prisma.homeworkReminder.count({ where: { homeworkId: homework.id, studentId: student.id } })).toBe(1);

    // A second scheduled run in the same notice window does not duplicate it.
    expect(await sendHomeworkDeadlineReminders(NOW)).toEqual({ sent: 0, pruned: 0, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("does not keep a delivery receipt if every endpoint fails, allowing a retry", async () => {
    const school = await prisma.school.create({ data: { name: "Retry school" } });
    const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "Retry room" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, name: "Science" } });
    const student = await prisma.student.create({ data: { name: "Retry student" } });
    await prisma.enrollment.create({ data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-01-01") } });
    const homework = await prisma.homework.create({
      data: {
        classroomId: classroom.id,
        subjectId: subject.id,
        description: "Retry assignment",
        deadlineAt: new Date("2026-09-08T11:00:00Z"),
        postedByUserId: "teacher-user",
      },
    });
    await subscribe(student.id, "https://push.example.com/homework-retry");
    sendNotification.mockRejectedValue(webPushError(500));

    expect(await sendHomeworkDeadlineReminders(NOW)).toEqual({ sent: 0, pruned: 0, failed: 1 });
    expect(await prisma.homeworkReminder.count({ where: { homeworkId: homework.id, studentId: student.id } })).toBe(0);
  });
});
