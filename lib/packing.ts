import { prisma } from "./prisma";
import { requiredItemsFor } from "./required-items";
import { award, awardPenaltyCappedAtZero } from "./points";
import { can, type Resource } from "./policy";
import { schoolSettingsForStudent, type SchoolSettings } from "./school-settings";
import { savePhoto, shouldCapturePhoto } from "./photo-storage";
import { hasActiveConsent } from "./consent";
import { InvalidScanError, ForbiddenError } from "./errors";
import { schoolNow, schoolToday, schoolTomorrow, schoolDateToUtcMidnight, type SchoolDate } from "./time";
import type { Actor } from "./actor";
import { requireHomeroomAccessForStudent } from "./roster";

function minutesSinceMidnight(): number {
  const now = schoolNow();
  return now.hour * 60 + now.minute;
}

function isInMorningWindow(settings: SchoolSettings): boolean {
  const minutes = minutesSinceMidnight();
  return minutes >= settings.morningWindowStartMinute && minutes < settings.morningWindowEndMinute;
}

/**
 * The date the student's screen and scan both target: today during the
 * configured morning period, tomorrow at every other time.
 */
export function packingFocusDate(settings: SchoolSettings): SchoolDate {
  return isInMorningWindow(settings) ? schoolToday() : schoolTomorrow();
}

function isExpired(session: { startedAt: Date }, sessionTtlMinutes: number): boolean {
  return Date.now() - session.startedAt.getTime() > sessionTtlMinutes * 60 * 1000;
}

/**
 * Finds the student's ACTIVE session for `forDate` (already resolved by the
 * caller — `packingFocusDate` for the normal flow, always `schoolTomorrow()`
 * for `recordTeacherScan`), lazily expiring a stale one and starting a fresh
 * one.
 *
 * Expiry resets the clock, not the student's progress: a prior session's
 * checks are carried onto the fresh one (never discarded), and the fresh
 * session is marked `continuous: false` so the teacher can see, on the
 * morning spot-check page, that this student needed more than one sitting
 * — a signal, not an automatic penalty (CLAUDE.md "Anti-cheat": the real
 * check is the teacher's morning spot-check, not this timer).
 *
 * `startedByUserId` is stamped only on the session row created *here* —
 * null for every ordinary student-run call (`recordScan`), the acting
 * teacher's userId for `recordTeacherScan`. If this call is really a
 * carry-forward from an expired prior session, that prior session's own
 * `startedByUserId` is left exactly as it was; this only describes who
 * initiated the fresh row.
 */
async function getOrStartSession(
  studentId: string,
  forDate: SchoolDate,
  settings: SchoolSettings,
  startedByUserId: string | null,
) {
  const target = schoolDateToUtcMidnight(forDate);

  const mostRecent = await prisma.packingSession.findFirst({
    where: { studentId, forDate: target },
    orderBy: { startedAt: "desc" },
  });

  // Already finished for the day — re-scanning an already-packed item must
  // not spin up a brand new session and re-complete (and re-award) it. This
  // is also what stops a morning session from ever being re-completed by a
  // later scan: both windows key sessions by forDate, and the morning
  // window always resolves to a *different* date (today) than the evening
  // window (tomorrow), so they can never collide on the same row anyway —
  // this check is what protects a single window's session from itself.
  if (mostRecent?.status === "COMPLETED") return mostRecent;

  if (mostRecent?.status === "ACTIVE") {
    if (!isExpired(mostRecent, settings.sessionTtlMinutes)) return mostRecent;
    await prisma.packingSession.update({ where: { id: mostRecent.id }, data: { status: "EXPIRED" } });
  }

  // startedAt is set explicitly from the app clock (Date.now()), not the
  // schema's DB-level CURRENT_TIMESTAMP default — isExpired() below compares
  // against Date.now() too, and both must read the same clock.
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.packingSession.create({
      data: {
        studentId,
        forDate: target,
        status: "ACTIVE",
        startedAt: new Date(),
        continuous: mostRecent == null,
        startedByUserId,
      },
    });
    if (mostRecent) {
      await tx.packingCheck.updateMany({ where: { sessionId: mostRecent.id }, data: { sessionId: fresh.id } });
    }
    return fresh;
  });
}

