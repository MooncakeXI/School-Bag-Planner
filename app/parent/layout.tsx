import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!actor.parentId) redirect("/");

  return (
    <div className="flex-1 flex flex-col">
      <header className="flex justify-end p-3">
        <SignOutButton />
      </header>
      <div className="flex-1 px-4 pb-8">{children}</div>
    </div>
  );
}
