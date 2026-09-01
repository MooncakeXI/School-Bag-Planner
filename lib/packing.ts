import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { requiredItemsFor } from "./required-items";
import { award, POINTS_PER_COMPLETION, MORNING_CHECK_FAIL_PENALTY } from "./points";
import { requireTeacherAccessForItemCopy } from "./qr";
import { PackingWindowClosedError, InvalidScanError, ForbiddenError } from "./errors";
import { schoolNow, schoolToday, schoolTomorrow, schoolDateToUtcMidnight, type SchoolDate } from "./time";
import type { Actor } from "./actor";

// CLAUDE.md "Anti-cheat": both bounds are server-side constants checked
// against schoolNow(), never a client-supplied timestamp.
export const PACKING_WINDOW_START_HOUR = 18; // 18:00
export const PACKING_WINDOW_END_HOUR = 24; // through 23:59:59
export const SESSION_TTL_MINUTES = 10;

const PHOTO_DIR = path.join(process.cwd(), "var", "packing-photos");

function withinPackingWindow(): boolean {
  const hour = schoolNow().hour;
  return hour >= PACKING_WINDOW_START_HOUR && hour < PACKING_WINDOW_END_HOUR;
}

function isExpired(session: { startedAt: Date }): boolean {
  return Date.now() - session.startedAt.getTime() > SESSION_TTL_MINUTES * 60 * 1000;
}

/**
 * Finds the student's ACTIVE session for tonight's target date (always
 * schoolTomorrow() — packing sessions are always "what do I need
 * tomorrow"), lazily expiring a stale one, and starting a fresh one only
 * inside the configured evening window.
 */
async function getOrStartSession(studentId: string, forDate: SchoolDate) {
  const target = schoolDateToUtcMidnight(forDate);

  const mostRecent = await prisma.packingSession.findFirst({
    where: { studentId, forDate: target },
    orderBy: { startedAt: "desc" },
  });

  // Already finished for the day — re-scanning an already-packed item must
  // not spin up a brand new session and re-complete (and re-award) it.
  if (mostRecent?.status === "COMPLETED") return mostRecent;

  if (mostRecent?.status === "ACTIVE") {
    if (!isExpired(mostRecent)) return mostRecent;
    await prisma.packingSession.update({ where: { id: mostRecent.id }, data: { status: "EXPIRED" } });
  }

  if (!withinPackingWindow()) throw new PackingWindowClosedError();

  // startedAt is set explicitly from the app clock (Date.now()), not the
  // schema's DB-level CURRENT_TIMESTAMP default — isExpired() below compares
  // against Date.now() too, and both must read the same clock.
  return prisma.packingSession.create({ data: { studentId, forDate: target, status: "ACTIVE", startedAt: new Date() } });
}

