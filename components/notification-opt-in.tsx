"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { subscribeAction } from "@/app/student/tomorrow/actions";
import { requiresHomeScreenForPush } from "@/lib/notification-support";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

// One subscription covers both packing and approaching-homework-deadline
// reminders. The service worker (public/sw.js) displays the common payload.
export function NotificationOptIn() {
  const [status, setStatus] = useState<"idle" | "requesting" | "on" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setError(null);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (
      requiresHomeScreenForPush({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone,
      })
    ) {
      setStatus("error");
      setError("บน iPhone ต้องเปิดเว็บจากหน้าจอโฮมก่อน: เปิดลิงก์นี้ใน Safari แตะ แชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดจากไอคอนและกดอีกครั้ง");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("error");
      setError("อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือน");
      return;
    }

    setStatus("requesting");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("error");
        setError("ยังไม่ได้อนุญาตการแจ้งเตือน กรุณาเปิดสิทธิ์การแจ้งเตือนในการตั้งค่าเครื่องแล้วลองใหม่");
        return;
      }
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setStatus("error");
        setError("ระบบแจ้งเตือนยังตั้งค่าไม่ครบ กรุณาแจ้งครูผู้ดูแล");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setStatus("error");
        setError("อุปกรณ์สร้างการเชื่อมต่อแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      await subscribeAction({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setStatus("on");
    } catch {
      setStatus("error");
      setError("เปิดการแจ้งเตือนไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
    }
  };

  if (status === "on") return null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={enable}
        disabled={status === "requesting"}
        className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground disabled:opacity-60"
      >
        <Bell className="size-4" />
        {status === "requesting" ? "กำลังเปิด..." : "เปิดการแจ้งเตือน"}
      </button>
      {error && (
        <p role="alert" className="rounded-2xl bg-accent px-4 py-3 text-sm leading-relaxed text-accent-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