async function tryCompleteSession(sessionId: string, studentId: string, forDate: SchoolDate, settings: SchoolSettings) {
  const required = await requiredItemsFor(studentId, forDate);
  if (required.items.length === 0) return; // nothing to complete against

  // Scoped to THIS session only — but that's no longer "only what was
  // scanned since the last expiry": getOrStartSession carries a prior
  // session's checks forward onto this one, so this still sees the
  // student's whole evening of progress, not just the current sitting.
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
    if (isExpired(session, settings.sessionTtlMinutes)) {
      await tx.packingSession.update({ where: { id: sessionId }, data: { status: "EXPIRED" } });
      return;
    }
    await tx.packingSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", completedAt: new Date(), pointsAwarded: true },
    });
    await award(studentId, settings.pointsPerCompletion, "PACKING_COMPLETE", { refId: sessionId }, tx);
  });
}

/**
 * The actual scan mechanics, shared by `recordScan` (the student, on their
 * own device) and `recordTeacherScan` (the homeroom teacher, on the
 * student's behalf). Everything
 * that makes a scan "count" the same way regardless of who's holding the
 * camera lives here: code resolution, ownership, session continuity, the
 * photo consent+sampling gate, and completion — so completion, points,
 * streak, and reminders all work unchanged downstream no matter which path
 * produced the `PackingCheck`. What differs between the two callers —
 * authorization, which date is targeted, and who (if anyone) is recorded as
 * having started the session — is resolved by each caller *before* this
 * runs, never inside it.
 */
async function performScan(
  studentId: string,
  code: string,
  photoDataUrl: string | undefined,
  forDate: SchoolDate,
  settings: SchoolSettings,
  startedByUserId: string | null,
) {
  const qrCode = await prisma.qRCode.findUnique({ where: { code } });
  if (!qrCode || qrCode.state !== "ASSIGNED" || !qrCode.itemCopyId) {
    throw new InvalidScanError("รหัส QR นี้ยังไม่ได้ผูกกับของชิ้นไหน");
  }

  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({ where: { id: qrCode.itemCopyId } });
  if (itemCopy.studentId !== studentId) {
    throw new ForbiddenError("view_student", { type: "student", studentId: itemCopy.studentId });
  }

  const session = await getOrStartSession(studentId, forDate, settings, startedByUserId);

  let photoPath: string | null = null;
  if (
    photoDataUrl &&
    (await hasActiveConsent(studentId, "PHOTO_CAPTURE")) &&
    (await shouldCapturePhoto(studentId, itemCopy.subjectItemId))
  ) {
    try {
      photoPath = await savePhoto(photoDataUrl);
    } catch (error) {
      // Photo collection is optional training data; a storage outage must
      // never stop a child from recording that their school item is packed.
      console.error("[packing] failed to save optional scan photo; continuing without it", error);
    }
  }

  await prisma.packingCheck.upsert({
    where: { sessionId_itemCopyId: { sessionId: session.id, itemCopyId: itemCopy.id } },
    create: { sessionId: session.id, itemCopyId: itemCopy.id, photoPath },
    update: {},
  });

  await tryCompleteSession(session.id, studentId, forDate, settings);

  return { itemCopyId: itemCopy.id };
}

/**
 * Records one QR scan for the logged-in student's own item. Server-side
 * only — the client sends a code and an optional photo frame, nothing
 * else is trusted (no session id, no timestamp, no "which item" claim
 * beyond what the code itself resolves to). The photo is the same way:
 * whether it actually gets stored depends on two server-side checks, never
 * on whether the client happened to send one — `hasActiveConsent`
 * (CLAUDE.md "Privacy") and, only if consent is active, `shouldCapturePhoto`
 * (§8.6's sampling — most consented scans still don't keep a photo, that's
 * by design, not a bug). A modified/malicious client sending
 * `photoDataUrl` regardless just has it silently discarded; scanning
 * itself is unaffected either way.
 */
export async function recordScan(actor: Actor, params: { code: string; photoDataUrl?: string }) {
  if (!actor.studentId) throw new ForbiddenError("view_student", { type: "student", studentId: "" });

  const settings = await schoolSettingsForStudent(actor.studentId);
  const forDate = packingFocusDate(settings);

  return performScan(actor.studentId, params.code, params.photoDataUrl, forDate, settings, null);
}

