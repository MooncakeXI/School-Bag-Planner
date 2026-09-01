import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { photoFilePath } from "@/lib/packing";

const CONTENT_TYPE: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// Packing-check photos are private by default (CLAUDE.md "Privacy"): never
// a public URL, always resolved through this authorization-checked route.
export async function GET(_req: Request, { params }: { params: Promise<{ checkId: string }> }) {
  const actor = await requireActor();
  const { checkId } = await params;

  const check = await prisma.packingCheck.findUnique({
    where: { id: checkId },
    select: { photoPath: true, itemCopy: { select: { studentId: true } } },
  });
  if (!check || !check.photoPath) return NextResponse.json({ error: "not found" }, { status: 404 });

  const allowed = await can(actor, "view_student", { type: "student", studentId: check.itemCopy.studentId });
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ext = check.photoPath.split(".").pop() ?? "";
  const bytes = await readFile(photoFilePath(check.photoPath));
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}
