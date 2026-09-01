import { Backpack } from "lucide-react";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { LoginTabs } from "@/components/login-tabs";
import { StudentLoginForm } from "@/components/student-login-form";

export default function LoginPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl bg-card px-8 py-10 text-center ring-1 ring-border">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Backpack className="size-7" />
        </div>
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold">จัดกระเป๋าไปโรงเรียน</h1>
          <p className="text-sm text-muted-foreground">เข้าสู่ระบบเพื่อดูตารางเรียนและของที่ต้องเตรียม</p>
        </div>

        <LoginTabs
          teacherParent={
            <form
              className="w-full"
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <Button type="submit" size="lg" className="h-[52px] w-full rounded-2xl text-base font-semibold">
                เข้าสู่ระบบด้วย Google
              </Button>
            </form>
          }
          student={<StudentLoginForm />}
        />
      </div>
    </main>
  );
}
