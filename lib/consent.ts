import type { ConsentScope } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type Resource } from "./policy";
import { ForbiddenError } from "./errors";
import { deletePhotosForChecks } from "./photo-storage";
import type { Actor } from "./actor";

// The version string a scope's consent must match to count as "active" —
// bump this (and update the actual privacy-notice text/copy wherever it's
// shown) whenever the notice changes; every existing consent for that scope
// stops counting as active the moment this changes, without touching a
// single historical row (see prisma/schema.prisma's Consent comment).
export const CURRENT_CONSENT_VERSION: Record<ConsentScope, string> = {
  PHOTO_CAPTURE: "1",
};

/**
 * The one place allowed to answer "does this student have valid consent
 * right now" — never just "does a Consent row exist." Active means
 * `revokedAt` is null *and* `version` matches the scope's current version.
 */
export async function hasActiveConsent(studentId: string, scope: ConsentScope): Promise<boolean> {
  const count = await prisma.consent.count({
    where: { studentId, scope, revokedAt: null, version: CURRENT_CONSENT_VERSION[scope] },
  });
  return count > 0;
}

async function requireConsentAccess(actor: Actor, studentId: string) {
  const resource: Resource = { type: "student", studentId };
  if (!(await can(actor, "edit_consent", resource))) {
    throw new ForbiddenError("edit_consent", resource);
  }
}

/** A parent granting consent for their own child, through the parent-facing
 * consent screen (/parent/[studentId]/consent). Always inserts a new row —
 * re-granting after a revocation, or after a version bump, is a fresh
 * grant, not a resurrection of the old one. */
export async function grantConsentOnline(actor: Actor, params: { studentId: string; scope: ConsentScope }) {
  if (!actor.parentId) throw new ForbiddenError("edit_consent", { type: "student", studentId: params.studentId });
  await requireConsentAccess(actor, params.studentId);

  return prisma.consent.create({
    data: {
      studentId: params.studentId,
      scope: params.scope,
      method: "ONLINE",
      version: CURRENT_CONSENT_VERSION[params.scope],
      grantedByParentId: actor.parentId,
    },
  });
}

/** Homeroom-teacher-only: records that a signed paper consent form was
 * collected, for a family who never uses the app online at all. Same
 * underlying record as an online grant — just a different `method` and a
 * `recordedByUserId` (the teacher) instead of `grantedByParentId`. */
export async function recordPaperConsent(actor: Actor, params: { studentId: string; scope: ConsentScope }) {
  await requireConsentAccess(actor, params.studentId);
  if (!actor.teacherId) throw new ForbiddenError("edit_consent", { type: "student", studentId: params.studentId });

  return prisma.consent.create({
    data: {
      studentId: params.studentId,
      scope: params.scope,
      method: "PAPER",
      version: CURRENT_CONSENT_VERSION[params.scope],
      recordedByUserId: actor.userId,
    },
  });
}

/**
 * Withdraws consent — a guardian or the homeroom teacher (same access as
 * granting; a family can ask the teacher to withdraw it just as they can
 * ask them to record a paper grant). Marks every currently-non-revoked row
 * for this student+scope as revoked (never deleted — the historical record
 * of what was once granted, and when it was withdrawn, stays intact), then
 * — the part that makes this more than a future-capture switch — deletes
 * every photo already stored for this student and nulls its `PackingCheck`
 * reference. Idempotent: revoking with nothing active is a no-op, not an
 * error.
 */
export async function revokeConsent(actor: Actor, params: { studentId: string; scope: ConsentScope }) {
  await requireConsentAccess(actor, params.studentId);

  await prisma.consent.updateMany({
    where: { studentId: params.studentId, scope: params.scope, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (params.scope === "PHOTO_CAPTURE") {
    const checks = await prisma.packingCheck.findMany({
      where: { photoPath: { not: null }, session: { studentId: params.studentId } },
      select: { id: true, photoPath: true },
    });
    await deletePhotosForChecks(checks);
  }
}
