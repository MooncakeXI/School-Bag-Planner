import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { schoolDateToUtcMidnight, schoolToday } from "./time";
import type { Actor } from "./actor";

// Single authorization layer (CLAUDE.md "Authorization"). Access is
// relationship-based: a teacher may only act on classrooms they are
// assigned to, a parent only on their own children, a student only on
// themselves. Nothing outside this file should branch on actor.*Id
// directly — call can() or the visible*Where() scoping helpers instead.

export type Resource =
  | { type: "classroom"; classroomId: string }
  | { type: "student"; studentId: string }
  | { type: "school"; schoolId: string }
  | { type: "catalog"; schoolId: string }
  | { type: "item_copy"; classroomId: string; subjectId: string }
  | { type: "homework"; classroomId: string; subjectId: string };

export type Action =
  | "view_timetable"
  | "view_exceptions"
  | "edit_exceptions"
  | "view_student"
  | "edit_roster"
  | "edit_catalog"
  | "edit_rewards"
  | "edit_item_copy"
  | "edit_homework"
  | "edit_student_account" // homeroom-only: link a parent, (re)issue login credentials
  | "spot_check" // homeroom-only: morning bag-check, deliberately NOT edit_item_copy's
  // subject-scoping — ครูประจำชั้น checks the whole bag, not each subject teacher checking
  // only their own item (see lib/packing.ts's requireHomeroomAccessForItemCopyOwner)
  | "edit_consent"; // a guardian's own decision, or homeroom-only for a paper form —
  // deliberately NOT the student's own, even for their own record (CLAUDE.md "Privacy":
  // a minor's consent needs a guardian) — see lib/consent.ts

/** Enrollment where-fragment for "active on today's school date". */
function activeEnrollmentFilter(): Prisma.EnrollmentWhereInput {
  const today = schoolDateToUtcMidnight(schoolToday());
  return { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] };
}

async function teachesClassroom(teacherId: string, classroomId: string): Promise<boolean> {
  const count = await prisma.teachingAssignment.count({ where: { teacherId, classroomId } });
  return count > 0;
}

/** Unlike teachesClassroom, scoped to one subject — a teacher covering only
 * PE in a classroom must not manage another subject's item copies there. */
async function teachesClassroomSubject(teacherId: string, classroomId: string, subjectId: string): Promise<boolean> {
  const count = await prisma.teachingAssignment.count({ where: { teacherId, classroomId, subjectId } });
  return count > 0;
}

async function teachesInSchool(teacherId: string, schoolId: string): Promise<boolean> {
  const count = await prisma.teachingAssignment.count({ where: { teacherId, classroom: { schoolId } } });
  return count > 0;
}

/** ครูประจำชั้น — sees every subject in the classroom and manages guardianships/logins, not just their own subject. */
async function isHomeroomTeacherOf(teacherId: string, classroomId: string): Promise<boolean> {
  const count = await prisma.classroom.count({ where: { id: classroomId, homeroomTeacherId: teacherId } });
  return count > 0;
}

async function isEnrolledInClassroom(studentId: string, classroomId: string): Promise<boolean> {
  const count = await prisma.enrollment.count({ where: { studentId, classroomId, ...activeEnrollmentFilter() } });
  return count > 0;
}

async function guardianOfStudentInClassroom(parentId: string, classroomId: string): Promise<boolean> {
  const count = await prisma.guardianship.count({
    where: { parentId, student: { enrollments: { some: { classroomId, ...activeEnrollmentFilter() } } } },
  });
  return count > 0;
}

async function isGuardianOf(parentId: string, studentId: string): Promise<boolean> {
  const count = await prisma.guardianship.count({ where: { parentId, studentId } });
  return count > 0;
}

async function teachesStudent(teacherId: string, studentId: string): Promise<boolean> {
  const count = await prisma.enrollment.count({
    where: { studentId, ...activeEnrollmentFilter(), classroom: { teachingAssignments: { some: { teacherId } } } },
  });
  return count > 0;
}

/** Same homeroom-only shape as isHomeroomTeacherOf, but resolved from a
 * studentId (via their active enrollment) rather than a classroomId
 * directly — edit_consent's "student" resource has no classroomId to work
 * from up front. */
async function isHomeroomTeacherOfStudent(teacherId: string, studentId: string): Promise<boolean> {
  const count = await prisma.enrollment.count({
    where: { studentId, ...activeEnrollmentFilter(), classroom: { homeroomTeacherId: teacherId } },
  });
  return count > 0;
}

