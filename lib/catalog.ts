import { prisma } from "./prisma";
import { can } from "./policy";
import { ForbiddenError } from "./errors";
import type { Actor } from "./actor";

async function requireCatalogAccess(actor: Actor) {
  if (!(await can(actor, "edit_catalog", { type: "catalog" }))) {
    throw new ForbiddenError("edit_catalog", { type: "catalog" });
  }
}

export async function createSubject(actor: Actor, name: string) {
  await requireCatalogAccess(actor);
  return prisma.subject.create({ data: { name } });
}

export async function renameSubject(actor: Actor, subjectId: string, name: string) {
  await requireCatalogAccess(actor);
  return prisma.subject.update({ where: { id: subjectId }, data: { name } });
}

export async function deleteSubject(actor: Actor, subjectId: string) {
  await requireCatalogAccess(actor);
  await prisma.subject.delete({ where: { id: subjectId } });
}

export async function createSubjectItem(actor: Actor, subjectId: string, name: string) {
  await requireCatalogAccess(actor);
  return prisma.subjectItem.create({ data: { subjectId, name } });
}

export async function renameSubjectItem(actor: Actor, subjectItemId: string, name: string) {
  await requireCatalogAccess(actor);
  return prisma.subjectItem.update({ where: { id: subjectItemId }, data: { name } });
}

export async function deleteSubjectItem(actor: Actor, subjectItemId: string) {
  await requireCatalogAccess(actor);
  await prisma.subjectItem.delete({ where: { id: subjectItemId } });
}
