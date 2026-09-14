import { Trash2, Gift, Sparkles } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { ListGroup, ListRow } from "@/components/ios-list";
import { RowIcon } from "@/components/row-icon";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  createRewardAction,
  deleteRewardAction,
  fulfillRedemptionAction,
  restockRewardAction,
  toggleRewardActiveAction,
} from "./actions";

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
      <PageHeader title="ร้านรางวัล" subtitle="จัดการของรางวัลและคำขอแลกของนักเรียน" />

      {pendingRedemptions.length > 0 && (
        <ListGroup label={`คำขอแลกรางวัลใหม่ (${pendingRedemptions.length})`}>
          {pendingRedemptions.map((r) => (
            <ListRow
              key={r.id}
              chevron={false}
              leading={<RowIcon icon={Sparkles} tone="warning" />}
              trailing={
                <form action={fulfillRedemptionAction}>
                  <input type="hidden" name="redemptionId" value={r.id} />
                  <Button type="submit" size="sm" className="min-h-9 rounded-full">
                    ให้ของแล้ว
                  </Button>
                </form>
              }
            >
              <p className="font-semibold">
                {r.student.name} · {r.reward.name}
              </p>
              <p className="text-xs text-muted-foreground">{r.pointsSpent} คะแนน</p>
            </ListRow>
          ))}
        </ListGroup>
      )}

      <ListGroup label="ของรางวัลทั้งหมด">
        {rewards.length === 0 ? (
          <ListRow chevron={false}>
            <span className="text-sm text-muted-foreground">ยังไม่มีของรางวัล</span>
          </ListRow>
        ) : (
          rewards.map((reward) => (
            <ListRow
              key={reward.id}
              chevron={false}
              className="flex-wrap"
              leading={<RowIcon icon={Gift} tone={reward.active ? "primary" : "neutral"} />}
              trailing={
                <div className="flex w-full flex-wrap items-center justify-end gap-2 pl-14 sm:w-auto sm:pl-0">
                  <form action={restockRewardAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="rewardId" value={reward.id} />
                    <Label htmlFor={`stock-${reward.id}`} className="text-xs text-muted-foreground">
                      จำนวนคงเหลือ
                    </Label>
                    <Input
                      id={`stock-${reward.id}`}
                      name="stock"
                      type="number"
                      min={0}
                      defaultValue={reward.stock ?? ""}
                      placeholder="ไม่จำกัด"
                      className="w-24 text-sm"
                    />
                    <Button type="submit" variant="outline" size="sm" className="h-9 px-2 text-xs">
                      บันทึก
                    </Button>
                  </form>
                  <form action={toggleRewardActiveAction}>
                    <input type="hidden" name="rewardId" value={reward.id} />
                    <input type="hidden" name="active" value={(!reward.active).toString()} />
                    <Button type="submit" variant="ghost" size="sm" className="h-9 px-2 text-xs">
                      {reward.active ? "ปิดรับแลก" : "เปิดรับแลก"}
                    </Button>
                  </form>
                  <form action={deleteRewardAction}>
                    <input type="hidden" name="rewardId" value={reward.id} />
                    <ConfirmSubmitButton
                      type="submit"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={`ลบของรางวัล ${reward.name}`}
                      confirmMessage={`ลบของรางวัล “${reward.name}” ถาวรใช่ไหม`}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </ConfirmSubmitButton>
                  </form>
                </div>
              }
            >
              <p className="font-semibold">
                {reward.name}
                {!reward.active && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(ปิดรับแลก)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {reward.cost} คะแนน · {reward.stock === null ? "ไม่จำกัด" : `เหลือ ${reward.stock} ชิ้น`}
              </p>
            </ListRow>
          ))
        )}
      </ListGroup>

      {schools.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีโรงเรียนผูกอยู่</p>
      ) : (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">เพิ่มของรางวัล</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createRewardAction} className="flex flex-col gap-4">
              {schools.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="schoolId">โรงเรียน</Label>
                  <select id="schoolId" name="schoolId" className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">ชื่อของรางวัล</Label>
                  <Input id="name" name="name" placeholder="เช่น ดินสอ 2B" className="h-11" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cost">คะแนนที่ใช้แลก</Label>
                  <Input id="cost" name="cost" type="number" min={1} className="h-11" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stock">จำนวนที่มี</Label>
                  <Input id="stock" name="stock" type="number" min={0} placeholder="ไม่จำกัด" className="h-11" />
                </div>
              </div>
              <Button type="submit" className="min-h-11 self-start rounded-xl">
                เพิ่มของรางวัล
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