/**
 * The teacher-run packing flow, for the end of the school day — added
 * because the ordinary evening flow assumes a smartphone at home, and a
 * real classroom always has some children for whom that isn't true; those
 * children earning no points at all makes the reward system visibly single
 * out exactly that inequality inside the classroom, which is worse than not
 * having one. The homeroom teacher opens this on their own device and
 * scans the student's own books with their own camera.
 *
 * **Design intent, load-bearing, not a suggestion**: this is not a way to
 * tick a child's items without the child present. The intended, and only
 * sanctioned, flow is the child physically holding the book while the
 * teacher's camera scans its sticker — exactly the same physical act as a
 * student scanning their own book, just with the teacher holding the phone.
 * Nothing here lets a teacher mark an item packed from memory or from a
 * class list; a real `QRCode` on a real book still has to be decoded.
 * CLAUDE.md invariant 7 forbids student- and parent-facing "just tick the
 * box" overrides — this is deliberately not that: it is a teacher path,
 * homeroom-only, and every session it creates is attributable via
 * `startedByUserId` (see below), the same audit reasoning invariant 7
 * already requires of `PointLedger.actorUserId`.
 *
 * Three ways this differs from `recordScan`, all resolved here before
 * `performScan` runs:
 * - **Authorization**: `requireHomeroomAccessForStudent` (`lib/roster.ts`)
 *   — homeroom teacher of the student's *own* classroom only, resolved from
 *   the student's actual active enrollment, never from a classroom id the
 *   caller might supply. A subject teacher assigned to the same classroom,
 *   but not homeroom, is denied exactly like `edit_student_account`'s other
 *   uses (linking a parent, reissuing a login).
 * - **Target date**: `forDate` is always `schoolTomorrow()`, matching the
 *   end-of-day flow this substitutes for, regardless of what time the
 *   teacher runs it.
 * - **Attribution**: `startedByUserId: actor.userId` is stamped on the
 *   session this creates (or continues); `recordScan` always passes `null`.
 */
export async function recordTeacherScan(actor: Actor, params: { studentId: string; code: string; photoDataUrl?: string }) {
  await requireHomeroomAccessForStudent(actor, params.studentId);
  // requireHomeroomAccessForStudent already guarantees this; re-checked so
  // TypeScript can narrow actor.userId's meaning below (same pattern as
  // lib/rewards.ts's fulfillRedemption).
  if (!actor.teacherId) {
    throw new ForbiddenError("edit_student_account", { type: "classroom", classroomId: "" });
  }

  const settings = await schoolSettingsForStudent(params.studentId);
  const forDate = schoolTomorrow();

  return performScan(params.studentId, params.code, params.photoDataUrl, forDate, settings, actor.userId);
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
  pointsPerCompletion: number;
  // False once the completing (or still-in-progress) session's checks
  // include ones carried over from an earlier session that expired for
  // this date — see getOrStartSession. Surfaced on the teacher's morning
  // spot-check page as a signal, not an automatic penalty.
  continuous: boolean;
  activeSession: { startedAt: Date; expiresAt: Date } | null;
};

/**
 * Read-side view behind the student's own screen and the teacher's morning
 * spot-check list — real state, no client-side tick path. `forDate` is
 * whatever date the caller cares about (the student's own screen resolves
 * it via `packingFocusDate`; the teacher's spot-check page always passes
 * `schoolToday()`) — this function itself doesn't care which window, if
 * any, produced the session it finds for that date.
 */
