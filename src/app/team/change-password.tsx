"use client";

import { useState } from "react";
import { useToast, Modal } from "@/components/ui";

/** تغییر رمز عبور توسط خود کاربر — از منوی کاربر در هدر */
export function ChangePasswordModal({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm2, setConfirm2] = useState("");

  const submit = async () => {
    if (busy) return;
    if (next.length < 12 || next.length > 1024) { toast("گذرواژه جدید باید بین ۱۲ تا ۱۰۲۴ نویسه باشد.", "error"); return; }
    if (next !== confirm2) { toast("تکرار گذرواژه مطابقت ندارد.", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "خطا در تغییر گذرواژه");
      toast("گذرواژه با موفقیت تغییر کرد");
      setOpen(false);
      setCurrent(""); setNext(""); setConfirm2("");
      onDone?.();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="nav-item w-full text-right" onClick={() => setOpen(true)}>تغییر گذرواژه</button>
      <Modal open={open} onClose={() => setOpen(false)} title="تغییر گذرواژه">
        <div className="space-y-3">
          <div>
            <label htmlFor="self-current-password" className="label">گذرواژه فعلی *</label>
            <input id="self-current-password" className="input" dir="ltr" type="password" maxLength={1024} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label htmlFor="self-new-password" className="label">گذرواژه جدید * (حداقل ۱۲ نویسه)</label>
            <input id="self-new-password" className="input" dir="ltr" type="password" minLength={12} maxLength={1024} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label htmlFor="self-repeat-password" className="label">تکرار گذرواژه جدید *</label>
            <input id="self-repeat-password" className="input" dir="ltr" type="password" maxLength={1024} value={confirm2} onChange={(e) => setConfirm2(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy || !current || !next} onClick={submit}>تغییر گذرواژه</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
