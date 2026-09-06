import { prisma } from "./prisma";
import { can } from "./policy";
import { ForbiddenError } from "./errors";
import type { Actor } from "./actor";

async function requireCatalogAccess(actor: Actor, schoolId: string) {
  if (!(await can(actor, "edit_catalog", { type: "catalog", schoolId }))) {
    throw new ForbiddenError("edit_catalog", { type: "catalog", schoolId });
  }
}

export async function createSubject(actor: Actor, schoolId: string, name: string) {
  await requireCatalogAccess(actor, schoolId);
  return prisma.subject.create({ data: { schoolId, name } });
}

export async function renameSubject(actor: Actor, subjectId: string, name: string) {
  const subject = await prisma.subject.findUniqueOrThrow({ where: { id: subjectId }, select: { schoolId: true } });
  await requireCatalogAccess(actor, subject.schoolId);
  return prisma.subject.update({ where: { id: subjectId }, data: { name } });
}

/** Restores an archived subject to the active catalog. The other half of
 * deleteSubject's default archive behavior — otherwise archiving would be a
 * one-way trip and no safer than the hard delete it replaces. */
export async function restoreSubject(actor: Actor, subjectId: string) {
  const subject = await prisma.subject.findUniqueOrThrow({ where: { id: subjectId }, select: { schoolId: true } });
  await requireCatalogAccess(actor, subject.schoolId);
  return prisma.subject.update({ where: { id: subjectId }, data: { archivedAt: null } });
}

/**
 * Default: archive (hide from the catalog UI, without touching anything
 * that already references this subject — an archived subject can still
 * appear in an existing TimetableSlot, since there's no runtime edit path
 * for those any more, see lib/timetable.ts). `{ hard: true }` performs a
 * real delete,
 * but only when nothing depends on it: Subject cascades to TimetableSlot,
 * ScheduleException, and (via SubjectItem) ItemCopy — which itself cascades
 * to PackingCheck — so an unguarded hard delete would silently destroy
 * timetables, item copies and packing history. See ARCHITECTURE.md.
 */
export async function deleteSubject(actor: Actor, subjectId: string, opts: { hard?: boolean } = {}) {
  const subject = await prisma.subject.findUniqueOrThrow({
    where: { id: subjectId },
    select: { schoolId: true, name: true },
  });
  await requireCatalogAccess(actor, subject.schoolId);

  if (!opts.hard) {
    return prisma.subject.update({ where: { id: subjectId }, data: { archivedAt: new Date() } });
  }

  const [timetableSlotCount, scheduleExceptionCount, itemCopyCount, homeworkCount] = await Promise.all([
    prisma.timetableSlot.count({ where: { subjectId } }),
    prisma.scheduleException.count({ where: { subjectId } }),
    prisma.itemCopy.count({ where: { subjectItem: { subjectId } } }),
    prisma.homework.count({ where: { subjectId } }),
  ]);
  const blockers: string[] = [];
  if (timetableSlotCount > 0) blockers.push(`${timetableSlotCount} timetable slot(s)`);
  if (itemCopyCount > 0) blockers.push(`${itemCopyCount} item copy(ies)`);
  if (scheduleExceptionCount > 0) blockers.push(`${scheduleExceptionCount} schedule exception(s)`);
  if (homeworkCount > 0) blockers.push(`${homeworkCount} homework record(s)`);
  if (blockers.length > 0) {
    throw new Error(
      `Cannot permanently delete subject "${subject.name}": still referenced by ${blockers.join(", ")}. Archive it instead, or remove those first.`,
    );
  }
  return prisma.subject.delete({ where: { id: subjectId } });
}

export async function createSubjectItem(actor: Actor, subjectId: string, name: string, forExam = false) {
  const subject = await prisma.subject.findUniqueOrThrow({ where: { id: subjectId }, select: { schoolId: true } });
  await requireCatalogAccess(actor, subject.schoolId);
  return prisma.subjectItem.create({ data: { subjectId, name, forExam } });
}

export async function renameSubjectItem(actor: Actor, subjectItemId: string, name: string) {
  const item = await prisma.subjectItem.findUniqueOrThrow({
    where: { id: subjectItemId },
    select: { subject: { select: { schoolId: true } } },
  });
  await requireCatalogAccess(actor, item.subject.schoolId);
  return prisma.subjectItem.update({ where: { id: subjectItemId }, data: { name } });
}

/** Flips whether this item belongs to its subject's exam kit vs. its
 * normal (day-to-day) kit — see requiredItemsFor/assembleItems, which
 * selects one set or the other on an exam-day slot, never both. */
export async function setSubjectItemForExam(actor: Actor, subjectItemId: string, forExam: boolean) {
  const item = await prisma.subjectItem.findUniqueOrThrow({
    where: { id: subjectItemId },
    select: { subject: { select: { schoolId: true } } },
  });
  await requireCatalogAccess(actor, item.subject.schoolId);
  return prisma.subjectItem.update({ where: { id: subjectItemId }, data: { forExam } });
}

/** Restores an archived item — see restoreSubject. */
export async function restoreSubjectItem(actor: Actor, subjectItemId: string) {
  const item = await prisma.subjectItem.findUniqueOrThrow({
    where: { id: subjectItemId },
    select: { subject: { select: { schoolId: true } } },
  });
  await requireCatalogAccess(actor, item.subject.schoolId);
  return prisma.subjectItem.update({ where: { id: subjectItemId }, data: { archivedAt: null } });
}

/**
 * Default: archive (hide from the catalog UI and from new ItemCopy creation
 * — see lib/roster.ts's createItemCopy — while a student's existing ItemCopy
 * pointing at it keeps resolving through requiredItemsFor unchanged; see
 * ARCHITECTURE.md for why that's the correct behavior, not an oversight).
 * `{ hard: true }` deletes for real, only when no ItemCopy references it.
 */
export async function deleteSubjectItem(actor: Actor, subjectItemId: string, opts: { hard?: boolean } = {}) {
  const item = await prisma.subjectItem.findUniqueOrThrow({
    where: { id: subjectItemId },
    select: { name: true, subject: { select: { schoolId: true } } },
  });
  await requireCatalogAccess(actor, item.subject.schoolId);

  if (!opts.hard) {
    return prisma.subjectItem.update({ where: { id: subjectItemId }, data: { archivedAt: new Date() } });
  }

  const itemCopyCount = await prisma.itemCopy.count({ where: { subjectItemId } });
  if (itemCopyCount > 0) {
    throw new Error(
      `Cannot permanently delete item "${item.name}": still referenced by ${itemCopyCount} item copy(ies). Archive it instead, or remove those first.`,
    );
  }
  return prisma.subjectItem.delete({ where: { id: subjectItemId } });
}
