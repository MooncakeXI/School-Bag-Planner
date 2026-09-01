import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";
import { StudentNav } from "@/components/student-nav";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!actor.studentId) redirect("/");

  return (
    <div className="flex-1 flex flex-col">
      <header className="flex justify-end p-3">
        <SignOutButton />
      </header>
      <div className="flex-1 px-4 pb-6">{children}</div>
      <StudentNav />
    </div>
  );
}
