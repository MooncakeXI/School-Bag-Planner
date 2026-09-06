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
    <div className="flex-1 flex flex-col">
      {/* Compact iOS nav bar — just identity + sign out. The big page title
          lives in each page's own PageHeader, not here (see components/page-header.tsx). */}
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-lg print:hidden">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-1.5 font-heading text-sm font-semibold text-muted-foreground">
            <Backpack className="size-4 text-primary" />
            จัดกระเป๋าไปโรงเรียน
          </div>
          <SignOutButton className="text-muted-foreground hover:text-foreground" />
        </div>
      </header>
      {/* TeacherSidebar (desktop/tablet, md+) and TeacherTabBar (phone,
          below md) are two views of the same 6 destinations, never both at
          once — see each component's own responsive classes. The sidebar's
          own shape never changes across routes; viewing a specific
          classroom only expands a nested section under "ห้องเรียน". */}
      <div className="flex flex-1 md:flex-row">
        <TeacherSidebar classrooms={classrooms} pendingRedemptionCount={pendingRedemptionCount} />
        <div className="flex-1 min-w-0 bg-background p-4 pb-24 md:p-6">{children}</div>
      </div>
      <TeacherTabBar pendingRedemptionCount={pendingRedemptionCount} />
    </div>
  );
}
