import Link from "next/link";
import { Backpack, QrCode, Coins, Bell, Users, GraduationCap, School, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ROLE_CARDS = [
  {
    icon: GraduationCap,
    title: "นักเรียน",
    description: "ดูของที่ต้องเตรียมของวันพรุ่งนี้ สแกน QR เช็คของที่แพ็คแล้ว สะสมแต้มแลกของรางวัล",
  },
  {
    icon: School,
    title: "คุณครู",
    description: "ดูใครแพ็คกระเป๋าครบ จัดการอุปกรณ์การเรียน ตรวจการบ้าน และมอบของรางวัล",
  },
  {
    icon: Users,
    title: "ผู้ปกครอง",
    description: "ติดตามลูกได้แบบเรียลไทม์ ว่าแพ็คกระเป๋าครบหรือยัง ไม่ต้องคอยถามเอง",
  },
];

const FEATURES = [
  { icon: QrCode, label: "สแกน QR เช็คของ", description: "ติดสติกเกอร์บนหนังสือแต่ละเล่ม สแกนแล้วรู้ทันทีว่าแพ็คครบไหม" },
  { icon: Coins, label: "สะสมแต้ม", description: "แพ็คกระเป๋าครบทุกวันได้แต้ม สะสมแลกของรางวัลจริง" },
  { icon: Bell, label: "แจ้งเตือนตอนเย็น", description: "เตือนก่อนเวลานอน ไม่ลืมจัดกระเป๋าอีกต่อไป" },
  { icon: Sparkles, label: "ตารางอัปเดตอัตโนมัติ", description: "วันหยุด สลับคาบ วันสอบ ระบบจัดของให้ตรงทุกกรณี" },
];

export function LandingPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2 font-heading text-base font-semibold">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Backpack className="size-4.5" />
          </span>
          จัดกระเป๋าไปโรงเรียน
        </div>
        <Button variant="outline" size="sm" render={<Link href="/login">เข้าสู่ระบบ</Link>} />
      </header>

      <section className="flex flex-col items-center gap-6 px-5 pt-8 pb-14 text-center sm:pt-14">
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
          สำหรับนักเรียนประถม ครู และผู้ปกครอง
        </span>
        <h1 className="max-w-xl font-heading text-3xl leading-tight font-semibold text-balance sm:text-4xl">
          ไม่ลืมของ ไม่ต้องเดา จัดกระเป๋าครบทุกวัน
        </h1>
        <p className="max-w-md text-sm text-muted-foreground sm:text-base">
          แอปเดียวที่ช่วยนักเรียนรู้ว่าต้องเตรียมอะไรบ้างตามตารางเรียนจริง สแกนเช็คของด้วย QR
          สะสมแต้มแลกรางวัล พร้อมให้ผู้ปกครองและคุณครูติดตามได้แบบเรียลไทม์
        </p>
        <Button size="lg" className="h-[52px] rounded-2xl px-8 text-base font-semibold" render={<Link href="/login">เริ่มใช้งาน</Link>} />
      </section>

      <section className="px-5 pb-14">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {ROLE_CARDS.map((role) => (
            <Card key={role.title}>
              <CardContent className="flex flex-col items-start gap-3 pt-1">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <role.icon className="size-5" />
                </span>
                <div className="space-y-1">
                  <p className="font-heading text-sm font-semibold">{role.title}</p>
                  <p className="text-sm text-muted-foreground">{role.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-card px-5 py-14 ring-1 ring-border">
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </span>
              <div className="space-y-0.5">
                <p className="font-heading text-sm font-semibold">{f.label}</p>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-center gap-4 px-5 py-14 text-center">
        <p className="font-heading text-xl font-semibold">พร้อมเริ่มใช้งานแล้ว</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          นักเรียนเข้าสู่ระบบด้วยรหัสนักเรียนที่คุณครูออกให้ ส่วนคุณครูและผู้ปกครองเข้าสู่ระบบด้วย Google ได้เลย
        </p>
        <Button size="lg" className="h-[52px] rounded-2xl px-8 text-base font-semibold" render={<Link href="/login">เข้าสู่ระบบ</Link>} />
      </section>

      <footer className="px-5 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} จัดกระเป๋าไปโรงเรียน
      </footer>
    </main>
  );
}
