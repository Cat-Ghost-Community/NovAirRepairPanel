"use client";

import { useEffect, useRef, useState } from "react";

/**
 * گرفتن عکس با وبکم/دوربین دستگاه — استفاده هنگام پذیرش برای مستندسازی وضعیت دستگاه.
 * خروجی: blob عکس برای آپلود به attachment.
 */
export function CameraCapture({ onCapture, label = "عکس گرفتن با دوربین" }: { onCapture: (blob: Blob) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setReady(true);
        }
      })
      .catch(() => setError("دسترسی به دوربین ممکن نشد — بررسی کنید مرورگر اجازه دوربین داده باشد."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob);
      stop();
    }, "image/jpeg", 0.85);
  };

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => { setError(null); setOpen(true); }}>
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="دوربین">
          <div className="card card-pad w-full max-w-md">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">گرفتن عکس دستگاه</h3>
              <button className="text-zinc-400 hover:text-zinc-600" onClick={stop} aria-label="بستن"></button>
            </div>
            {error ? (
              <p className="text-sm text-red-500">{error}</p>
            ) : (
              <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-secondary btn-sm" onClick={stop}>انصراف</button>
              <button className="btn-primary btn-sm" disabled={!ready} onClick={shoot}>عکس بگیر</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
