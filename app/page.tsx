import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";

// No role picker: an account gets sent straight to its own page. When one
// account is linked to more than one role (e.g. a teacher who is also a
// parent), student > teacher > parent is a fixed priority, not a choice —
// keeps login to zero extra taps for the overwhelmingly common case of a
// single-role account, at the cost of only ever landing on the first
// matching role for a genuinely multi-role one.
export default async function HomePage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  if (actor.studentId) redirect("/student/tomorrow");
  if (actor.teacherId) redirect("/teacher");
  if (actor.parentId) redirect("/parent");

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-lg font-semibold">บัญชีนี้ยังไม่ได้ผูกกับนักเรียน คุณครู หรือผู้ปกครองคนใดเลย</p>
      <p className="text-sm text-muted-foreground">กรุณาติดต่อคุณครูประจำชั้นเพื่อเชื่อมบัญชี</p>
    </main>
  );
}
