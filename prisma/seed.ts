import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../lib/prisma";
import { SCHOOL_TZ } from "../lib/time";
import { generateCode } from "../lib/qr";

// The teacher and parent profiles use this address so that logging in with
// this Google account (once AUTH_GOOGLE_ID/SECRET are set) auto-links both
// roles — see the events.signIn hook in auth.ts — exercising the
// multi-role picker on `/` for real, end to end. Student has no email
// column at all (CLAUDE.md's domain model has no "student login" story —
// it's an open design question, see the roster page's guardian-linking
// flow instead), so there's no equivalent auto-link on first sign-in; if
// this account has already signed in once (a `User` row exists), this
// script links it to Manee directly below so local testing can exercise
// all three roles on one Google account.
const DEV_LOGIN_EMAIL = "suvijak237@gmail.com";

function nextWeekday(target: number): string {
  const now = DateTime.now().setZone(SCHOOL_TZ);
  let d = now.plus({ days: 1 });
  while (d.weekday !== target) d = d.plus({ days: 1 });
  const iso = d.toISODate();
  if (!iso) throw new Error("unreachable");
  return iso;
}

async function main() {
  // Dev seed: wipe and recreate, deepest dependents first.
  await prisma.itemCopy.deleteMany();
  await prisma.scheduleException.deleteMany();
  await prisma.timetableSlot.deleteMany();
  await prisma.teachingAssignment.deleteMany();
  await prisma.guardianship.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.subjectItem.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.parent.deleteMany();
  await prisma.classroom.deleteMany();
  await prisma.school.deleteMany();

  const school = await prisma.school.create({ data: { name: "โรงเรียนบ้านสวนสมบูรณ์" } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "ป.4/1" } });

  const subjectDefs = [
    { name: "คณิตศาสตร์", item: "แบบฝึกหัดคณิตศาสตร์ ป.4" },
    { name: "ภาษาไทย", item: "แบบฝึกหัดภาษาไทย ป.4" },
    { name: "วิทยาศาสตร์", item: "แบบฝึกหัดวิทยาศาสตร์ ป.4" },
    { name: "ภาษาอังกฤษ", item: "แบบฝึกหัดภาษาอังกฤษ ป.4" },
    { name: "สังคมศึกษา", item: "แบบฝึกหัดสังคมศึกษา ป.4" },
    { name: "พลศึกษา", item: "ชุดพลศึกษา" },
  ] as const;

  const subjects = new Map<string, { id: string; itemId: string }>();
  for (const def of subjectDefs) {
    const subject = await prisma.subject.create({ data: { name: def.name } });
    const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: def.item } });
    subjects.set(def.name, { id: subject.id, itemId: subjectItem.id });
  }
  const s = (name: (typeof subjectDefs)[number]["name"]) => subjects.get(name)!;

  const teacher = await prisma.teacher.create({
    data: { email: DEV_LOGIN_EMAIL, name: "ครูสมศรี ใจดี" },
  });
  for (const def of subjectDefs) {
    await prisma.teachingAssignment.create({
      data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: s(def.name).id },
    });
  }

  const parent = await prisma.parent.create({
    data: { email: DEV_LOGIN_EMAIL, name: "ผู้ปกครองของมานี" },
  });

  const devUser = await prisma.user.findUnique({ where: { email: DEV_LOGIN_EMAIL } });

  const studentNames = ["มานี", "ปิติ", "ชูใจ"] as const;
  const students = await Promise.all(
    studentNames.map((name, i) => prisma.student.create({ data: { name, userId: i === 0 ? devUser?.id : undefined } })),
  );
  const [manee] = students;

  const enrollStart = DateTime.fromObject({ year: 2026, month: 5, day: 16 }, { zone: SCHOOL_TZ }).toISODate()!;
  for (const student of students) {
    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        classroomId: classroom.id,
        startDate: new Date(enrollStart),
      },
    });
  }

  await prisma.guardianship.create({ data: { parentId: parent.id, studentId: manee.id } });

  // Weekly timetable — Mon-Fri, 6 periods, cycling through the subjects.
  const week: Record<string, (typeof subjectDefs)[number]["name"][]> = {
    MON: ["คณิตศาสตร์", "ภาษาไทย", "วิทยาศาสตร์", "ภาษาอังกฤษ", "สังคมศึกษา", "พลศึกษา"],
    TUE: ["ภาษาไทย", "คณิตศาสตร์", "ภาษาอังกฤษ", "วิทยาศาสตร์", "พลศึกษา", "สังคมศึกษา"],
    WED: ["วิทยาศาสตร์", "ภาษาอังกฤษ", "คณิตศาสตร์", "ภาษาไทย", "สังคมศึกษา", "พลศึกษา"],
    THU: ["ภาษาอังกฤษ", "วิทยาศาสตร์", "ภาษาไทย", "คณิตศาสตร์", "พลศึกษา", "สังคมศึกษา"],
    FRI: ["สังคมศึกษา", "พลศึกษา", "ภาษาไทย", "คณิตศาสตร์", "วิทยาศาสตร์", "ภาษาอังกฤษ"],
  };
  for (const [weekday, subjectsOfDay] of Object.entries(week)) {
    for (let period = 1; period <= subjectsOfDay.length; period++) {
      await prisma.timetableSlot.create({
        data: {
          classroomId: classroom.id,
          weekday: weekday as "MON" | "TUE" | "WED" | "THU" | "FRI",
          period,
          subjectId: s(subjectsOfDay[period - 1]).id,
        },
      });
    }
  }

  // One school-wide holiday and one classroom period-swap, both landing on
  // a real school day so they're visible in the demo.
  const holidayDate = nextWeekday(1); // next Monday
  const swapDate = nextWeekday(3); // next Wednesday

  await prisma.scheduleException.create({
    data: {
      schoolId: school.id,
      classroomId: null,
      date: new Date(holidayDate),
      kind: "HOLIDAY",
      note: "วันหยุดนักขัตฤกษ์",
    },
  });

  await prisma.scheduleException.create({
    data: {
      schoolId: school.id,
      classroomId: classroom.id,
      date: new Date(swapDate),
      kind: "PERIOD_SWAP",
      period: 1,
      subjectId: s("พลศึกษา").id,
      note: "สลับเป็นพลศึกษาเพื่อซ้อมกีฬาสี",
    },
  });

  // Item copies: each student owns a copy of every subject item, except
  // Manee's math workbook, which is currently with the teacher for grading
  // — this must NOT appear in her packing list (invariant 5). Every copy
  // gets a QR sticker bound immediately so the scanning flow works out of
  // the box in dev — invariant 7 means there is no other way to check an
  // item in, even the PE kit.
  for (const student of students) {
    for (const def of subjectDefs) {
      const isManeesGradedMath = student.id === manee.id && def.name === "คณิตศาสตร์";
      const itemCopy = await prisma.itemCopy.create({
        data: {
          studentId: student.id,
          subjectItemId: s(def.name).itemId,
          state: isManeesGradedMath ? "GRADING" : "WITH_STUDENT",
        },
      });
      if (!isManeesGradedMath) {
        await prisma.qRCode.create({
          data: { code: generateCode(), state: "ASSIGNED", itemCopyId: itemCopy.id, boundAt: new Date() },
        });
      }
    }
  }

  // A few sample rewards so the redeem flow has something to show.
  await prisma.reward.createMany({
    data: [
      { schoolId: school.id, name: "ดินสอ 2B", cost: 50 },
      { schoolId: school.id, name: "ยางลบก้อนใหญ่", cost: 80 },
      { schoolId: school.id, name: "สมุดโน้ตลายการ์ตูน", cost: 150 },
      { schoolId: school.id, name: "กล่องดินสอ", cost: 300 },
    ],
  });

  console.log("Seeded:", {
    school: school.name,
    classroom: classroom.name,
    teacher: teacher.name,
    parent: parent.name,
    students: students.map((st) => st.name),
    holidayDate,
    swapDate,
    studentRoleLinked: devUser
      ? `yes — ${DEV_LOGIN_EMAIL} is now also Manee (มานี)`
      : `no — ${DEV_LOGIN_EMAIL} hasn't signed in yet; re-run this seed after your first real login to also link Manee`,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
