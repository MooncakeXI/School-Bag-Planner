"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createExceptionAction } from "./actions";

type ExceptionKind = "HOLIDAY" | "CANCELLED_PERIOD" | "PERIOD_SWAP" | "EXAM";

function formatThaiDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export function ExceptionForm({
  schoolId,
  classroomId,
  subjects,
}: {
  schoolId: string;
  classroomId: string;
  subjects: { id: string; name: string }[];
}) {
  const [kind, setKind] = useState<ExceptionKind>("HOLIDAY");
  const [date, setDate] = useState("");
  const needsPeriod = kind !== "HOLIDAY";
  const needsSubject = kind === "PERIOD_SWAP" || kind === "EXAM";

  return (
    <form action={createExceptionAction} className="flex flex-col gap-4">
      <input type="hidden" name="schoolId" value={schoolId} />
      <input type="hidden" name="classroomId" value={classroomId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="exception-date">วันที่</Label>
          <Input id="exception-date" type="date" name="date" className="h-11" required value={date} onChange={(event) => setDate(event.target.value)} />
          {date && <p className="text-sm font-medium text-muted-foreground">{formatThaiDate(date)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exception-kind">ประเภท</Label>
          <select
            id="exception-kind"
            name="kind"
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as ExceptionKind)}
          >
            <option value="HOLIDAY">วันหยุด (ทั้งวัน)</option>
            <option value="CANCELLED_PERIOD">งดคาบเรียน</option>
            <option value="PERIOD_SWAP">สลับคาบ (เปลี่ยนวิชา)</option>
            <option value="EXAM">วันสอบ</option>
          </select>
        </div>

        {needsPeriod && (
          <div className="space-y-1.5">
            <Label htmlFor="exception-period">คาบที่</Label>
            <Input id="exception-period" type="number" name="period" min={1} max={8} className="h-11" required />
          </div>
        )}

        {needsSubject && (
          <div className="space-y-1.5">
            <Label htmlFor="exception-subject">{kind === "EXAM" ? "วิชาที่สอบ" : "วิชาที่เปลี่ยนเป็น"}</Label>
            <select id="exception-subject" name="subjectId" className="h-11 w-full rounded-xl border bg-background px-3 text-sm" required>
              <option value="">เลือกวิชา</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="exception-note">หมายเหตุ</Label>
        <Input id="exception-note" type="text" name="note" className="h-11" placeholder="ไม่บังคับ" />
      </div>
      <Button type="submit" className="min-h-11 self-start rounded-xl">
        บันทึกรายการ
      </Button>
    </form>
  );
}
