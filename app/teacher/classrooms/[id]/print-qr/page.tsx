import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PrintButton } from "./print-button";
import { generateCodesAction } from "./actions";

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

  const codeList = codesParam ? codesParam.split(",").filter(Boolean) : [];
  const codeSvgs = await Promise.all(
    codeList.map(async (code) => ({
      code,
      svg: await QRCode.toString(code, { type: "svg", width: 160, margin: 1 }),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <h1 className="font-heading text-xl font-semibold">พิมพ์สติกเกอร์ QR</h1>
        <p className="text-sm text-muted-foreground">
          สร้างรหัส QR เปล่า (ยังไม่ผูกกับใคร) เพื่อพิมพ์เป็นสติกเกอร์ แล้วนำไปติดที่สมุด/หนังสือ จากนั้นค่อยผูกรหัสกับนักเรียนทีหลัง
        </p>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">สร้างรหัสใหม่</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={generateCodesAction} className="flex items-end gap-2">
            <input type="hidden" name="classroomId" value={classroomId} />
            <input type="hidden" name="schoolId" value={classroom.schoolId} />
            <div className="space-y-1.5">
              <Label htmlFor="count">จำนวน</Label>
              <Input id="count" name="count" type="number" min={1} max={200} defaultValue={20} className="w-24" />
            </div>
            <Button type="submit">สร้าง</Button>
          </form>
        </CardContent>
      </Card>

      {codeSvgs.length > 0 && (
        <>
          <div className="print:hidden">
            <PrintButton />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 print:grid-cols-4">
            {codeSvgs.map(({ code, svg }) => (
              <div
                key={code}
                className="flex flex-col items-center gap-1 rounded-md border p-3 print:break-inside-avoid"
              >
                {/* server-generated QR SVG, not user input */}
                <div dangerouslySetInnerHTML={{ __html: svg }} />
                <p className="font-mono text-xs">{code}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
