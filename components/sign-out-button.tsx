import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <Button type="submit" variant="ghost" size="sm" className={cn("text-muted-foreground", className)}>
        <LogOut />
        ออกจากระบบ
      </Button>
    </form>
  );
}