export async function getPackingStatus(studentId: string, forDate: SchoolDate): Promise<PackingStatus> {
  const [required, settings] = await Promise.all([
    requiredItemsFor(studentId, forDate),
    schoolSettingsForStudent(studentId),
  ]);

  const session = await prisma.packingSession.findFirst({
    where: { studentId, forDate: schoolDateToUtcMidnight(forDate) },
    orderBy: { startedAt: "desc" },
  });
  // Scoped to the current/most-recent session only — but that session now
  // carries forward any checks from a session that expired earlier tonight
  // (getOrStartSession), so this is still the student's full progress for
  // the date, not just what happened since the last expiry.
  const checks = session
    ? await prisma.packingCheck.findMany({ where: { sessionId: session.id }, select: { itemCopyId: true } })
    : [];
  const checkedIds = new Set(checks.map((c) => c.itemCopyId));

  const items = required.items.map((item) => ({ ...item, checked: checkedIds.has(item.itemCopyId) }));
  const packedCount = items.filter((i) => i.checked).length;
  const isComplete = session?.status === "COMPLETED";
  const activeSession =
    session && session.status === "ACTIVE" && !isExpired(session, settings.sessionTtlMinutes)
      ? { startedAt: session.startedAt, expiresAt: new Date(session.startedAt.getTime() + settings.sessionTtlMinutes * 60 * 1000) }
      : null;

  return {
    forDate,
    isHoliday: required.isHoliday,
    items,
    packedCount,
    total: items.length,
    isComplete,
    pointsAwarded: session?.pointsAwarded ?? false,
    pointsPerCompletion: settings.pointsPerCompletion,
    continuous: session?.continuous ?? true,
    activeSession,
  };
}

/**
 * Homeroom-only, unlike every other item-copy action in this codebase
 * (bind/rebind/void/GRADING-toggle, all subject-scoped via `lib/qr.ts`'s
 * `requireTeacherAccessForItemCopy`). Morning bag-checking is done by
 * ครูประจำชั้น for the whole bag at once, not by each subject teacher
 * showing up separately to check only their own item — subject-scoping this
 * would show every teacher a partial view of one child's bag, which matches
 * nobody's actual morning routine (ARCHITECTURE.md §6.4/§10 records this
 * reversal; the page originally intended to move the *other* way).
 */
async function requireHomeroomAccessForItemCopyOwner(actor: Actor, studentId: string) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, OR: [{ endDate: null }, { endDate: { gte: schoolDateToUtcMidnight(schoolToday()) } }] },
    orderBy: { startDate: "desc" },
    select: { classroomId: true },
  });
  if (!enrollment) throw new Error("Student has no active enrollment");

  const resource: Resource = { type: "classroom", classroomId: enrollment.classroomId };
  if (!(await can(actor, "spot_check", resource))) {
    throw new ForbiddenError("spot_check", resource);
  }
}

/**
 * CLAUDE.md "Anti-cheat": teachers spot-check a few students each morning;
 * a mismatch (the item was scanned — last night or this morning — but isn't
 * actually in the bag) deducts points and breaks the streak (lib/points.ts's
 * computeStreak reads streak off the most recent MORNING_CHECK_FAIL row, so
 * this is the only thing that resets it). Confirming a match writes nothing — there is
 * no positive ledger entry for "checked out fine", only the negative one
 * for a catch. Every call is a teacher override, so it's audited via
 * actorUserId (invariant 7).
 *
 * The penalty simply reverses that day's completion award (the school's
 * pointsPerCompletion, not an independent fixed number) — one catch can
 * cost at most what one honest evening earns, never more, so the streak
 * reset stays the real consequence rather than the point loss itself. It's
 * also floored at the student's current balance (awardPenaltyCappedAtZero,
 * lib/points.ts) so the ledger sum never goes negative.
 */
export async function spotCheck(actor: Actor, params: { itemCopyId: string; actuallyPacked: boolean }) {
  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({ where: { id: params.itemCopyId } });
  await requireHomeroomAccessForItemCopyOwner(actor, itemCopy.studentId);
  if (params.actuallyPacked) return null;

  const hadCheck = await prisma.packingCheck.findFirst({
    where: { itemCopyId: params.itemCopyId, session: { studentId: itemCopy.studentId, forDate: schoolDateToUtcMidnight(schoolToday()) } },
  });
  if (!hadCheck) throw new InvalidScanError("ของชิ้นนี้ไม่ได้ถูกสแกนไว้ จึงไม่มีอะไรให้ตรวจสอบ");

  const settings = await schoolSettingsForStudent(itemCopy.studentId);
  return awardPenaltyCappedAtZero(itemCopy.studentId, settings.pointsPerCompletion, "MORNING_CHECK_FAIL", {
    refId: params.itemCopyId,
    actorUserId: actor.userId,
  });
}
