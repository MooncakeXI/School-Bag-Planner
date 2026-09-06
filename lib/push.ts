import webpush from "web-push";
import { prisma } from "./prisma";
import { getPackingStatus } from "./packing";
import { SCHOOL_TZ, schoolDateToUtcMidnight, schoolToday, schoolTomorrow } from "./time";
import type { Actor } from "./actor";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails("mailto:no-reply@example.com", vapidPublicKey, vapidPrivateKey);
}

export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushDeliveryResult = { sent: number; pruned: number; failed: number };

type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

function requireVapidConfiguration() {
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured");
  }
}

/** Delivers one payload without allowing a bad endpoint to block every other
 * recipient. `sent` counts devices, which is useful because one student may
 * have both a phone and tablet subscribed. */
async function deliverPush(subscriptions: StoredSubscription[], payload: string): Promise<PushDeliveryResult> {
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
        pruned++;
      } else {
        failed++;
        console.error(`push failed for endpoint ${sub.endpoint} (status ${statusCode ?? "unknown"}):`, err);
      }
    }
  }

  return { sent, pruned, failed };
}

function addDeliveryResult(target: PushDeliveryResult, next: PushDeliveryResult) {
  target.sent += next.sent;
  target.pruned += next.pruned;
  target.failed += next.failed;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

/** A student subscribes only for themselves — same direct-equality shape as lib/packing.ts's scan ownership check. */
export async function subscribe(actor: Actor, subscription: PushSubscriptionJSON) {
  if (!actor.studentId) throw new Error("Only a student may subscribe to their own packing reminders");
  return prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      studentId: actor.studentId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: {},
  });
}

/**
 * Sends the evening reminder to every subscribed student who still has
 * unpacked items for tomorrow. Skips entirely once fully packed — CLAUDE.md
 * anti-cheat/design: no repeat nagging once done. Intended to be invoked by
 * `app/api/cron/reminders/route.ts` on an external 18:30/20:00 schedule.
 *
 * Only a whole-run precondition (VAPID not configured — nothing could be
 * sent to anyone, regardless of subscriptions) throws. Every other failure
 * is scoped to the one subscription it happened on: a dead/gone endpoint
 * (404/410) is pruned exactly as before; anything else (a 500 from the push
 * service, a network error, ...) is counted in `failed` and logged, not
 * rethrown — one misbehaving endpoint must not cost every other student
 * that evening's reminder, and which students got skipped must not depend
 * on iteration order.
 */
export async function sendEveningReminders(): Promise<PushDeliveryResult> {
  requireVapidConfiguration();

  const forDate = schoolTomorrow();
  const subscriptions = await prisma.pushSubscription.findMany({
    select: { id: true, studentId: true, endpoint: true, p256dh: true, auth: true },
  });

  // Grouped by student so a student with two devices (phone + tablet, both
  // subscribed) computes requiredItemsFor once, not once per subscription.
  const subsByStudent = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions) {
    const list = subsByStudent.get(sub.studentId);
    if (list) list.push(sub);
    else subsByStudent.set(sub.studentId, [sub]);
  }

  const result: PushDeliveryResult = { sent: 0, pruned: 0, failed: 0 };

  for (const [studentId, subs] of subsByStudent) {
    const status = await getPackingStatus(studentId, forDate);
    const missing = status.items.filter((i) => !i.checked);
    if (missing.length === 0) continue;

    const body =
      missing.length <= 3
        ? `ยังขาดอีก ${missing.length} อย่าง: ${missing.map((i) => i.subjectItemName).join(", ")}`
        : `ยังขาดอีก ${missing.length} อย่าง`;
    const payload = JSON.stringify({ title: "จัดกระเป๋านักเรียน", body, url: "/student/tomorrow" });

    addDeliveryResult(result, await deliverPush(subs, payload));
  }

  return result;
}

/**
 * Sends one approaching-deadline push per student per homework once a
 * deadline enters the next 24 hours. Call this from the same protected cron
 * route as packing reminders; repeated scheduler invocations are safe thanks
 * to HomeworkReminder's unique receipt. A subscription added late in the
 * notice window can still receive the reminder, because no receipt is made
 * until there is a device and at least one successful delivery.
 */
export async function sendHomeworkDeadlineReminders(now = new Date()): Promise<PushDeliveryResult> {
  requireVapidConfiguration();

  const noticeEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const today = schoolDateToUtcMidnight(schoolToday());
  const homework = await prisma.homework.findMany({
    where: { deadlineAt: { gt: now, lte: noticeEndsAt } },
    select: {
      id: true,
      deadlineAt: true,
      subject: { select: { name: true } },
      reminders: { select: { studentId: true } },
      classroom: {
        select: {
          enrollments: {
            where: { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
            select: {
              student: {
                select: {
                  id: true,
                  pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const result: PushDeliveryResult = { sent: 0, pruned: 0, failed: 0 };
  for (const item of homework) {
    const alreadyNotified = new Set(item.reminders.map((reminder) => reminder.studentId));
    const deadlineLabel = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: SCHOOL_TZ,
    }).format(item.deadlineAt);
    const payload = JSON.stringify({
      title: "การบ้านใกล้ถึงกำหนดส่ง",
      body: `${item.subject.name}: ส่งภายใน ${deadlineLabel} น.`,
      url: "/student/homework",
    });

    for (const enrollment of item.classroom.enrollments) {
      const student = enrollment.student;
      if (alreadyNotified.has(student.id) || student.pushSubscriptions.length === 0) continue;

      // The unique row is a small reservation. It avoids duplicate pushes if
      // two cron calls overlap; on an all-device failure it is removed below
      // so a later scheduler run can retry.
      try {
        await prisma.homeworkReminder.create({ data: { homeworkId: item.id, studentId: student.id } });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }

      const delivery = await deliverPush(student.pushSubscriptions, payload);
      addDeliveryResult(result, delivery);
      if (delivery.sent === 0) {
        await prisma.homeworkReminder.delete({ where: { homeworkId_studentId: { homeworkId: item.id, studentId: student.id } } });
      }
    }
  }

  return result;
}