export async function can(actor: Actor, action: Action, resource: Resource): Promise<boolean> {
  switch (resource.type) {
    case "classroom": {
      const { classroomId } = resource;
      if (action === "edit_student_account" || action === "spot_check") {
        return actor.teacherId != null && isHomeroomTeacherOf(actor.teacherId, classroomId);
      }
      if (action === "edit_exceptions" || action === "edit_roster") {
        return actor.teacherId != null && teachesClassroom(actor.teacherId, classroomId);
      }
      // view_timetable / view_exceptions
      if (actor.teacherId && (await teachesClassroom(actor.teacherId, classroomId))) return true;
      if (actor.studentId && (await isEnrolledInClassroom(actor.studentId, classroomId))) return true;
      if (actor.parentId && (await guardianOfStudentInClassroom(actor.parentId, classroomId))) return true;
      return false;
    }
    case "school": {
      // edit_roster here means "may create classrooms in this school" —
      // the school-level counterpart of edit_roster on a classroom, which
      // means "may manage that classroom's students". edit_rewards is the
      // reward-catalog equivalent — school-wide, not per-classroom, but
      // (unlike the Subject catalog) still scoped to teachers at that
      // particular school, since rewards are redeemed at one school's store.
      if (action === "edit_exceptions" || action === "edit_roster" || action === "edit_rewards") {
        return actor.teacherId != null && teachesInSchool(actor.teacherId, resource.schoolId);
      }
      return false;
    }
    case "student": {
      const { studentId } = resource;
      if (action === "edit_consent") {
        // A guardian's own decision, or the homeroom teacher recording a
        // paper form on a family's behalf — deliberately NOT the student
        // themselves (they're a minor; CLAUDE.md "Privacy") and NOT any
        // subject teacher (consent isn't a per-subject concern).
        if (actor.parentId && (await isGuardianOf(actor.parentId, studentId))) return true;
        if (actor.teacherId && (await isHomeroomTeacherOfStudent(actor.teacherId, studentId))) return true;
        return false;
      }
      if (actor.studentId === studentId) return true;
      if (actor.parentId && (await isGuardianOf(actor.parentId, studentId))) return true;
      if (actor.teacherId && (await teachesStudent(actor.teacherId, studentId))) return true;
      return false;
    }
    case "catalog": {
      // Subjects/SubjectItems are a per-school curriculum catalog — coarser
      // than per-classroom (any teacher at the school may manage it, not
      // just ones teaching a given classroom), matching how a Thai school's
      // curriculum committee works, but NOT cross-school: Subject cascades
      // to TimetableSlot, and SubjectItem cascades to ItemCopy (which
      // cascades to PackingCheck), so an unscoped catalog would let any
      // teacher at any school delete another school's entire timetable and
      // packing history. See ARCHITECTURE.md "Database Architecture".
      if (action === "edit_catalog") return actor.teacherId != null && teachesInSchool(actor.teacherId, resource.schoolId);
      return false;
    }
    case "item_copy": {
      // Narrower than edit_roster on the same classroom: a teacher who
      // only teaches one subject there must not see or manage another
      // subject's workbooks — real teachers are subject-specific. The
      // homeroom teacher is the one deliberate exception: they see and
      // manage every subject's items, not just their own.
      if (action === "edit_item_copy") {
        if (actor.teacherId == null) return false;
        if (await isHomeroomTeacherOf(actor.teacherId, resource.classroomId)) return true;
        return teachesClassroomSubject(actor.teacherId, resource.classroomId, resource.subjectId);
      }
      return false;
    }
    case "homework": {
      // Homework follows the same subject-level boundary as item copies: a
      // subject teacher may post only for their own subject/classroom pair,
      // while the homeroom teacher may post for every subject taught there.
      // Its resource is still validated against a real teaching assignment in
      // lib/homework.ts before any row is written.
      if (action === "edit_homework") {
        if (actor.teacherId == null) return false;
        if (await isHomeroomTeacherOf(actor.teacherId, resource.classroomId)) return true;
        return teachesClassroomSubject(actor.teacherId, resource.classroomId, resource.subjectId);
      }
      return false;
    }
  }
}

/**
 * Subjects an actor may manage item copies for in a classroom — homeroom
 * sees every subject taught there, a subject teacher only their own
 * (mirrors the item_copy case in can() above). Used to scope subject-choice
 * UI (print-qr's "narrow to one subject") and the classroom-wide
 * generate-and-bind flow (lib/qr.ts), so neither has to duplicate the
 * homeroom-vs-subject-teacher logic.
 */
export async function manageableSubjectsInClassroom(actor: Actor, classroomId: string) {
  if (actor.teacherId == null) return [];
  const isHomeroom = await isHomeroomTeacherOf(actor.teacherId, classroomId);
  return prisma.subject.findMany({
    where: { teachingAssignments: { some: isHomeroom ? { classroomId } : { classroomId, teacherId: actor.teacherId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Scope a Student list query at the database level (CLAUDE.md: never
 * fetch broadly and filter in the UI). An actor with no profile at all
 * sees nothing.
 */
export function visibleStudentWhere(actor: Actor): Prisma.StudentWhereInput {
  const or: Prisma.StudentWhereInput[] = [];
  if (actor.studentId) or.push({ id: actor.studentId });
  if (actor.parentId) or.push({ guardianships: { some: { parentId: actor.parentId } } });
  if (actor.teacherId) {
    or.push({
      enrollments: { some: { ...activeEnrollmentFilter(), classroom: { teachingAssignments: { some: { teacherId: actor.teacherId } } } } },
    });
  }
  if (or.length === 0) return { id: { equals: "__no_profile__" } };
  return { OR: or };
}

/** Scope a Classroom list query at the database level. */
export function visibleClassroomWhere(actor: Actor): Prisma.ClassroomWhereInput {
  const or: Prisma.ClassroomWhereInput[] = [];
  if (actor.teacherId) or.push({ teachingAssignments: { some: { teacherId: actor.teacherId } } });
  if (actor.studentId) or.push({ enrollments: { some: { studentId: actor.studentId, ...activeEnrollmentFilter() } } });
  if (actor.parentId) {
    or.push({
      enrollments: { some: { ...activeEnrollmentFilter(), student: { guardianships: { some: { parentId: actor.parentId } } } } },
    });
  }
  if (or.length === 0) return { id: { equals: "__no_profile__" } };
  return { OR: or };
}
