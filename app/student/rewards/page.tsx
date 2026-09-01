import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { balance } from "@/lib/points";
import { schoolDateToUtcMidnight, schoolToday } from "@/lib/time";
import { cn } from "@/lib/utils";
import { redeemAction } from "./actions";

export default async function StudentRewardsPage() {
  const actor = await requireActor();
  const studentId = actor.studentId!;

  const today = schoolDateToUtcMidnight(schoolToday());
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
    orderBy: { startDate: "desc" },
    select: { classroom: { select: { schoolId: true, name: true } } },
  });

  const [points, rewards] = await Promise.all([
    balance(studentId),
    enrollment
      ? prisma.reward.findMany({
          where: { schoolId: enrollment.classroom.schoolId, active: true },
          orderBy: { cost: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main className="flex flex-col gap-5 max-w-lg mx-auto w-full pt-4">
      <div className="rounded-3xl bg-warning-foreground px-6 py-6 text-warning">
        <p className="text-sm opacity-75">คะแนนของฉัน</p>
        <p className="mt-0.5 font-heading text-5xl font-bold leading-none">{points}</p>
        {enrollment && <p className="mt-2 text-[13.5px] opacity-75">รับของที่ห้อง {enrollment.classroom.name}</p>}
      </div>

      <h2 className="font-heading text-lg font-semibold">ของรางวัลในห้อง</h2>

      {rewards.length === 0 ? (
        <div className="rounded-3xl bg-muted py-10 text-center text-muted-foreground">ยังไม่มีของรางวัล</div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rewards.map((reward) => {
            const canAfford = points >= reward.cost;
            return (
              <li key={reward.id}>
                <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold">{reward.name}</p>
                    <p className="mt-0.5 text-sm text-warning">{reward.cost} คะแนน</p>
                  </div>
                  <form action={redeemAction}>
                    <input type="hidden" name="rewardId" value={reward.id} />
                    <button
                      type="submit"
                      disabled={!canAfford}
                      className={cn(
                        "h-[46px] min-w-[84px] shrink-0 rounded-2xl px-5 text-[15px] font-semibold disabled:cursor-default",
                        canAfford ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {canAfford ? "แลก" : "ยังไม่พอ"}
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-2xl bg-accent p-4 text-[13.5px] leading-relaxed text-accent-foreground">
        แลกแล้วครูจะเห็นรายการในแท็บเล็ต และให้ของจริงที่ห้องเรียนตอนเช้า
      </div>
    </main>
  );
}
