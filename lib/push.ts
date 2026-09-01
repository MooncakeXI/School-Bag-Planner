import webpush from "web-push";
import { prisma } from "./prisma";
import { getPackingStatus } from "./packing";
import { schoolTomorrow } from "./time";
import type { Actor } from "./actor";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails("mailto:no-reply@example.com", vapidPublicKey, vapidPrivateKey);
}

export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };

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
 */
export async function sendEveningReminders(): Promise<{ sent: number; pruned: number }> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured");
  }

  const forDate = schoolTomorrow();
  const subscriptions = await prisma.pushSubscription.findMany({
    select: { id: true, studentId: true, endpoint: true, p256dh: true, auth: true },
  });

  let sent = 0;
  let pruned = 0;

  for (const sub of subscriptions) {
    const status = await getPackingStatus(sub.studentId, forDate);
    const missing = status.items.filter((i) => !i.checked);
    if (missing.length === 0) continue;

    const body =
      missing.length <= 3
        ? `ยังขาดอีก ${missing.length} อย่าง: ${missing.map((i) => i.subjectItemName).join(", ")}`
        : `ยังขาดอีก ${missing.length} อย่าง`;

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: "จัดกระเป๋านักเรียน", body, url: "/student/tomorrow" }),
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
        pruned++;
      } else {
        throw err;
      }
    }
  }

  return { sent, pruned };
}
