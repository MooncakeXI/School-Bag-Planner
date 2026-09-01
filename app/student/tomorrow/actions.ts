"use server";

import { requireActor } from "@/lib/session";
import { subscribe, type PushSubscriptionJSON } from "@/lib/push";

export async function subscribeAction(subscription: PushSubscriptionJSON) {
  const actor = await requireActor();
  await subscribe(actor, subscription);
}
