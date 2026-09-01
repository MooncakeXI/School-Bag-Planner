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
  | { type: "catalog" };

export type Action =
  | "view_timetable"
  | "edit_timetable"
  | "view_exceptions"
  | "edit_exceptions"
  | "view_student"
  | "edit_roster"
  | "edit_catalog"
  | "edit_rewards";

/** Enrollment where-fragment for "active on today's school date". */
function activeEnrollmentFilter(): Prisma.EnrollmentWhereInput {
  const today = schoolDateToUtcMidnight(schoolToday());
  return { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] };
}

async function teachesClassroom(teacherId: string, classroomId: string): Promise<boolean> {
  const count = await prisma.teachingAssignment.count({ where: { teacherId, classroomId } });
  return count > 0;
}

async function teachesInSchool(teacherId: string, schoolId: string): Promise<boolean> {
  const count = await prisma.teachingAssignment.count({ where: { teacherId, classroom: { schoolId } } });
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

export async function can(actor: Actor, action: Action, resource: Resource): Promise<boolean> {
  switch (resource.type) {
    case "classroom": {
      const { classroomId } = resource;
      if (action === "edit_timetable" || action === "edit_exceptions" || action === "edit_roster") {
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
      if (actor.studentId === studentId) return true;
      if (actor.parentId && (await isGuardianOf(actor.parentId, studentId))) return true;
      if (actor.teacherId && (await teachesStudent(actor.teacherId, studentId))) return true;
      return false;
    }
    case "catalog": {
      // Subjects/SubjectItems are a shared curriculum catalog (matches how
      // Thai national curriculum subjects work), not owned by one
      // classroom — the one deliberate coarse-grained exception to
      // per-classroom scoping. Any teacher may manage it.
      if (action === "edit_catalog") return actor.teacherId != null;
      return false;
    }
  }
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
