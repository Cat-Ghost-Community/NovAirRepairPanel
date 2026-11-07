"use client";

import {appointmentRequest} from "./appointment-request";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Field } from "@/components/ui";

export function AppointmentActions({ id, status, preferredAt, notes, version }: { id: number; status: string; preferredAt: string; notes: string | null; version?:number }) {
  const inFlight=useRef(false);
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(preferredAt?.slice(0, 16) ?? "");
  const [noteText, setNoteText] = useState(notes ?? "");

  const patch = async (body: Record<string, unknown>, key: string, okMsg: string) => {
    if(inFlight.current)return;inFlight.current=true;
    setBusy(key);
    try {
      await appointmentRequest(`/api/appointments/${id}`,'PATCH',{...body,...(version==null?{}:{expected_version:version})});
      toast(okMsg);
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "عملیات ناموفق بود", "error");
    } finally {
      inFlight.current=false;setBusy(null);
    }
  };

  const active = status === "requested" || status === "confirmed";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "requested" && (
        <button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => patch({ status: "confirmed" }, "confirm", "نوبت تأیید شد")}>
          تأیید نوبت
        </button>
      )}
      {active && (
        <>
          <button className="btn-secondary btn-sm" onClick={() => setOpen(true)}>زمان‌بندی مجدد</button>
          <button
            className="btn-secondary btn-sm text-red-600"
            disabled={busy !== null}
            onClick={() => patch({ status: "cancelled" }, "cancel", "نوبت لغو شد")}
          >
            لغو
          </button>
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`زمان‌بندی مجدد نوبت #${id}`}>
        <div className="space-y-3">
          <Field label="تاریخ و ساعت جدید">
            <input type="datetime-local" className="input w-full" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <textarea className="input w-full min-h-20" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button
              className="btn-primary btn-sm"
              disabled={busy !== null || !when}
              onClick={() => patch({ preferred_at: when, notes: noteText }, "reschedule", "نوبت مجدداً زمان‌بندی شد")}
            >
              {busy === "reschedule" ? "در حال ذخیره…" : "ذخیره"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
