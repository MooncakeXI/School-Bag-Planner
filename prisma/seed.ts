import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";
import type { ItemCopyState } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { SCHOOL_TZ } from "../lib/time";
import { generateCode } from "../lib/qr";
import { generateUniqueStudentCode, generatePassword } from "../lib/student-auth";

// This is the คณิตศาสตร์ (math) teacher's address, so that logging in with
// this Google account (once AUTH_GOOGLE_ID/SECRET are set) auto-links the
// teacher (and parent) role — see the events.signIn hook in auth.ts.
// Deliberately NOT also linked to a Student: app/page.tsx's role priority
// is student > teacher > parent with no picker, so a student-linked
// account would always land on the student view instead of this one's
// actual role. Use one of the issued student code+PIN logins (printed at
// the end of this script) to test the student view instead.
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
  // Dev seed: wipe and recreate, deepest dependents first. QRCode uses
  // onDelete: SetNull (not Cascade) against ItemCopy, so it needs its own
  // explicit wipe here — otherwise every reseed leaves that run's codes
  // behind as orphaned rows (itemCopyId null, state stuck at whatever it
  // was) instead of actually clearing them.
  await prisma.qRCode.deleteMany();
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

  // ป.4/1 - ป.4/8, 20 students each.
  const classrooms = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      prisma.classroom.create({ data: { schoolId: school.id, name: `ป.4/${i + 1}` } }),
    ),
  );
  const classroom = classrooms[0];

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
    const subject = await prisma.subject.create({ data: { schoolId: school.id, name: def.name } });
    const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: def.item } });
    subjects.set(def.name, { id: subject.id, itemId: subjectItem.id });
  }
  const s = (name: (typeof subjectDefs)[number]["name"]) => subjects.get(name)!;

  // One teacher per subject, each covering all 8 classrooms — see the
  // timetable construction below for how their periods stay conflict-free.
  // คณิตศาสตร์ is the one exception: split across two teachers by classroom
  // (DEV_LOGIN_EMAIL only covers 4/1, 4/4, 4/7, 4/8 — a real subject
  // teacher doesn't cover every section of a grade; a second math teacher
  // covers the other 4), so the app has real, seeded data exercising "two
  // different teachers of the same subject at the same school," not just
  // the single-teacher-per-subject case every other subject still is.
  const teacherDefs = [
    { subject: "ภาษาไทย", email: "teacher.thai@example.com", name: "ครูมาลัย สุขใจ" },
    { subject: "วิทยาศาสตร์", email: "teacher.science@example.com", name: "ครูวิชัย ค้นคว้า" },
    { subject: "ภาษาอังกฤษ", email: "teacher.english@example.com", name: "ครูสุดา เก่งภาษา" },
    { subject: "สังคมศึกษา", email: "teacher.social@example.com", name: "ครูประสงค์ รอบรู้" },
    { subject: "พลศึกษา", email: "teacher.pe@example.com", name: "ครูชาติ แข็งแรง" },
  ] as const;

  const teachers = new Map<string, { id: string; name: string; email: string }>();
  for (const def of teacherDefs) {
    const teacher = await prisma.teacher.create({ data: { email: def.email, name: def.name } });
    teachers.set(def.subject, teacher);
  }

  const mathTeacherA = await prisma.teacher.create({ data: { email: DEV_LOGIN_EMAIL, name: "ครูสมศรี ใจดี" } });
  const mathTeacherB = await prisma.teacher.create({ data: { email: "teacher.math2@example.com", name: "ครูอนันต์ เลขคณิต" } });
  teachers.set("คณิตศาสตร์", mathTeacherA); // so the homeroom assignment below still resolves via the same map

  // ป.4/1, 4/4, 4/7, 4/8 (indices 0, 3, 6, 7) — teacher A; the rest — teacher B.
  const mathTeacherAClassroomIndices = new Set([0, 3, 6, 7]);

  await prisma.teachingAssignment.createMany({
    data: [
      ...classrooms.flatMap((cls) =>
        subjectDefs
          .filter((def) => def.name !== "คณิตศาสตร์")
          .map((def) => ({
            teacherId: teachers.get(def.name)!.id,
            classroomId: cls.id,
            subjectId: s(def.name).id,
          })),
      ),
      ...classrooms.map((cls, i) => ({
        teacherId: (mathTeacherAClassroomIndices.has(i) ? mathTeacherA : mathTeacherB).id,
        classroomId: cls.id,
        subjectId: s("คณิตศาสตร์").id,
      })),
    ],
  });

  // ครูประจำชั้น for ป.4/1 (the only classroom with real students below) —
  // the math teacher, so DEV_LOGIN_EMAIL can exercise homeroom-only actions
  // (link parent, reissue login) end to end, not just their own subject.
  await prisma.classroom.update({
    where: { id: classroom.id },
    data: { homeroomTeacherId: teachers.get("คณิตศาสตร์")!.id },
  });

  const parent = await prisma.parent.create({
    data: { email: DEV_LOGIN_EMAIL, name: "ผู้ปกครองของมานี" },
  });

  // 20 students per classroom. ป.4/1 keeps the 5 named ones (they get real
  // login credentials below); the rest are generated placeholders.
  const namedStudents = ["มานี", "ปิติ", "ชูใจ", "วีระ", "สมหญิง"] as const;
  const STUDENTS_PER_CLASSROOM = 20;

  const studentDefs: { id: string; name: string; classroomIndex: number }[] = namedStudents.map((name) => ({
    id: randomUUID(),
    name,
    classroomIndex: 0,
  }));
  for (let c = 0; c < classrooms.length; c++) {
    const alreadyPlaced = c === 0 ? namedStudents.length : 0;
    for (let i = alreadyPlaced; i < STUDENTS_PER_CLASSROOM; i++) {
      const gender = i % 2 === 0 ? "เด็กชาย" : "เด็กหญิง";
      studentDefs.push({
        id: randomUUID(),
        name: `${gender} ${classrooms[c].name} #${String(i + 1).padStart(2, "0")}`,
        classroomIndex: c,
      });
    }
  }
  const maneeId = studentDefs.find((sd) => sd.name === "มานี")!.id;

  await prisma.student.createMany({ data: studentDefs.map((sd) => ({ id: sd.id, name: sd.name })) });

  const enrollStart = DateTime.fromObject({ year: 2026, month: 5, day: 16 }, { zone: SCHOOL_TZ }).toISODate()!;
  await prisma.enrollment.createMany({
    data: studentDefs.map((sd) => ({
      studentId: sd.id,
      classroomId: classrooms[sd.classroomIndex].id,
      startDate: new Date(enrollStart),
    })),
  });

  await prisma.guardianship.create({ data: { parentId: parent.id, studentId: maneeId } });

  // Each subject meets 3x/week per classroom. Since most subjects have
  // exactly one teacher covering all 8 classrooms (instead of one teacher
  // covering every subject in one classroom), that teacher can never be in
  // two classrooms at once — so the same subject's sessions must land on
  // different (weekday, period) slots across classrooms. This mapping
  // guarantees that: for a fixed subject, all 8*3=24 sessions land on
  // distinct slots (out of 30 available), and for a fixed classroom, all
  // 6*3=18 sessions across its subjects land on distinct slots too —
  // modular-arithmetic shift-injectivity, not trial and error. คณิตศาสตร์'s
  // split across two teachers (above) doesn't need anything different here:
  // guaranteeing all 8 classrooms distinct slots is already stricter than
  // the real constraint (each math teacher's own 4 classrooms distinct),
  // so the same per-subject mapping still holds for it unchanged.
  const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
  const PERIODS_PER_DAY = 6;
  const SESSIONS_PER_WEEK = 3;
  const TOTAL_SLOTS = WEEKDAYS.length * PERIODS_PER_DAY;

  function slotFor(classroomIndex: number, subjectIndex: number, session: number) {
    const t = (classroomIndex * 3 + subjectIndex * 5 + session) % TOTAL_SLOTS;
    return { weekday: WEEKDAYS[Math.floor(t / PERIODS_PER_DAY)], period: (t % PERIODS_PER_DAY) + 1 };
  }

  // A timetable is always scoped to a Term (see prisma/schema.prisma's
  // TimetableSlot comment) — this is the one term the dev seed's timetable
  // lives in.
  const term = await prisma.term.create({
    data: { schoolId: school.id, name: "ปีการศึกษา 2569", startDate: new Date("2026-05-01"), endDate: new Date("2027-03-31") },
  });

  await prisma.timetableSlot.createMany({
    data: classrooms.flatMap((cls, c) =>
      subjectDefs.flatMap((def, sIdx) =>
        Array.from({ length: SESSIONS_PER_WEEK }, (_, k) => {
          const { weekday, period } = slotFor(c, sIdx, k);
          return { termId: term.id, classroomId: cls.id, weekday, period, subjectId: s(def.name).id };
        }),
      ),
    ),
  });

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
  // — this must NOT appear in her packing list (invariant 5). Every other
  // copy gets a QR sticker bound immediately so the scanning flow works
  // out of the box in dev — invariant 7 means there is no other way to
  // check an item in, even the PE kit.
  const itemCopyDefs = studentDefs.flatMap((sd) =>
    subjectDefs.map((def) => {
      const isManeesGradedMath = sd.id === maneeId && def.name === "คณิตศาสตร์";
      return {
        id: randomUUID(),
        studentId: sd.id,
        subjectItemId: s(def.name).itemId,
        state: (isManeesGradedMath ? "GRADING" : "WITH_STUDENT") as ItemCopyState,
      };
    }),
  );
  await prisma.itemCopy.createMany({ data: itemCopyDefs });

  await prisma.qRCode.createMany({
    data: itemCopyDefs
      .filter((ic) => ic.state !== "GRADING")
      .map((ic) => ({ code: generateCode(), state: "ASSIGNED" as const, itemCopyId: ic.id, boundAt: new Date() })),
  });

  // A few sample rewards so the redeem flow has something to show.
  await prisma.reward.createMany({
    data: [
      { schoolId: school.id, name: "ดินสอ 2B", cost: 50 },
      { schoolId: school.id, name: "ยางลบก้อนใหญ่", cost: 80 },
      { schoolId: school.id, name: "สมุดโน้ตลายการ์ตูน", cost: 150 },
      { schoolId: school.id, name: "กล่องดินสอ", cost: 300 },
    ],
  });

  // Issue real student-login credentials (code + PIN) for the 5 named
  // students only, so /login's student tab has something to test with —
  // the 155 generated placeholders stay login-less until a teacher issues
  // credentials for them through the app. Mirrors lib/roster.ts's
  // issueStudentCredentials directly (bcrypt hash only, ever) rather than
  // going through it, since this trusted seed script isn't acting as a
  // policy-checked teacher request — the plaintext PIN below is printed
  // once, exactly like the real issuance UI, and is never written anywhere.
  const credentials = [];
  for (const name of namedStudents) {
    const sd = studentDefs.find((x) => x.name === name)!;
    const studentCode = await generateUniqueStudentCode();
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.student.update({ where: { id: sd.id }, data: { studentCode, passwordHash } });
    credentials.push({ name: sd.name, studentCode, password });
  }

  console.log("Seeded:", {
    school: school.name,
    classrooms: classrooms.map((c) => c.name),
    studentsPerClassroom: STUDENTS_PER_CLASSROOM,
    totalStudents: studentDefs.length,
    teachers: [
      ...teacherDefs.map((t) => `${t.name} — ${t.subject} — ${t.email}`),
      `${mathTeacherA.name} — คณิตศาสตร์ (ป.4/1, 4/4, 4/7, 4/8) — ${mathTeacherA.email}`,
      `${mathTeacherB.name} — คณิตศาสตร์ (ป.4/2, 4/3, 4/5, 4/6) — ${mathTeacherB.email}`,
    ],
    parent: parent.name,
    holidayDate,
    swapDate,
    teacherLogin: `${DEV_LOGIN_EMAIL} — Google sign-in lands on the teacher view (คณิตศาสตร์ teacher for ป.4/1, 4/4, 4/7, 4/8, and homeroom of ป.4/1; also linked as parent)`,
  });
  console.log("Student login credentials for the 5 named students (shown once, not stored anywhere):");
  console.table(credentials);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
