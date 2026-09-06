import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";
import type { ItemCopyState } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { SCHOOL_TZ } from "../lib/time";
import { generateCode } from "../lib/qr";
import { generateUniqueStudentCode, generatePassword } from "../lib/student-auth";

// This is the ป.ปลาย (senior primary, ป.4-6) math teacher's address, so that
// logging in with this Google account (once AUTH_GOOGLE_ID/SECRET are set)
// auto-links the teacher (and parent) role — see the events.signIn hook in
// auth.ts. Deliberately NOT also linked to a Student: app/page.tsx's role
// priority is student > teacher > parent with no picker, so a
// student-linked account would always land on the student view instead of
// this one's actual role. Use one of the issued student code+PIN logins
// (printed at the end of this script) to test the student view instead.
const DEV_LOGIN_EMAIL = "suvijak237@gmail.com";

function nextWeekday(target: number): string {
  const now = DateTime.now().setZone(SCHOOL_TZ);
  let d = now.plus({ days: 1 });
  while (d.weekday !== target) d = d.plus({ days: 1 });
  const iso = d.toISODate();
  if (!iso) throw new Error("unreachable");
  return iso;
}

const GRADES = [1, 2, 3, 4, 5, 6];
const SECTIONS_PER_GRADE = 4;
const STUDENTS_PER_CLASSROOM = 15;

// Grade 4 section 1 is the one classroom with real, testable data (named
// students, issued logins, homeroom teacher = DEV_LOGIN_EMAIL) — every other
// classroom is just enough to make the school look real and to exercise a
// conflict-free multi-grade timetable.
const FEATURED_GRADE = 4;
const FEATURED_SECTION = 1;

// Each grade gets its own Subject per subject name (e.g. "คณิตศาสตร์ ป.1" is
// a different Subject row from "คณิตศาสตร์ ป.6"), each with its own single
// SubjectItem — a ป.1 kid's workbook is physically a different book from a
// ป.6 kid's. This is the same "SubjectItem is per-subject, never shared
// across an unrelated scope" invariant as ever; it just means "subject" here
// is scoped per grade rather than assumed to mean one grade school-wide, the
// way the original single-grade (ป.4-only) seed could get away with. It also
// means every existing catalog/roster/dashboard query (which already scopes
// by whichever Subject a classroom's own TimetableSlot/TeachingAssignment
// points at) needs no changes at all — a ป.1 classroom's queries simply never
// see a ป.6 Subject in the first place.
const SUBJECT_DEFS = [
  { name: "คณิตศาสตร์", slug: "math" },
  { name: "ภาษาไทย", slug: "thai" },
  { name: "วิทยาศาสตร์", slug: "science" },
  { name: "ภาษาอังกฤษ", slug: "english" },
  { name: "สังคมศึกษา", slug: "social" },
  { name: "พลศึกษา", slug: "pe" },
] as const;

function itemNameFor(subjectName: string, grade: number): string {
  return subjectName === "พลศึกษา" ? `ชุดพลศึกษา ป.${grade}` : `แบบฝึกหัด${subjectName} ป.${grade}`;
}

// Deterministic name generator for the 36 (grade × subject) teachers — no
// need for 36 hand-picked names, just enough variety that they don't all
// look identical in a roster list.
const TEACHER_FIRST_NAMES = ["สมศรี", "วิชัย", "สุดา", "ประสงค์", "ชาติ", "มาลัย"];
const TEACHER_LAST_NAMES = ["ใจดี", "ค้นคว้า", "เก่งภาษา", "รอบรู้", "แข็งแรง", "สุขใจ"];

// Real test accounts: a (grade, subject-slug) slot gets a real Google email
// + display name instead of the generated @example.com one, so signing in
// with that Google account auto-links (auth.ts's events.signIn) straight to
// this teacher. Add one entry per person you want to hand a working login
// covering an *entire* grade's 4 sections. (DEV_LOGIN_EMAIL isn't here — it
// covers only one section across three grades, which needs the separate
// SENIOR_MATH_GRADES handling below instead; see that block's comment.)
const TEACHER_OVERRIDES: { grade: number; slug: string; email: string; name: string }[] = [
  { grade: 3, slug: "english", email: "anongpat2805@gmail.com", name: "ครูอนงค์ภัทร ภาษาดี" },
  { grade: 2, slug: "science", email: "queenam9009@gmail.com", name: "ครูควีนอำ วิทย์ดี" },
  { grade: 1, slug: "thai", email: "chanthima9986@gmail.com", name: "ครูจันทิมา ภาษาไทยดี" },
  { grade: 5, slug: "social", email: "uumaporn57@gmail.com", name: "ครูอุมาพร สังคมดี" },
  { grade: 6, slug: "pe", email: "0992471574c@gmail.com", name: "ครูพลานามัย แข็งแรง" },
];

