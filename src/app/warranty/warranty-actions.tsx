"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Field } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

type Customer = { id: number; first_name: string; last_name: string };
type Ticket = { id: number; number: string; customer_id: number };
type WarrantyRow = { id: number; ticket_number: string | null; customer: string; kind: string; end_date: string };

const KIND_FA: Record<string, string> = { repair: "گارانتی تعمیر", part: "گارانتی قطعه", sale: "گارانتی فروش" };

export function NewWarrantyButton({ customers, tickets }: { customers: Customer[]; tickets: Ticket[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("repair");
  const [customerId, setCustomerId] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [days, setDays] = useState("90");
  const [terms, setTerms] = useState("گارانتی تعمیر مطابق شرایط استاندارد شرکت");

  const submit = async () => {
    if (!customerId) { toast("انتخاب مشتری الزامی است.", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/warranties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind, customer_id: Number(customerId),
          ticket_id: ticketId ? Number(ticketId) : null,
          days: Number(days) || 90, terms,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("گارانتی صادر شد");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "صدور گارانتی ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ صدور گارانتی دستی</button>
      <Modal open={open} onClose={() => setOpen(false)} title="صدور گارانتی">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="نوع گارانتی">
              <SearchableSelect className="input w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SearchableSelect>
            </Field>
            <Field label="مدت (روز)">
              <input type="number" className="input w-full" value={days} min={1} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </div>
          <Field label="مشتری *">
            <SearchableSelect className="input w-full" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setTicketId(""); }}>
              <option value="">— انتخاب مشتری —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </SearchableSelect>
          </Field>
          <Field label="پذیرش مرتبط (اختیاری)">
            <SearchableSelect className="input w-full" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
              <option value="">— بدون پذیرش —</option>
              {(customerId ? tickets.filter((t) => t.customer_id === Number(customerId)) : tickets).map((t) => (
                <option key={t.id} value={t.id}>{t.number}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="شرایط گارانتی">
            <textarea className="input w-full min-h-20" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submit}>{busy ? "در حال ثبت…" : "صدور گارانتی"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function ClaimButton({ warranties }: { warranties: WarrantyRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warrantyId, setWarrantyId] = useState("");
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState("0");

  const submit = async () => {
    if (!warrantyId || !reason.trim()) { toast("انتخاب گارانتی و نوشتن دلیل الزامی است.", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/warranties/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ warranty_id: Number(warrantyId), reason: reason.trim(), cost: Number(cost) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("درخواست گارانتی ثبت شد");
      setOpen(false);
      setWarrantyId(""); setReason(""); setCost("0");
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "ثبت درخواست ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-secondary btn-sm" onClick={() => setOpen(true)}>+ ثبت درخواست گارانتی</button>
      <Modal open={open} onClose={() => setOpen(false)} title="ثبت درخواست گارانتی">
        <div className="space-y-3">
          <Field label="گارانتی *">
            <SearchableSelect className="input w-full" value={warrantyId} onChange={(e) => setWarrantyId(e.target.value)}>
              <option value="">— انتخاب گارانتی فعال —</option>
              {warranties.map((w) => (
                <option key={w.id} value={w.id}>
                  #{toFaDigits(String(w.id))} · {KIND_FA[w.kind] ?? w.kind} · {w.customer}{w.ticket_number ? ` · ${w.ticket_number}` : ""}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="دلیل درخواست *">
            <textarea className="input w-full min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: همان ایراد قبلی بعد از یک هفته برگشت…" />
          </Field>
          <Field label="هزینه برآوردی (تومان)" hint="اگر ایراد مشمول گارانتی نباشد، این مبلغ از مشتری گرفته می‌شود.">
            <input type="number" className="input w-full" value={cost} min={0} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submit}>{busy ? "در حال ثبت…" : "ثبت درخواست"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

const CLAIM_STATUS: Record<string, { label: string; badge: string }> = {
  open: { label: "باز", badge: "badge-amber" },
  investigating: { label: "در حال بررسی", badge: "badge-blue" },
  resolved: { label: "تأیید و انجام شد", badge: "badge-green" },
  rejected: { label: "رد شد", badge: "badge-red" },
};

export function ClaimActions({ claimId, status }: { claimId: number; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextStatus, setNextStatus] = useState(status === "open" ? "investigating" : status);
  const [resolution, setResolution] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/warranties/claims", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim_id: claimId, status: nextStatus, resolution }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("درخواست گارانتی به‌روزرسانی شد");
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
      <Modal open={open} onClose={() => setOpen(false)} title={`رسیدگی به درخواست #${claimId}`}>
        <div className="space-y-3">
          <Field label="وضعیت">
            <SearchableSelect className="input w-full" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
              {Object.entries(CLAIM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </SearchableSelect>
          </Field>
          <Field label="نتیجه رسیدگی">
            <textarea className="input w-full min-h-20" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="مثلاً: قطعه تعویض رایگان شد؛ هزینه با شرکت گارانتی تسویه گردید." />
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
