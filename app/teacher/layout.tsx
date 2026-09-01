import { redirect } from "next/navigation";
import { Backpack } from "lucide-react";
import { requireActor } from "@/lib/session";
import { pendingRedemptionCountForTeacher } from "@/lib/dashboard";
import { SignOutButton } from "@/components/sign-out-button";
import { TeacherNav } from "@/components/teacher-nav";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!actor.teacherId) redirect("/");
  const pendingRedemptionCount = await pendingRedemptionCountForTeacher(actor);

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-sidebar text-sidebar-foreground print:hidden">
        <div className="flex items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 font-heading text-lg font-semibold">
            <Backpack className="size-5 text-primary" />
            จัดกระเป๋าไปโรงเรียน
          </div>
          <SignOutButton className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
        </div>
        <div className="px-3 pb-3 md:px-5">
          <TeacherNav pendingRedemptionCount={pendingRedemptionCount} />
        </div>
      </header>
      <div className="flex-1 bg-background p-4 md:p-6">{children}</div>
    </div>
  );
}