async function savePhoto(dataUrl: string): Promise<string | null> {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, ext, base64] = match;
  await mkdir(PHOTO_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext === "jpg" ? "jpeg" : ext}`;
  await writeFile(path.join(PHOTO_DIR, filename), Buffer.from(base64, "base64"));
  return filename;
}

export function photoFilePath(filename: string): string {
  return path.join(PHOTO_DIR, filename);
}

async function tryCompleteSession(sessionId: string, studentId: string, forDate: SchoolDate) {
  const required = await requiredItemsFor(studentId, forDate);
  if (required.items.length === 0) return; // nothing to complete against

  // Scoped to THIS session only, not "any session for the date" — a check
  // recorded under a since-expired session must not count toward a fresh
  // session's completion, or the whole point of the TTL (finish in one
  // quick sitting, not trickled across the evening) is defeated.
  const checkedCopyIds = new Set(
    (
      await prisma.packingCheck.findMany({
        where: { sessionId },
        select: { itemCopyId: true },
      })
    ).map((c) => c.itemCopyId),
  );
  const allChecked = required.items.every((item) => checkedCopyIds.has(item.itemCopyId));
  if (!allChecked) return;

  await prisma.$transaction(async (tx) => {
    const session = await tx.packingSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.status !== "ACTIVE" || session.pointsAwarded) return;
    if (isExpired(session)) {
      await tx.packingSession.update({ where: { id: sessionId }, data: { status: "EXPIRED" } });
      return;
    }
    await tx.packingSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", completedAt: new Date(), pointsAwarded: true },
    });
    await award(studentId, POINTS_PER_COMPLETION, "PACKING_COMPLETE", { refId: sessionId }, tx);
  });
}

/**
 * Records one QR scan for the logged-in student's own item. Server-side
 * only — the client sends a code and an optional photo frame, nothing
 * else is trusted (no session id, no timestamp, no "which item" claim
 * beyond what the code itself resolves to).
 */
export async function recordScan(actor: Actor, params: { code: string; photoDataUrl?: string }) {
  if (!actor.studentId) throw new ForbiddenError("view_student", { type: "student", studentId: "" });

  const qrCode = await prisma.qRCode.findUnique({ where: { code: params.code } });
  if (!qrCode || qrCode.state !== "ASSIGNED" || !qrCode.itemCopyId) {
    throw new InvalidScanError("รหัส QR นี้ยังไม่ได้ผูกกับของชิ้นไหน");
  }

  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({ where: { id: qrCode.itemCopyId } });
  if (itemCopy.studentId !== actor.studentId) {
    throw new ForbiddenError("view_student", { type: "student", studentId: itemCopy.studentId });
  }

  const forDate = schoolTomorrow();
  const session = await getOrStartSession(actor.studentId, forDate);

  const photoPath = params.photoDataUrl ? await savePhoto(params.photoDataUrl) : null;

  await prisma.packingCheck.upsert({
    where: { sessionId_itemCopyId: { sessionId: session.id, itemCopyId: itemCopy.id } },
    create: { sessionId: session.id, itemCopyId: itemCopy.id, photoPath },
    update: {},
  });

  await tryCompleteSession(session.id, actor.studentId, forDate);

  return { itemCopyId: itemCopy.id };
}

export type PackingStatusItem = Awaited<ReturnType<typeof requiredItemsFor>>["items"][number] & { checked: boolean };

export type PackingStatus = {
  forDate: SchoolDate;
  isHoliday: boolean;
  items: PackingStatusItem[];
  packedCount: number;
  total: number;
  isComplete: boolean;
  pointsAwarded: boolean;
  activeSession: { startedAt: Date; expiresAt: Date } | null;
};

/** Read-side view for the student's "tomorrow" screen — real state, no client-side tick path. */
export async function getPackingStatus(studentId: string, forDate: SchoolDate): Promise<PackingStatus> {
  const required = await requiredItemsFor(studentId, forDate);

  const session = await prisma.packingSession.findFirst({
    where: { studentId, forDate: schoolDateToUtcMidnight(forDate) },
    orderBy: { startedAt: "desc" },
  });
  // Scoped to the current/most-recent session only (same reasoning as
  // tryCompleteSession) — once a session expires, a fresh one starts from
  // zero rather than carrying stale partial progress that would make the
  // checklist say "done" without the completion bonus ever firing.
  const checks = session
    ? await prisma.packingCheck.findMany({ where: { sessionId: session.id }, select: { itemCopyId: true } })
    : [];
  const checkedIds = new Set(checks.map((c) => c.itemCopyId));

  const items = required.items.map((item) => ({ ...item, checked: checkedIds.has(item.itemCopyId) }));
  const packedCount = items.filter((i) => i.checked).length;
  const isComplete = session?.status === "COMPLETED";
  const activeSession =
    session && session.status === "ACTIVE" && !isExpired(session)
      ? { startedAt: session.startedAt, expiresAt: new Date(session.startedAt.getTime() + SESSION_TTL_MINUTES * 60 * 1000) }
      : null;

  return {
    forDate,
    isHoliday: required.isHoliday,
    items,
    packedCount,
    total: items.length,
    isComplete,
    pointsAwarded: session?.pointsAwarded ?? false,
    activeSession,
  };
}

/**
 * CLAUDE.md "Anti-cheat": teachers spot-check a few students each morning;
 * a mismatch (the item was scanned last night but isn't actually in the
 * bag) deducts points and breaks the streak (lib/points.ts's computeStreak
 * reads streak off the most recent MORNING_CHECK_FAIL row, so this is the
 * only thing that resets it). Confirming a match writes nothing — there is
 * no positive ledger entry for "checked out fine", only the negative one
 * for a catch. Every call is a teacher override, so it's audited via
 * actorUserId (invariant 7).
 */
export async function spotCheck(actor: Actor, params: { itemCopyId: string; actuallyPacked: boolean }) {
  await requireTeacherAccessForItemCopy(actor, params.itemCopyId);
  if (params.actuallyPacked) return null;

  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({ where: { id: params.itemCopyId } });
  const hadCheck = await prisma.packingCheck.findFirst({
    where: { itemCopyId: params.itemCopyId, session: { studentId: itemCopy.studentId, forDate: schoolDateToUtcMidnight(schoolToday()) } },
  });
  if (!hadCheck) throw new InvalidScanError("ของชิ้นนี้ไม่ได้ถูกสแกนไว้เมื่อคืน จึงไม่มีอะไรให้ตรวจสอบ");

  return award(itemCopy.studentId, -MORNING_CHECK_FAIL_PENALTY, "MORNING_CHECK_FAIL", {
    refId: params.itemCopyId,
    actorUserId: actor.userId,
  });
}
