import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { photoStorage } from "@/lib/photo-storage";

// Packing-check photos are private by default (CLAUDE.md "Privacy"): never
// a public URL, always resolved through this authorization-checked route —
// regardless of storage backend. Local disk streams the bytes through this
// route directly; S3-compatible storage redirects to a short-lived signed
// URL instead (never a public/guessable one, and never issued before this
// route's own auth check has already passed).
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

  const result = await photoStorage.read(check.photoPath);
  if (result.kind === "redirect") {
    // no-store: this exact URL expires in minutes, so a cached redirect
    // would just hand back a dead link — always re-authorize and mint a
    // fresh one on the next request.
    return NextResponse.redirect(result.url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  }
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: { "Content-Type": result.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
