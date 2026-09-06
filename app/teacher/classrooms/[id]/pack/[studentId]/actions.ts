"use server";

import { requireActor } from "@/lib/session";
import { recordTeacherScan } from "@/lib/packing";
import { InvalidScanError, ForbiddenError } from "@/lib/errors";

export async function recordTeacherScanAction(params: { studentId: string; code: string; photoDataUrl?: string }) {
  const actor = await requireActor();
  try {
    const result = await recordTeacherScan(actor, params);
    return { ok: true as const, itemCopyId: result.itemCopyId };
  } catch (err) {
    if (err instanceof InvalidScanError) return { ok: false as const, error: err.message };
    if (err instanceof ForbiddenError) return { ok: false as const, error: "คุณไม่มีสิทธิ์จัดกระเป๋าให้นักเรียนคนนี้" };
    throw err;
  }
}
