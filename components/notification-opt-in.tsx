"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { subscribeAction } from "@/app/student/tomorrow/actions";

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

  const enable = async () => {
    setStatus("requesting");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("error");
        return;
      }
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setStatus("error");
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
        return;
      }
      await subscribeAction({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setStatus("on");
    } catch {
      setStatus("error");
    }
  };

  if (status === "on") return null;

  return (
    <button
      type="button"
      onClick={enable}
      disabled={status === "requesting"}
      className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground disabled:opacity-60"
    >
      <Bell className="size-4" />
      {status === "error" ? "เปิดการแจ้งเตือนไม่สำเร็จ ลองใหม่" : "เปิดการแจ้งเตือน"}
    </button>
  );
}