// Classrooms that get a real ครูประจำชั้น from the whole-grade overrides
// above — the classroom's own homeroom teacher must be one of the teachers
// already teaching there (any subject works; picking the overridden one
// just means that same test login gets homeroom-only actions, not merely
// their own subject's items). The featured classroom's homeroom (its
// teacher comes from SENIOR_MATH_GRADES instead) is set separately below.
const HOMEROOM_OVERRIDES: { grade: number; section: number; teacherGrade: number; teacherSlug: string }[] = [
  { grade: 3, section: 1, teacherGrade: 3, teacherSlug: "english" },
  { grade: 1, section: 1, teacherGrade: 1, teacherSlug: "thai" },
  { grade: 6, section: 1, teacherGrade: 6, teacherSlug: "pe" },
];

// DEV_LOGIN_EMAIL teaches คณิตศาสตร์ for ป.ปลาย (senior primary) — but only
// section 1 of each of ป.4-6, not every section: covering all 12 ป.4-6
// classrooms at 3 sessions/week each would need 36 slots, over one
// teacher's 30-slot weekly capacity. Each grade's *other* 3 sections keep
// their own default per-grade math teacher (created normally below); only
// section 1's TeachingAssignment gets reassigned to this one shared teacher.
const SENIOR_MATH_GRADES = [4, 5, 6];
const SENIOR_MATH_SECTION = 1;

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

  // ป.1/1 - ป.6/4, grade-major order (grade outer, section inner) — the
  // conflict-free timetable formula below relies on each grade's 4 sections
  // landing on 4 *consecutive* indices in this array.
  const classroomDefs = GRADES.flatMap((grade) =>
    Array.from({ length: SECTIONS_PER_GRADE }, (_, i) => ({ grade, section: i + 1 })),
  );
  // One batched createMany, not 24 parallel create() calls — each parallel
  // call opens its own connection, and Supabase's session-mode pooler caps
  // out at pool_size (15) concurrent clients, well under 24.
  const classroomIds = classroomDefs.map(() => randomUUID());
  await prisma.classroom.createMany({
    data: classroomDefs.map((cd, i) => ({ id: classroomIds[i], schoolId: school.id, name: `ป.${cd.grade}/${cd.section}` })),
  });
  function classroomAt(grade: number, section: number): string {
    const index = classroomDefs.findIndex((cd) => cd.grade === grade && cd.section === section);
    return classroomIds[index];
  }

  // One Subject + one SubjectItem per (grade, subject name), one Teacher
  // covering that grade's 4 sections for that one subject — a real subject
  // teacher teaches a grade level, not the whole school (6 grades × 4
  // sections × 3 sessions/week would be triple a teacher's own weekly
  // capacity of 30 slots). This also means "two different teachers of the
  // same subject at the same school" (คณิตศาสตร์ ป.1's teacher vs.
  // คณิตศาสตร์ ป.6's teacher) falls out for free, without a special case.
  type GradeSubject = {
    grade: number;
    defIndex: number;
    subjectId: string;
    itemId: string;
    teacherId: string;
    teacherEmail: string;
    teacherName: string;
  };

  const gradeSubjects: GradeSubject[] = [];
  for (const grade of GRADES) {
    SUBJECT_DEFS.forEach((def, defIndex) => {
      const override = TEACHER_OVERRIDES.find((o) => o.grade === grade && o.slug === def.slug);
      gradeSubjects.push({
        grade,
        defIndex,
        subjectId: randomUUID(),
        itemId: randomUUID(),
        teacherId: randomUUID(),
        teacherEmail: override?.email ?? `teacher.${def.slug}.g${grade}@example.com`,
        teacherName:
          override?.name ??
          `ครู${TEACHER_FIRST_NAMES[(grade + defIndex) % TEACHER_FIRST_NAMES.length]}${TEACHER_LAST_NAMES[(grade * 2 + defIndex) % TEACHER_LAST_NAMES.length]}`,
      });
    });
  }
  const gradeSubjectByKey = new Map(gradeSubjects.map((gs) => [`${gs.grade}-${gs.defIndex}`, gs]));

  await prisma.subject.createMany({
    data: gradeSubjects.map((gs) => ({ id: gs.subjectId, schoolId: school.id, name: `${SUBJECT_DEFS[gs.defIndex].name} ป.${gs.grade}` })),
  });
  await prisma.subjectItem.createMany({
    data: gradeSubjects.map((gs) => ({ id: gs.itemId, subjectId: gs.subjectId, name: itemNameFor(SUBJECT_DEFS[gs.defIndex].name, gs.grade) })),
  });
  await prisma.teacher.createMany({
    data: gradeSubjects.map((gs) => ({ id: gs.teacherId, email: gs.teacherEmail, name: gs.teacherName })),
  });

  await prisma.teachingAssignment.createMany({
    data: gradeSubjects.flatMap((gs) =>
      Array.from({ length: SECTIONS_PER_GRADE }, (_, i) => ({
        teacherId: gs.teacherId,
        classroomId: classroomAt(gs.grade, i + 1),
        subjectId: gs.subjectId,
      })),
    ),
  });

  // ครูประจำชั้น — each override classroom gets one of its own subject
  // teachers as homeroom, so that teacher can exercise homeroom-only actions
  // (link parent, reissue login, spot-check) end to end, not just their own
  // subject's items.
  for (const ho of HOMEROOM_OVERRIDES) {
    const defIndex = SUBJECT_DEFS.findIndex((def) => def.slug === ho.teacherSlug);
    const homeroomTeacher = gradeSubjectByKey.get(`${ho.teacherGrade}-${defIndex}`)!;
    await prisma.classroom.update({
      where: { id: classroomAt(ho.grade, ho.section) },
      data: { homeroomTeacherId: homeroomTeacher.teacherId },
    });
  }

  // DEV_LOGIN_EMAIL's ป.ปลาย math coverage (see SENIOR_MATH_GRADES above):
  // one Teacher row, reassigned onto just section 1's already-created
  // TeachingAssignment for each of ป.4-6's คณิตศาสตร์ — the other 3 sections
  // per grade stay with that grade's own default math teacher.
  const seniorMathTeacherId = randomUUID();
  await prisma.teacher.create({ data: { id: seniorMathTeacherId, email: DEV_LOGIN_EMAIL, name: "ครูสมศรี ใจดี" } });
  const mathDefIndex = SUBJECT_DEFS.findIndex((def) => def.slug === "math");
  for (const grade of SENIOR_MATH_GRADES) {
    const gs = gradeSubjectByKey.get(`${grade}-${mathDefIndex}`)!;
    await prisma.teachingAssignment.update({
      where: {
        teacherId_classroomId_subjectId: {
          teacherId: gs.teacherId,
          classroomId: classroomAt(grade, SENIOR_MATH_SECTION),
          subjectId: gs.subjectId,
        },
      },
      data: { teacherId: seniorMathTeacherId },
    });
  }
  await prisma.classroom.update({
    where: { id: classroomAt(FEATURED_GRADE, FEATURED_SECTION) },
    data: { homeroomTeacherId: seniorMathTeacherId },
  });

  const parent = await prisma.parent.create({
    data: { email: DEV_LOGIN_EMAIL, name: "ผู้ปกครองของมานี" },
  });

  // 15 students per classroom. The featured classroom keeps 5 named students
  // (they get real login credentials below); every other seat is a generated
  // placeholder.
  const namedStudents = ["มานี", "ปิติ", "ชูใจ", "วีระ", "สมหญิง"] as const;
  const featuredClassroomId = classroomAt(FEATURED_GRADE, FEATURED_SECTION);

  const studentDefs: { id: string; name: string; classroomId: string; grade: number }[] = namedStudents.map((name) => ({
    id: randomUUID(),
    name,
    classroomId: featuredClassroomId,
    grade: FEATURED_GRADE,
  }));
  for (const cd of classroomDefs) {
    const isFeatured = cd.grade === FEATURED_GRADE && cd.section === FEATURED_SECTION;
    const alreadyPlaced = isFeatured ? namedStudents.length : 0;
    const classroomId = classroomAt(cd.grade, cd.section);
    for (let i = alreadyPlaced; i < STUDENTS_PER_CLASSROOM; i++) {
      const gender = i % 2 === 0 ? "เด็กชาย" : "เด็กหญิง";
      studentDefs.push({
        id: randomUUID(),
        name: `${gender} ป.${cd.grade}/${cd.section} #${String(i + 1).padStart(2, "0")}`,
        classroomId,
        grade: cd.grade,
      });
    }
  }
  const maneeId = studentDefs.find((sd) => sd.name === "มานี")!.id;

  await prisma.student.createMany({ data: studentDefs.map((sd) => ({ id: sd.id, name: sd.name })) });

  const enrollStart = DateTime.fromObject({ year: 2026, month: 5, day: 16 }, { zone: SCHOOL_TZ }).toISODate()!;
  await prisma.enrollment.createMany({
    data: studentDefs.map((sd) => ({
      studentId: sd.id,
      classroomId: sd.classroomId,
      startDate: new Date(enrollStart),
    })),
  });

  await prisma.guardianship.create({ data: { parentId: parent.id, studentId: maneeId } });

  // Each subject meets 3x/week per classroom, one period each — never
  // stacked into consecutive periods on the same day (a real school day
  // mixes subjects; it doesn't run the same one three times in a row).
  // weekdayFor depends only on (subject, session): a subject's 3 sessions
  // land on 3 *different* weekdays, since (2*0, 2*1, 2*2) mod 5 = 0, 2, 4
  // are always distinct residues (5 is prime, 2 isn't 0 mod 5) — true for
  // every subjectIndex. periodFor then only has to avoid same-day clashes
  // within one classroom and same-day/same-teacher clashes across one
  // grade's 4 sections; both are shift-injectivity arguments (see below),
  // so any grade/section/subject/session combination is safe by
  // construction, not by enumeration.
  //
  // Per-classroom (fixed grade+section, so `section` and `grade` are both
  // constants): grouping the 18 (subject, session) pairs by the weekday
  // they land on, the *base* case section=0 gives period=(subject+session)
  // mod 6 values that are already pairwise distinct within every weekday
  // group (verified directly — 6 subjects × 3 sessions is small enough to
  // check exhaustively). `section` and `grade` are just two more additive
  // constants layered on top of that base, and adding a constant mod 6 is
  // a bijection — it can't introduce a collision that wasn't already there.
  //
  // Per-grade-teacher (fixed subject+session, so a fixed weekday, and fixed
  // grade): varying section 0-3 (that subject's own 4 sections) shifts
  // (section) by 0-3, i.e. 4 *consecutive* residues mod 6 — always
  // distinct regardless of what constant (subject+session+grade) they're
  // offset by, so the one teacher covering all 4 sections is never double
  // booked. (The cross-grade SENIOR_MATH_GRADES case — one teacher, one
  // section, three different grades — is exactly why `grade` has to be in
  // the period formula too: without it, "section 0, math, session k" would
  // land on the identical weekday+period for every grade, double-booking
  // that shared teacher across grades. Adding `grade` as a third constant
  // offset keeps the two properties above intact while separating the
  // three grades' periods for that teacher.)
  const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
  const PERIODS_PER_DAY = 6;
  const SESSIONS_PER_WEEK = 3;

  function slotFor(grade: number, section: number, subjectIndex: number, session: number) {
    const weekday = WEEKDAYS[(subjectIndex + 2 * session) % WEEKDAYS.length];
    const period = ((section + subjectIndex + session + grade) % PERIODS_PER_DAY) + 1;
    return { weekday, period };
  }

  // A timetable is always scoped to a Term (see prisma/schema.prisma's
  // TimetableSlot comment) — this is the one term the dev seed's timetable
  // lives in.
  const term = await prisma.term.create({
    data: { schoolId: school.id, name: "ปีการศึกษา 2569", startDate: new Date("2026-05-01"), endDate: new Date("2027-03-31") },
  });

  await prisma.timetableSlot.createMany({
    data: classroomDefs.flatMap((cd, classroomIndex) =>
      SUBJECT_DEFS.flatMap((_, subjectIndex) => {
        const gs = gradeSubjectByKey.get(`${cd.grade}-${subjectIndex}`)!;
        return Array.from({ length: SESSIONS_PER_WEEK }, (_, k) => {
          const { weekday, period } = slotFor(cd.grade, cd.section - 1, subjectIndex, k);
          return { termId: term.id, classroomId: classroomIds[classroomIndex], weekday, period, subjectId: gs.subjectId };
        });
      }),
    ),
  });

  // One school-wide holiday and one classroom period-swap (on the featured
  // classroom), both landing on a real school day so they're visible in the
  // demo.
  const holidayDate = nextWeekday(1); // next Monday
  const swapDate = nextWeekday(3); // next Wednesday
  const featuredPe = gradeSubjectByKey.get(`${FEATURED_GRADE}-5`)!; // SUBJECT_DEFS[5] === พลศึกษา

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
      classroomId: featuredClassroomId,
      date: new Date(swapDate),
      kind: "PERIOD_SWAP",
      period: 1,
      subjectId: featuredPe.subjectId,
      note: "สลับเป็นพลศึกษาเพื่อซ้อมกีฬาสี",
    },
  });

  // Item copies: each student owns a copy of every subject item *for their
  // own grade* (never another grade's — a ป.1 kid never has a copy of the
  // ป.6 math workbook, so requiredItemsFor's copy-based filtering naturally
  // never shows it to them), except Manee's math workbook, which is
  // currently with the teacher for grading — this must NOT appear in her
  // packing list (invariant 5). Every other copy gets a QR sticker bound
  // immediately so the scanning flow works out of the box in dev —
  // invariant 7 means there is no other way to check an item in, even the
  // PE kit.
  const itemCopyDefs = studentDefs.flatMap((sd) =>
    SUBJECT_DEFS.map((def, defIndex) => {
      const gs = gradeSubjectByKey.get(`${sd.grade}-${defIndex}`)!;
      const isManeesGradedMath = sd.id === maneeId && def.slug === "math";
      return {
        id: randomUUID(),
        studentId: sd.id,
        subjectItemId: gs.itemId,
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
  // students only, so /login's student tab has something to test with — the
  // rest stay login-less until a teacher issues credentials for them through
  // the app. Mirrors lib/roster.ts's issueStudentCredentials directly
  // (bcrypt hash only, ever) rather than going through it, since this
  // trusted seed script isn't acting as a policy-checked teacher request —
  // the plaintext PIN below is printed once, exactly like the real issuance
  // UI, and is never written anywhere.
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
    grades: GRADES.map((g) => `ป.${g}/1-${SECTIONS_PER_GRADE}`),
    totalClassrooms: classroomDefs.length,
    studentsPerClassroom: STUDENTS_PER_CLASSROOM,
    totalStudents: studentDefs.length,
    totalSubjects: gradeSubjects.length,
    totalTeachers: gradeSubjects.length + 1, // +1 for the shared ป.ปลาย math teacher
    parent: parent.name,
    holidayDate,
    swapDate,
    teacherLogins: [
      `${DEV_LOGIN_EMAIL} — คณิตศาสตร์ ป.ปลาย teacher (ป.${SENIOR_MATH_GRADES.join("/")}, section ${SENIOR_MATH_SECTION} of each only — see the seed script's capacity comment), homeroom of ป.${FEATURED_GRADE}/${FEATURED_SECTION}, also linked as parent`,
      ...TEACHER_OVERRIDES.map((o) => {
        const homeroom = HOMEROOM_OVERRIDES.find((ho) => ho.teacherGrade === o.grade && ho.teacherSlug === o.slug);
        const subjectName = SUBJECT_DEFS.find((def) => def.slug === o.slug)!.name;
        return `${o.email} — ${subjectName} ป.${o.grade} teacher${homeroom ? `, homeroom of ป.${homeroom.grade}/${homeroom.section}` : ""}`;
      }),
    ],
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
