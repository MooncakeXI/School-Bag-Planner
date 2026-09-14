"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

function formatDeadline(date: string, time: string) {
  if (!date || !time) return "";
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${date}T${time}:00+07:00`));
}

export function DeadlineFields({ defaultDate, defaultTime }: { defaultDate: string; defaultTime: string }) {
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        วันที่กำหนดส่ง
        <Input name="deadlineDate" type="date" required className="h-11" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        เวลากำหนดส่ง
        <Input name="deadlineTime" type="time" required className="h-11" value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      <p className="text-sm font-medium text-muted-foreground sm:col-span-2">
        กำหนดส่ง: {formatDeadline(date, time)}
      </p>
    </div>
  );
}
