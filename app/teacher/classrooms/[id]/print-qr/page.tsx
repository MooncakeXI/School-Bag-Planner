import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can, manageableSubjectsInClassroom } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { StickerSheet } from "@/components/sticker-sheet";
import { generateAndBindCodesAction, generateCodesAction } from "./actions";

export default async function PrintQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ codes?: string }>;
}) {
  const actor = await requireActor();
  const { id: classroomId } = await params;
  const { codes: codesParam } = await searchParams;

  const allowed = await can(actor, "edit_roster", { type: "classroom", classroomId });
  if (!allowed) notFound();

  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: classroomId },
    select: { schoolId: true },
  });
  const manageableSubjects = await manageableSubjectsInClassroom(actor, classroomId);

  const codeList = codesParam ? codesParam.split(",").filter(Boolean) : [];
  // Codes just generated here can be either spare (UNASSIGNED, no name to
  // show — the original flow) or pre-bound by generateAndBindCodesAction
  // (ASSIGNED with a student/item already attached) — one query param,
  // one render path, the label just falls back to the raw code when there's
  // no ItemCopy to name.
  const boundInfo = codeList.length
    ? await prisma.qRCode.findMany({
        where: { code: { in: codeList } },
        select: {
          code: true,
          itemCopy: { select: { student: { select: { name: true } }, subjectItem: { select: { name: true } } } },
        },
      })
    : [];
  const boundInfoByCode = new Map(boundInfo.map((r) => [r.code, r]));
  const labels = await Promise.all(
    codeList.map(async (code) => ({
      code,
      svg: await QRCode.toString(code, { type: "svg", width: 160, margin: 4 }),
      studentName: boundInfoByCode.get(code)?.itemCopy?.student.name,
      itemName: boundInfoByCode.get(code)?.itemCopy?.subjectItem.name,
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="พิมพ์สติกเกอร์ QR"
          subtitle="สร้างสติกเกอร์เปล่าไว้ผูกทีหลัง หรือสร้างพร้อมผูกให้ทั้งห้องในขั้นตอนเดียว"
        />
      </div>

      <Card className="rounded-3xl print:hidden">
        <CardHeader>
          <CardTitle className="text-base">สร้างพร้อมผูกให้ทั้งห้อง</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            สร้างรหัส QR ใหม่และผูกให้อุปกรณ์ทุกชิ้นในห้องที่ยังไม่มีรหัส (ชิ้นที่ผูกแล้วจะไม่ถูกแตะต้อง) —
            สติกเกอร์ที่พิมพ์ออกมาจะมีชื่อนักเรียนและชื่ออุปกรณ์อยู่แล้ว ไม่ต้องผูกรหัสทีหลัง
          </p>
          <form action={generateAndBindCodesAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="classroomId" value={classroomId} />
            <div className="space-y-1.5">
              <Label htmlFor="subjectId">เฉพาะวิชา (ถ้ามี)</Label>
              <select id="subjectId" name="subjectId" className="h-11 w-48 rounded-xl border bg-background px-3 text-sm">
                <option value="">ทุกวิชาที่ดูแล</option>
                {manageableSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="min-h-11 rounded-xl">
              สร้างและผูกรหัส
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-3xl print:hidden">
        <CardHeader>
          <CardTitle className="text-base">สร้างรหัสเปล่า</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={generateCodesAction} className="flex items-end gap-2">
            <input type="hidden" name="classroomId" value={classroomId} />
            <input type="hidden" name="schoolId" value={classroom.schoolId} />
            <div className="space-y-1.5">
              <Label htmlFor="count">จำนวน</Label>
              <Input id="count" name="count" type="number" min={1} max={200} defaultValue={20} className="h-11 w-24" />
            </div>
            <Button type="submit" variant="outline" className="min-h-11 rounded-xl">
              สร้าง
            </Button>
          </form>
        </CardContent>
      </Card>

      {labels.length > 0 && <StickerSheet labels={labels} />}
    </div>
  );
}
