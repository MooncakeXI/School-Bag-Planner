import { Trash2 } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRewardAction, deleteRewardAction, fulfillRedemptionAction } from "./actions";

export default async function TeacherRewardsPage() {
  const actor = await requireActor();

  const classrooms = await prisma.classroom.findMany({
    where: visibleClassroomWhere(actor),
    select: { schoolId: true },
  });
  const schoolIds = [...new Set(classrooms.map((c) => c.schoolId))];

  const [schools, rewards, pendingRedemptions] = await Promise.all([
    prisma.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } }),
    prisma.reward.findMany({ where: { schoolId: { in: schoolIds } }, orderBy: { cost: "asc" } }),
    prisma.redemption.findMany({
      where: { status: "PENDING", reward: { schoolId: { in: schoolIds } } },
      select: { id: true, pointsSpent: true, createdAt: true, student: { select: { name: true } }, reward: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">ร้านรางวัล</h1>
        <p className="text-sm text-muted-foreground">จัดการของรางวัลและคำขอแลกของนักเรียน</p>
      </div>

      {pendingRedemptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">คำขอแลกรางวัลใหม่ ({pendingRedemptions.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingRedemptions.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border p-3">
                <div className="text-sm">
                  <p className="font-semibold">
                    {r.student.name} · {r.reward.name}
                  </p>
                  <p className="text-muted-foreground">{r.pointsSpent} คะแนน</p>
                </div>
                <form action={fulfillRedemptionAction}>
                  <input type="hidden" name="redemptionId" value={r.id} />
                  <Button type="submit" size="sm">
                    ให้ของแล้ว
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {rewards.map((reward) => (
          <Card key={reward.id}>
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <p className="font-semibold">{reward.name}</p>
                <p className="text-sm text-muted-foreground">{reward.cost} คะแนน</p>
              </div>
              <form action={deleteRewardAction}>
                <input type="hidden" name="rewardId" value={reward.id} />
                <Button type="submit" variant="ghost" size="sm">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      {schools.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีโรงเรียนผูกอยู่</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">เพิ่มของรางวัล</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createRewardAction} className="flex flex-col gap-4">
              {schools.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="schoolId">โรงเรียน</Label>
                  <select id="schoolId" name="schoolId" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="schoolId" value={schools[0].id} />
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">ชื่อของรางวัล</Label>
                  <Input id="name" name="name" placeholder="เช่น ดินสอ 2B" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cost">คะแนนที่ใช้แลก</Label>
                  <Input id="cost" name="cost" type="number" min={1} required />
                </div>
              </div>
              <Button type="submit" className="self-start">
                เพิ่ม
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
