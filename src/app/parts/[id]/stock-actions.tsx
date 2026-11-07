"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal } from "@/components/ui";
import { postFinancial } from "@/lib/financial-client";
import { parseMoneyInput, moneyDisplayValue, getCurrencyUnit } from "@/lib/format";

export function PartStockActions({ partId, locations, canAdjust, purchaseCost }: { partId: number; locations: any[]; canAdjust: boolean; purchaseCost: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("purchase");
  const [qty, setQty] = useState(1);
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [unitCost, setUnitCost] = useState(moneyDisplayValue(purchaseCost));

  if (!canAdjust) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await postFinancial(`/api/parts/${partId}/stock`, { type, qty: Number(qty), location_id: locationId ? Number(locationId) : null, note,
        unit_cost: type === "purchase" ? parseMoneyInput(unitCost||'0',undefined,true) : undefined });
      toast("موجودی به‌روزرسانی شد");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const signedTypes = [
    { id: "purchase", label: "دریافت کالا (+)", sign: 1 },
    { id: "adjustment", label: "اصلاح شمارش (مثبت یا منفی)", sign: 0 },
    { id: "damage", label: "آسیب (−)", sign: -1 },
    { id: "loss", label: "کسری (−)", sign: -1 },
    { id: "supplier_return", label: "برگشت به تأمین‌کننده (−)", sign: -1 },
  ];

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>اصلاح موجودی</button>
      <Modal open={open} onClose={() => setOpen(false)} title="اصلاح موجودی">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="mv-type">نوع گردش</label>
            <SearchableSelect id="mv-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {signedTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="mv-qty">تعداد {type === "adjustment" ? "(برای کاهش، منفی وارد کنید)" : ""}</label>
            <input id="mv-qty" type="number" className="input" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          {type === "purchase" && <div><label className="label" htmlFor="mv-cost">بهای واقعی هر واحد ({getCurrencyUnit() === "toman" ? "تومان" : "ریال"})</label>
            <input id="mv-cost" type="number" min="0" step="0.1" className="input" value={unitCost} onChange={event => setUnitCost(event.target.value)} /></div>}
          <div>
            <label className="label" htmlFor="mv-loc">انبار</label>
            <SearchableSelect id="mv-loc" className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">انبار پیش‌فرض</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label" htmlFor="mv-note">دلیل / یادداشت</label>
            <input id="mv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً اصلاح شمارش انبار" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>انصراف</button>
            <button className="btn-primary" onClick={submit} disabled={busy || qty === 0}>{busy ? "در حال ذخیره…" : "اعمال"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
