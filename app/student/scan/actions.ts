"use server";

import { requireActor } from "@/lib/session";
import { recordScan } from "@/lib/packing";
import { PackingWindowClosedError, InvalidScanError, ForbiddenError } from "@/lib/errors";

export async function recordScanAction(params: { code: string; photoDataUrl?: string }) {
  const actor = await requireActor();
  try {
    const result = await recordScan(actor, params);
    return { ok: true as const, itemCopyId: result.itemCopyId };
  } catch (err) {
    if (err instanceof PackingWindowClosedError) return { ok: false as const, error: err.message };
    if (err instanceof InvalidScanError) return { ok: false as const, error: err.message };
    if (err instanceof ForbiddenError) return { ok: false as const, error: "ของชิ้นนี้ไม่ใช่ของคุณ" };
    throw err;
  }
}
