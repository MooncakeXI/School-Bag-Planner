"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { cn } from "@/lib/utils";

// Longest edge a captured frame is downscaled to before encoding — see the
// comment in captureFrame below.
const MAX_CAPTURE_EDGE_PX = 640;

/**
 * Reusable camera + continuous QR decode loop, extracted from ScanView so
 * the teacher-side "scan to bind" / "rapid bind" flows
 * (app/teacher/classrooms/[id]) can reuse the exact same camera/decoder
 * plumbing instead of a second, divergent implementation. Owns only the
 * video feed and decode loop; all UI chrome around it (overlay text,
 * success/error banners, item lists) stays with the caller since ScanView's
 * and the teacher's needs differ.
 *
 * A decoded string is only ever a client-reported CLAIM — every caller must
 * still send it to a server action that re-verifies it from scratch
 * (CLAUDE.md/ARCHITECTURE.md: "the resolved code is still sent to the
 * server to record the check — never trust a client-reported result as-is").
 * This component does not, and must not, decide anything on its own — it
 * only reports what the camera saw.
 */
export function QRScanner({
  onDecode,
  overlayText,
  paused = false,
  className,
  children,
}: {
  /** `captureFrame` is a lazy capture of the current video frame as a JPEG
   * data URL (or undefined if the video isn't ready yet) — callers that
   * don't need a frame (e.g. the teacher bind flows) can just ignore it. */
  onDecode: (code: string, captureFrame: () => string | undefined) => void;
  overlayText?: string;
  /** Stops the decode loop without unmounting the camera (e.g. while a bind
   * request for the previous scan is still in flight). */
  paused?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const [cameraError, setCameraError] = useState(false);

  const captureFrame = (): string | undefined => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return undefined;
    // Downscaled here, not just JPEG-compressed: a raw phone-camera frame
    // (often 1920x1080+) can exceed Next.js Server Actions' 1MB default
    // body limit even at quality 0.7, and a uniform 640px-long-edge size is
    // also just a better shape for the eventual CV training set (§8.6) —
    // consistent input dimensions, not whatever resolution each device's
    // camera happens to report.
    const scale = Math.min(1, MAX_CAPTURE_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  };

  useEffect(() => {
    if (paused) return;
    const reader = new BrowserQRCodeReader();
    let cancelled = false;
    let controls: { stop: () => void } | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (cancelled || !result) return;
        onDecodeRef.current(result.getText(), captureFrame);
      })
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch(() => setCameraError(true));

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [paused]);

  return (
    <div className={cn("relative aspect-[4/3] w-full overflow-hidden bg-[#221C18]", className)}>
      <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
      <canvas ref={canvasRef} hidden />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="size-56 rounded-2xl border-4 border-white/80" />
      </div>
      {overlayText && (
        <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-white/75">{overlayText}</p>
      )}
      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-white">
          เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้องแล้วลองใหม่
        </div>
      )}
      {children}
    </div>
  );
}
