import { redirect } from "next/navigation";
import { Backpack } from "lucide-react";
import { requireActor } from "@/lib/session";
import { pendingRedemptionCountForTeacher } from "@/lib/dashboard";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { SignOutButton } from "@/components/sign-out-button";
import { TeacherTabBar } from "@/components/teacher-tab-bar";
import { TeacherSidebar } from "@/components/teacher-sidebar";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!actor.teacherId) redirect("/");
  const [pendingRedemptionCount, classrooms] = await Promise.all([
    pendingRedemptionCountForTeacher(actor),
    // Small, cheap list (id+name only) so the sidebar can show the current
    // classroom's name without a second layout fetching it separately —
    // see components/teacher-sidebar.tsx's own note on why this replaced
    // the earlier two-sidebar design.
    prisma.classroom.findMany({ where: visibleClassroomWhere(actor), select: { id: true, name: true } }),
  ]);

  return (
    // lg:h-dvh + lg:overflow-hidden turns the row below into its own
    // scroll container on desktop, so the sidebar (given its own
    // overflow-y-auto) stays fixed in place instead of scrolling away with
    // a long page (e.g. a classroom's full student roster) — mobile is
    // untouched (no sidebar there; the bottom tab bar is already `fixed`).
    <div className="teacher-shell flex-1 flex flex-col lg:h-dvh lg:overflow-hidden">
      {/* Mobile owns the top identity bar; tablet/desktop owns the sidebar,
          so the logo never appears twice at the same breakpoint. */}
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-lg print:hidden lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-heading font-semibold">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Backpack className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block text-sm leading-tight">จัดกระเป๋าไปโรงเรียน</span>
              <span className="block text-xs font-normal text-muted-foreground">พื้นที่คุณครู</span>
            </span>
          </div>
          <SignOutButton className="rounded-xl bg-card px-3 text-muted-foreground shadow-sm hover:text-foreground" />
        </div>
      </header>
      {/* TeacherSidebar (desktop/tablet, md+) and TeacherTabBar (phone,
          below md) are two views of the same 7 destinations, never both at
          once — see each component's own responsive classes. The sidebar's
          own shape never changes across routes; viewing a specific
          classroom only expands a nested section under "ห้องเรียน". */}
      <div className="flex flex-1 min-h-0 md:flex-row">
        <TeacherSidebar
          classrooms={classrooms}
          pendingRedemptionCount={pendingRedemptionCount}
          signOutControl={<SignOutButton className="w-full justify-start rounded-xl text-muted-foreground hover:text-foreground" />}
        />
        <main className="flex-1 min-w-0 bg-background p-4 pb-24 lg:overflow-y-auto lg:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <TeacherTabBar pendingRedemptionCount={pendingRedemptionCount} />
    </div>
  );
}
