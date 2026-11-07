"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState,useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Field } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = { open: "باز", investigating: "در حال بررسی", waiting_customer: "در انتظار مشتری", resolved: "حل‌شده", closed: "بسته" };

export function ComplaintActions({ id, status, resolution }: { id: number; status: string; resolution: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextStatus, setNextStatus] = useState(status);
  const [res, setRes] = useState(resolution ?? "");
  const requestIdentity=useRef<{payload:string;key:string}|null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const payload=JSON.stringify({status:nextStatus,resolution:res.trim()||null,expected_status:status});
      if(requestIdentity.current?.payload!==payload)requestIdentity.current={payload,key:crypto.randomUUID()};
      const r = await fetch(`/api/complaints/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json",'idempotency-key':requestIdentity.current.key },
        body:payload,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if(data.ok!==true)throw new Error('پاسخ رسیدگی معتبر نیست؛ دوباره با همان درخواست تلاش کنید.');
      requestIdentity.current=null;
      toast("شکایت به‌روزرسانی شد");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "به‌روزرسانی ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-secondary btn-sm" onClick={() => setOpen(true)}>رسیدگی</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`رسیدگی به شکایت #${id}`}>
        <div className="space-y-3">
          <Field label="وضعیت">
            <SearchableSelect className="input w-full" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SearchableSelect>
          </Field>
          <Field label="نتیجه رسیدگی / اقدام انجام‌شده">
            <textarea className="input w-full min-h-24" value={res} onChange={(e) => setRes(e.target.value)} placeholder="مثلاً: قطعه تعویض و دستگاه مجدداً تست شد؛ با مشتری هماهنگ شد…" />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submit}>{busy ? "در حال ذخیره…" : "ذخیره"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
