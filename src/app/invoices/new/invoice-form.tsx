"use client";
import {chargeKindLabel} from '@/lib/charge-category';

import { SearchableSelect } from "@/components/searchable-select";


import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { EmptyState } from "@/components/ui";
import { fmtMoney, toFaDigits } from "@/lib/format";
import { toast } from "sonner";
import type { SourceTotals } from "@/lib/invoice-source";
import { multiplyRial, percentRial, rial, roundRial, sumRial } from "@/lib/money";
import { postFinancial } from "@/lib/financial-client";

type InvoiceType = "purchase" | "sale" | "repair";

type Line = {
  key: string;
  kind: "part" | "service" | "labor" | "fee" | "other";
  ref_id: number | null;
  name: string;
  sku: string | null;
  qty: number;
  unit_price: number;
  discount: number;
  cost: number;
  employee_id: number | null;
  fromCatalog: boolean;
};

type Config = {
  tax_rate: number;
  duty_rate: number;
  round_to: number;
  vat_configured: boolean;
  business_name: string;
  branch_id: number | null;
  can_edit_price: boolean;
  can_pay: boolean;
  can_purchase: boolean;
  can_invoice: boolean;
};

type PartHit = { id: number; name: string; sku: string | null; barcode: string | null; price: number; category: string | null; stock: number; purchase_price?: number };
type TicketHit = { id: number; number: string; first_name: string; last_name: string; brand: string; model: string; status_name: string; tech_name: string | null };

const METHOD_FA: Array<{ key: string; label: string }> = [
  { key: "cash", label: "نقدی" },
  { key: "card", label: "کارتخوان / کارتی" },
  { key: "check", label: "چک" },
];

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as any)?.error ?? "عملیات ناموفق بود — دوباره تلاش کنید.");
  return data as T;
}

/**
 * فرم واحد فاکتور برای سه نوع: خرید / فروش / تعمیر.
 * قیمت‌ها از کاتالوگ («دریافت قیمت از انبار») با تشخیص خودکار نوع قیمت؛
 * محاسبهٔ نمایشی با همان فرمول سرور (fullTotals) و ثبت نهایی سمت سرور اعتبارسنجی می‌شود.
 */
export function InvoiceForm({
  initialType,
  editId,
  initialSaleId,
  initialPoId,
}: {
  initialType: InvoiceType | null;
  editId: number | null;
  initialSaleId: number | null;
  initialPoId: number | null;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [type, setType] = useState<InvoiceType>(initialSaleId != null ? "sale" : initialPoId != null ? "purchase" : initialType ?? "sale");
  const [editMode, setEditMode] = useState<boolean>(editId != null);
  const [sourceRef, setSourceRef] = useState<{ kind: "sale" | "po"; id: number; number: string } | null>(null);
  const [sourceTotals, setSourceTotals] = useState<SourceTotals | null>(null);

  const [customer, setCustomer] = useState<{ id: number; name: string; mobile?: string | null } | null>(null);
  const [supplier, setSupplier] = useState<{ id: number; name: string } | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: number; name: string; role: string }>>([]);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [externalNumber, setExternalNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [endDiscount, setEndDiscount] = useState(0);

  // انتخاب مشتری/تأمین‌کننده
  const [partyQuery, setPartyQuery] = useState("");
  const [partyResults, setPartyResults] = useState<any[] | null>(null);

  // جست‌وجوی کالا
  const [partQuery, setPartQuery] = useState("");
  const [partResults, setPartResults] = useState<PartHit[] | null>(null);
  const [partSearching, setPartSearching] = useState(false);

  // خدمت
  const [services, setServices] = useState<Array<{ id: number; name: string; price: number; cost?: number }>>([]);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");

  // تعمیر: پذیرش
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketResults, setTicketResults] = useState<TicketHit[] | null>(null);
  const [ticket, setTicket] = useState<any | null>(null);
  const [existingInvoice, setExistingInvoice] = useState<any | null>(null);
  const [advances, setAdvances] = useState({ settled: 0, pending: 0 });

  // پرداخت هنگام ثبت
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState("cash");
  const [payAmount, setPayAmount] = useState<string>("");
  const [payRef, setPayRef] = useState("");
  const [cheque, setCheque] = useState({ due_date: "", bank_name: "", sayad_id: "" });

  const [saving, setSaving] = useState<"none" | "draft" | "confirm" | "confirm-print">("none");
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ---- بارگذاری اولیه ----
  useEffect(() => {
    (async () => {
      try {
        const cfg = await jfetch<Config>("/api/invoices/config");
        setConfig(cfg);
        if (type === "purchase" && !cfg.can_purchase) setType(cfg.can_invoice ? "sale" : "repair");
        const users = await jfetch<{ users: any[] }>("/api/users");
        setEmployees((users.users ?? []).map((u) => ({ id: Number(u.id), name: String(u.name), role: String(u.role) })));
      } catch (e: any) {
        setLoadFailed(true);
        setError(e?.message ?? "بارگذاری تنظیمات ناموفق بود.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await jfetch<{ services: any[] }>("/api/services");
        setServices((data.services ?? []).map((s) => ({ id: Number(s.id), name: String(s.name), price: Number(s.price ?? 0), cost: Number(s.cost ?? 0) })));
      } catch {}
    })();
  }, []);

  // حالت ویرایش پیش‌نویس: بارگذاری از جزئیات
  useEffect(() => {
    if (editId == null) return;
    (async () => {
      try {
        const d = await jfetch<any>(`/api/invoices/${editId}`);
        const inv = d.invoice;
        setType((inv.type ?? "repair") as InvoiceType);
        setEditMode(true);
        setDate(inv.date ?? "");
        setDueDate(inv.due_date ?? "");
        setExternalNumber(inv.external_number ?? "");
        setNotes(inv.notes ?? "");
        setEmployeeId(inv.employee_id ?? null);
        if (inv.type === "purchase") setSupplier({ id: inv.supplier_id, name: inv.supplier_name ?? "تأمین‌کننده" });
        else if (inv.customer_id) setCustomer({ id: inv.customer_id, name: inv.company ?? `${inv.first_name ?? ""} ${inv.last_name ?? ""}`.trim(), mobile: inv.mobile });
        if (inv.ticket_id) {
          const prev = await jfetch<any>(`/api/repairs/${inv.ticket_id}/invoice-preview`).catch(() => null);
          if (prev?.ticket) { setTicket(prev.ticket); setAdvances(prev.advances ?? { settled: 0, pending: 0 }); }
        }
        setLines(
          (d.items ?? []).map((i: any) => ({
            key: uid(), kind: i.kind ?? "other", ref_id: i.ref_id ?? null, name: i.name, sku: i.sku ?? null,
            qty: Number(i.qty ?? 1), unit_price: Number(i.unit_price ?? 0), discount: Number(i.line_discount ?? 0),
            cost: Number(i.cost ?? 0), employee_id: i.employee_id ?? null, fromCatalog: i.ref_id != null,
          }))
        );
        const lineDisc = (d.items ?? []).reduce((s: number, i: any) => s + Number(i.line_discount ?? 0), 0);
        setEndDiscount(Math.max(0, Number(inv.discount ?? 0) - lineDisc));
        if (inv.sale_id != null || inv.purchase_order_id != null) {
          setSourceRef({ kind: inv.sale_id != null ? "sale" : "po", id: Number(inv.sale_id ?? inv.purchase_order_id), number: String(inv.sale_number ?? inv.po_number ?? "") });
          setSourceTotals({ gross: Number(inv.subtotal), discount: Number(inv.discount), tax: Number(inv.tax), duty: 0, total: Number(inv.total) });
        }
      } catch (e: any) {
        setError(e?.message ?? "بارگذاری پیش‌نویس ناموفق بود.");
      }
    })();
  }, [editId]);

  // حالت «فاکتور رسمی از سند موجود»: فروش صندوق یا سفارش خرید دریافت‌شده
  useEffect(() => {
    if (editId != null) return;
    if (initialSaleId != null) {
      (async () => {
        try {
          const d = await jfetch<any>(`/api/sales/${initialSaleId}`);
          setSourceRef({ kind: "sale", id: d.sale.id, number: d.sale.number });
          setSourceTotals({ gross: Number(d.sale.subtotal), discount: Number(d.sale.discount), tax: Number(d.sale.tax), duty: 0, total: Number(d.sale.total) });
          if (!d.sale.customer_id) {
            setError("این فروش مشتری ثبت‌شده ندارد — فروش مهمان فاکتور رسمی نمی‌گیرد. ابتدا مشتری را روی فروش ثبت کنید.");
            return;
          }
          setCustomer({ id: d.sale.customer_id, name: d.sale.customer_name, mobile: d.sale.customer_mobile });
          setExistingInvoice(d.existing_invoice);
          if (!d.existing_invoice) {
            setLines(
              (d.items ?? []).map((i: any) => ({
                key: uid(), kind: i.kind ?? "other", ref_id: i.ref_id ?? null, name: i.name, sku: null,
                qty: Number(i.qty ?? 1), unit_price: Number(i.unit_price ?? 0), discount: Number(i.discount ?? 0),
                cost: Number(i.cost ?? 0), employee_id: null, fromCatalog: i.ref_id != null,
              }))
            );
            // آینهٔ سند صندوق: تخفیف کل فروش همان‌طور منتقل می‌شود تا مبلغ فاکتور برابر فروش باشد
            setEndDiscount(Number(d.sale.discount ?? 0));
          }
        } catch (e: any) {
          setError(e?.message ?? "بارگذاری فروش صندوق ناموفق بود.");
        }
      })();
    }
    if (initialPoId != null) {
      (async () => {
        try {
          const d = await jfetch<any>(`/api/purchase-orders/${initialPoId}/preview`);
          setSourceRef({ kind: "po", id: d.po.id, number: d.po.number });
          setSourceTotals(d.source_totals ?? null);
          setEndDiscount(Number(d.po.discount ?? 0));
          if (!d.ready_to_invoice && !d.existing_invoice) {
            setError(`سفارش ${d.po.number} هنوز دریافت نشده — برای اتصال، ابتدا کالا را از انبار دریافت کنید.`);
            return;
          }
          if (d.po.supplier_id) setSupplier({ id: d.po.supplier_id, name: d.po.supplier_name ?? "تأمین‌کننده" });
          setExistingInvoice(d.existing_invoice);
          if (!d.existing_invoice) {
            setLines(
              (d.items ?? []).map((i: any) => ({
                key: uid(), kind: i.kind ?? "other", ref_id: i.ref_id ?? null, name: i.name, sku: null,
                qty: Number(i.qty ?? 1), unit_price: Number(i.unit_price ?? 0), discount: 0,
                cost: Number(i.cost ?? 0), employee_id: null, fromCatalog: i.ref_id != null,
              }))
            );
          }
        } catch (e: any) {
          setError(e?.message ?? "بارگذاری سفارش خرید ناموفق بود.");
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSaleId, initialPoId, editId]);

  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty && saving === "none") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty, saving]);

  // ---- جست‌وجوها ----
  const searchParty = useCallback(async (q: string) => {
    setPartyQuery(q);
    if (!q.trim()) {
      setPartyResults(null);
      return;
    }
    try {
      if (type === "purchase") {
        const d = await jfetch<{ suppliers: any[] }>("/api/suppliers");
        const all = d.suppliers ?? (d as any).items ?? [];
        setPartyResults(all.filter((s: any) => String(s.name ?? "").includes(q.trim())).slice(0, 10));
      } else {
        const d = await jfetch<{ customers: any[] }>(`/api/customers?q=${encodeURIComponent(q.trim())}`);
        setPartyResults(d.customers ?? []);
      }
    } catch {
      setPartyResults([]);
    }
  }, [type]);

  const searchParts = useCallback(async (q: string) => {
    setPartQuery(q);
    if (!q.trim()) {
      setPartResults(null);
      return;
    }
    setPartSearching(true);
    try {
      const d = await jfetch<{ parts: PartHit[] }>(`/api/parts/search?q=${encodeURIComponent(q.trim())}`);
      const rows = d.parts ?? [];
      // بارکد دقیق: اگر اسکن شد، مستقیم اضافه شود
      const exactBarcode = rows.find((r) => r.barcode && r.barcode === q.trim());
      if (exactBarcode) {
        addPartLine(exactBarcode);
        setPartResults(null);
        setPartQuery("");
        return;
      }
      setPartResults(rows);
    } catch {
      setPartResults([]);
    } finally {
      setPartSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, config?.can_edit_price]);

  const searchTickets = useCallback(async (q: string) => {
    setTicketQuery(q);
    if (!q.trim()) {
      setTicketResults(null);
      return;
    }
    try {
      const d = await jfetch<{ tickets: any[] }>(`/api/repairs?q=${encodeURIComponent(q.trim())}&limit=10`);
      setTicketResults(d.tickets ?? []);
    } catch {
      setTicketResults([]);
    }
  }, []);

  // ---- اقلام ----
  function addPartLine(p: PartHit) {
    const price = type === "purchase" ? (p.purchase_price ?? p.price ?? 0) : (p.price ?? 0);
    setLines((prev) => [
      ...prev,
      {
        key: uid(), kind: "part", ref_id: p.id, name: p.name, sku: p.sku ?? p.barcode ?? null,
        qty: 1, unit_price: price, discount: 0, cost: type === "purchase" ? price : 0,
        employee_id: null, fromCatalog: true,
      },
    ]);
    setDirty(true);
    toast.success(`«${p.name}» اضافه شد`);
  }

  const addServiceLine = (s: { id: number; name: string; price: number; cost?: number }) => {
    setLines((prev) => [
      ...prev,
      { key: uid(), kind: "service", ref_id: s.id, name: s.name, sku: null, qty: 1, unit_price: Number(s.price ?? 0), discount: 0, cost: Number(s.cost ?? 0), employee_id: ticket?.tech_id ?? employeeId ?? null, fromCatalog: true },
    ]);
    setServiceOpen(false);
    setServiceQuery("");
    setDirty(true);
  };

  const addManualLine = () => {
    setLines((prev) => [...prev, { key: uid(), kind: "labor", ref_id: null, name: "خدمات تعمیر", sku: null, qty: 1, unit_price: 0, discount: 0, cost: 0, employee_id: ticket?.tech_id ?? employeeId ?? null, fromCatalog: false }]);
    setDirty(true);
  };

  const patchLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setDirty(true);
  };

  /** «دریافت قیمت از انبار» — قیمت مرجع تازه از دیتابیس */
  const fetchCatalogPrice = async (line: Line) => {
    if (line.kind !== "part" || line.ref_id == null) return;
    try {
      const p = await jfetch<{ name: string; sku: string | null; price: number; purchase_price: number }>(`/api/parts/price?id=${line.ref_id}`);
      const price = type === "purchase" ? p.purchase_price : p.price;
      patchLine(line.key, { unit_price: price, name: p.name, sku: p.sku, fromCatalog: true });
      toast.success(`قیمت انبار «${p.name}» اعمال شد`);
    } catch (e: any) {
      toast.error(e?.message ?? "دریافت قیمت ناموفق بود");
    }
  };

  // ---- انتخاب پذیرش (تعمیر) ----
  const pickTicket = async (t: TicketHit) => {
    try {
      const prev = await jfetch<any>(`/api/repairs/${t.id}/invoice-preview`);
      setTicket(prev.ticket);
      setAdvances(prev.advances ?? { settled: 0, pending: 0 });
      setExistingInvoice(prev.existing_invoice);
      setCustomer({ id: prev.ticket.customer_id, name: prev.ticket.customer_name, mobile: prev.ticket.customer_mobile });
      setEmployeeId(prev.ticket.tech_id ?? null);
      if (!prev.existing_invoice) {
        setLines(
          (prev.items ?? []).map((i: any) => ({
            key: uid(), kind: i.kind ?? "other", ref_id: i.ref_id ?? null, name: i.name, sku: null,
            qty: Number(i.qty ?? 1), unit_price: Number(i.unit_price ?? 0), discount: 0, cost: Number(i.cost ?? 0),
            employee_id: i.employee_id ?? null, fromCatalog: i.ref_id != null,
          }))
        );
      }
      setTicketResults(null);
      setTicketQuery("");
      setDirty(true);
    } catch (e: any) {
      toast.error(e?.message ?? "بارگذاری پذیرش ناموفق بود");
    }
  };

  // ---- محاسبهٔ نمایشی (همان فرمول سرور) ----
  const totals = useMemo(() => {
    if (sourceTotals) return { ...sourceTotals, error: "" };
    try {
      const gross = sumRial(lines.map(line => multiplyRial(line.unit_price, line.qty)));
      const lineDisc = sumRial(lines.map(line => Math.min(rial(line.discount || 0), multiplyRial(line.unit_price, line.qty))));
      const discount = Math.min(gross, sumRial([lineDisc, rial(endDiscount)]));
      const after = gross - discount;
      const tax = percentRial(after, config?.tax_rate ?? 0);
      const duty = percentRial(after, config?.duty_rate ?? 0);
      const raw = sumRial([after, tax, duty]);
      const total = roundRial(raw, config?.round_to ?? 0);
      return { gross, discount, tax, duty, total, error: "" };
    } catch { return { gross: 0, discount: 0, tax: 0, duty: 0, total: 0, error: "مبلغ، تعداد یا نرخ مالیات معتبر نیست؛ اقلام و تنظیمات را بررسی کنید." }; }
  }, [lines, endDiscount, config, sourceTotals]);

  const allocated = type === "repair" ? advances.settled + advances.pending : 0;
  const availablePayment = Math.max(0, totals.total - allocated);
  const balance = Math.max(0, availablePayment - (payOpen ? Math.round(Number(String(payAmount).replace(/[^\d]/g, "")) || 0) : 0));

  // ---- ثبت ----
  const buildPayload = (confirm: boolean) => {
    const payments =
      confirm && payOpen && payAmount
        ? [
            {
              amount: Math.round(Number(String(payAmount).replace(/[^\d]/g, "")) || 0),
              method: payMethod,
              reference: payRef || null,
              cheque: payMethod === "check" ? { due_date: cheque.due_date, bank_name: cheque.bank_name || null, sayad_id: cheque.sayad_id || null } : null,
            },
          ]
        : [];
    return {
      type,
      customer_id: type === "purchase" ? undefined : customer?.id,
      supplier_id: type === "purchase" ? supplier?.id : undefined,
      ticket_id: type === "repair" ? ticket?.id : undefined,
      sale_id: sourceRef?.kind === "sale" ? sourceRef.id : undefined,
      purchase_order_id: sourceRef?.kind === "po" ? sourceRef.id : undefined,
      employee_id: employeeId,
      date: date || undefined,
      due_date: dueDate || undefined,
      external_number: externalNumber || undefined,
      notes: notes || undefined,
      items: lines.map((l) => ({
        kind: l.kind, ref_id: l.ref_id, name: l.name, sku: l.sku, qty: l.qty, unit_price: l.unit_price, discount: l.discount, cost: l.cost, employee_id: l.employee_id,
      })),
      end_discount: endDiscount,
      confirm,
      payments,
    };
  };

  const validateLocal = (): string | null => {
    if (type === "purchase" && !supplier) return "تأمین‌کننده را انتخاب کنید.";
    if (type !== "purchase" && !customer) return "مشتری را انتخاب کنید.";
    if (type === "repair" && !ticket) return "پذیرش مرتبط را انتخاب کنید.";
    if (lines.length === 0) return "حداقل یک قلم به فاکتور اضافه کنید.";
    for (const [i, l] of lines.entries()) {
      if (!l.name.trim()) return `شرح ردیف ${i + 1} خالی است.`;
      if (!(l.qty > 0)) return `تعداد ردیف ${i + 1} باید بیشتر از صفر باشد.`;
      if (l.unit_price < 0 || !Number.isFinite(l.unit_price)) return `قیمت ردیف ${i + 1} نامعتبر است.`;
    }
    return null;
  };

  const submit = async (mode: "draft" | "confirm" | "confirm-print") => {
    if (totals.error) { setError(totals.error); toast.error(totals.error); return; }
    const localError = mode === "draft" ? null : validateLocal();
    if (localError) {
      setError(localError);
      toast.error(localError);
      return;
    }
    setError(null);
    setSaving(mode);
    try {
      let invoiceId: number;
      if (editMode && editId != null) {
        await jfetch(`/api/invoices/${editId}/edit`, {
          method: "POST",
          body: JSON.stringify({
            items: lines.map((l) => ({ kind: l.kind, ref_id: l.ref_id, name: l.name, sku: l.sku, qty: l.qty, unit_price: l.unit_price, discount: l.discount, cost: l.cost, employee_id: l.employee_id })),
            end_discount: endDiscount,
            notes: notes || null,
            external_number: externalNumber || null,
            employee_id: employeeId,
            due_date: dueDate || null,
          }),
        });
        invoiceId = editId;
        if (mode !== "draft") {
          const payments =
            payOpen && payAmount
              ? [{ amount: Math.round(Number(String(payAmount).replace(/[^\d]/g, "")) || 0), method: payMethod, reference: payRef || null, cheque: payMethod === "check" ? { due_date: cheque.due_date, bank_name: cheque.bank_name || null, sayad_id: cheque.sayad_id || null } : null }]
              : [];
          await jfetch(`/api/invoices/${editId}/confirm`, { method: "POST", body: JSON.stringify({ payments }) });
        }
      } else {
        const data = await postFinancial<{ id: number; duplicate: boolean }>("/api/invoices", buildPayload(mode !== "draft"));
        invoiceId = data.id;
      }
      setDirty(false);
      const go = `/invoices/${invoiceId}${mode === "confirm-print" ? "?print=1" : ""}`;
      toast.success(mode === "draft" ? "پیش‌نویس ذخیره شد" : "فاکتور ثبت شد");
      router.push(go);
    } catch (e: any) {
      setError(e?.message ?? "ثبت فاکتور ناموفق بود — داده‌های شما حفظ شد.");
      toast.error(e?.message ?? "ثبت فاکتور ناموفق بود");
    } finally {
      setSaving("none");
    }
  };

  if (!config && !loadFailed) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-4 sm:p-6" role="status" aria-label="در حال بارگذاری">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  const typeLabel = type === "purchase" ? "فاکتور خرید" : type === "sale" ? "فاکتور فروش" : "فاکتور تعمیر دستگاه";
  const tabs: Array<{ key: InvoiceType; label: string; allowed: boolean }> = [
    { key: "purchase", label: "خرید", allowed: !!config?.can_purchase },
    { key: "sale", label: "فروش", allowed: !!config?.can_invoice },
    { key: "repair", label: "تعمیر دستگاه", allowed: !!config?.can_invoice },
  ];

  return (
    <div className="mx-auto max-w-5xl p-4 pb-28 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{editMode ? `ویرایش پیش‌نویس فاکتور` : `فاکتور جدید — ${typeLabel}`}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {type === "purchase" && "ثبت خرید از تأمین‌کننده؛ موجودی فقط پس از «ثبت» به انبار اضافه می‌شود."}
            {type === "sale" && "فروش کالا/خدمت؛ موجودی فقط پس از «ثبت» کسر می‌شود."}
            {type === "repair" && "صورتحساب خدمات و قطعات یک پذیرش؛ مصرف انبار قبلاً در پروندهٔ تعمیر ثبت شده است."}
          </p>
        </div>
        {!editMode && (
          <div className="flex gap-1.5" role="tablist" aria-label="نوع فاکتور">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={type === t.key}
                disabled={!t.allowed || sourceRef != null}
                title={t.allowed ? t.label : "دسترسی این نوع فاکتور را ندارید"}
                className={`filter-chip ${type === t.key ? "filter-chip-active" : "filter-chip-idle"} ${!t.allowed ? "opacity-40" : ""}`}
                onClick={() => {
                  if (!t.allowed || dirty) {
                    if (dirty) toast.error("ابتدا فرم فعلی را ثبت یا پاک کنید (تغییرات ذخیره‌نشده دارید).");
                    return;
                  }
                  setType(t.key);
                  setLines([]);
                  setTicket(null);
                  setExistingInvoice(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {sourceRef && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          <Icon name="receipt" size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">
              {sourceRef.kind === "sale" ? `فاکتور رسمی از فروش صندوق ${sourceRef.number}` : `فاکتور خرید برای سفارش ${sourceRef.number}`}
            </div>
            <div className="mt-0.5 text-xs leading-5">
              {sourceRef.kind === "sale"
                ? "اقلام و مشتری از سند فروش آمده‌اند؛ انبار قبلاً از مسیر صندوق کسر شده و مبالغ دریافتی همان فروش به این فاکتور وصل می‌شود (بدون سند مالی تکراری)."
                : "اقلام از سفارش خرید آمده‌اند؛ انبار قبلاً از مسیر «رسید کالا» شارژ شده — ثبت این فاکتور سند مالی است و موجودی را دوباره تغییر نمی‌دهد."}
            </div>
          </div>
        </div>
      )}

      {/* اطلاعات پایه */}
      <section className="card card-pad space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {type === "repair" && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="inv-ticket">پذیرش مرتبط (جست‌وجو با شماره پذیرش، نام مشتری یا مدل)</label>
              {ticket ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-800/40">
                  <span className="font-mono font-bold">{ticket.number}</span>
                  <span>{ticket.customer_name}</span>
                  <span className="text-zinc-500">{ticket.device}{ticket.problem ? ` — ${ticket.problem}` : ""}</span>
                  <span className="badge-blue">{ticket.status_name}</span>
                  {ticket.tech_name && <span className="chip">تعمیرکار: {ticket.tech_name}</span>}
                  {!editMode && (
                    <button className="btn-ghost btn-sm mr-auto" onClick={() => { setTicket(null); setLines([]); setDirty(true); }}>
                      تغییر پذیرش
                    </button>
                  )}
                </div>
              ) : (
                <span className="relative block">
                  <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input id="inv-ticket" className="input !pr-8" value={ticketQuery} onChange={(e) => void searchTickets(e.target.value)} placeholder="مثلاً R0001 یا نام مشتری…" />
                </span>
              )}
              {ticketResults && ticketResults.length > 0 && !ticket && (
                <div className="menu-panel mt-1 w-full">
                  {ticketResults.map((t) => (
                    <button key={t.id} className="menu-item w-full !justify-start" onClick={() => void pickTicket(t)}>
                      <span className="font-mono">{t.number}</span>
                      <span className="truncate">{t.first_name} {t.last_name} · {t.brand} {t.model}</span>
                      <span className="mr-auto badge-gray !text-[10px]">{t.status_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {ticketResults && ticketResults.length === 0 && <p className="mt-1 text-xs text-zinc-400">پذیرشی با این مشخصات پیدا نشد.</p>}
              {existingInvoice && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  برای این پذیرش فاکتور <Link className="font-mono underline" href={`/invoices/${existingInvoice.id}`}>{existingInvoice.number}</Link> قبلاً ثبت شده — فاکتور دوباره ساخته نمی‌شود.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="label">{type === "purchase" ? "تأمین‌کننده" : "مشتری"}</label>
            {((type === "purchase" && supplier) || (type !== "purchase" && customer)) ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/40">
                <Icon name="user" size={15} className="text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{type === "purchase" ? supplier!.name : customer!.name}</span>
                {customer?.mobile && <span className="text-xs text-zinc-400 ltr-num" dir="ltr">{customer.mobile}</span>}
                {sourceRef ? (
                  <span className="badge-gray !text-[10px]">{sourceRef.kind === "sale" ? "از فروش صندوق" : "از سفارش خرید"}</span>
                ) : (
                  <button className="btn-ghost btn-sm" onClick={() => (type === "purchase" ? setSupplier(null) : setCustomer(null))} aria-label="تغییر طرف حساب">
                    تغییر
                  </button>
                )}
              </div>
            ) : (
              <span className="relative block">
                <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input className="input !pr-8" value={partyQuery} onChange={(e) => void searchParty(e.target.value)} placeholder={type === "purchase" ? "جست‌وجوی نام تأمین‌کننده…" : "جست‌وجوی نام یا موبایل مشتری…"} aria-label="جست‌وجوی طرف حساب" />
              </span>
            )}
            {partyResults && partyResults.length > 0 && !((type === "purchase" && supplier) || (type !== "purchase" && customer)) && (
              <div className="menu-panel mt-1 w-full">
                {partyResults.map((p: any) => (
                  <button
                    key={p.id}
                    className="menu-item w-full !justify-start"
                    onClick={() => {
                      if (type === "purchase") setSupplier({ id: Number(p.id), name: String(p.name) });
                      else setCustomer({ id: Number(p.id), name: p.company ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), mobile: p.mobile });
                      setPartyResults(null);
                      setPartyQuery("");
                      setDirty(true);
                    }}
                  >
                    <span className="truncate">{p.company ?? (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.name)}</span>                    {p.mobile && <span className="text-xs text-zinc-400 ltr-num" dir="ltr">{p.mobile}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="inv-date">تاریخ فاکتور</label>
              <JalaliDatePicker id="inv-date" value={date} onChange={(v) => { setDate(v); setDirty(true); }} />
            </div>
            <div>
              <label className="label" htmlFor="inv-due">موعد تسویه (اختیاری)</label>
              <JalaliDatePicker id="inv-due" value={dueDate} onChange={(v) => { setDueDate(v); setDirty(true); }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="inv-emp">{type === "purchase" ? "مسئول خرید" : "تعمیرکار/فروشنده مسئول"}</label>
              <SearchableSelect id="inv-emp" className="input" value={employeeId ?? ""} onChange={(e) => { setEmployeeId(e.target.value ? Number(e.target.value) : null); setDirty(true); }}>
                <option value="">— انتخاب کنید —</option>
                {employees.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </SearchableSelect>
            </div>
            {type === "purchase" && (
              <div>
                <label className="label" htmlFor="inv-ext">شماره فاکتور تأمین‌کننده (اختیاری)</label>
                <input id="inv-ext" className="input ltr-num" dir="ltr" value={externalNumber} onChange={(e) => { setExternalNumber(e.target.value); setDirty(true); }} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* اقلام */}
      <section className="card card-pad mt-4">
        {sourceRef && <p className="mb-3 text-sm text-zinc-500">مبلغ و اقلام سند مبدأ ثابت‌اند؛ اصلاح مالی باید از مسیر اصلاح همان سند انجام شود.</p>}
        <fieldset disabled={sourceRef != null} className="m-0 min-w-0 border-0 p-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">اقلام {typeLabel}</h2>
          <div className="relative min-w-52 flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              className="input !pr-8"
              value={partQuery}
              onChange={(e) => void searchParts(e.target.value)}
              placeholder="اسکن بارکد یا جست‌وجوی نام/کد کالا و Enter…"
              aria-label="جست‌وجوی کالا"
            />
            {partResults && partResults.length > 0 && (
              <div className="menu-panel top-11 z-40 max-h-72 w-full overflow-y-auto" role="listbox" aria-label="نتایج کالا">
                {partResults.map((p) => (
                  <button key={p.id} className="menu-item w-full !justify-start" onClick={() => { addPartLine(p); setPartResults(null); setPartQuery(""); }}>
                    <span className="min-w-0 flex-1 truncate text-right">
                      {p.name}
                      {p.sku && <span className="ml-1 text-[10px] text-zinc-400 ltr-num" dir="ltr">{p.sku}</span>}
                    </span>
                    <span className={`text-[11px] ${p.stock <= 0 ? "text-red-500" : p.stock < 3 ? "text-amber-600" : "text-zinc-400"}`}>موجودی {toFaDigits(p.stock)}</span>
                    <span className="text-[11px] text-zinc-500">
                      {type === "purchase" ? `خرید ${fmtMoney(p.purchase_price ?? p.price)}` : fmtMoney(p.price)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {partSearching && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">…</span>}
          </div>
          <button className="btn-secondary btn-sm" onClick={() => setServiceOpen((v) => !v)}>
            <Icon name="plus" size={13} />
            افزودن خدمات تعمیر
          </button>
        </div>

        {serviceOpen && (
          <div className="mt-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
            <button className="btn-secondary btn-sm mb-2" onClick={()=>{addManualLine();setServiceOpen(false);}}>ثبت دستی خدمات تعمیر</button>
            <input className="input !py-1.5 text-[13px]" autoFocus value={serviceQuery} onChange={(e) => setServiceQuery(e.target.value)} placeholder="جست‌وجوی خدمت از تعرفه…" aria-label="جست‌وجوی خدمت" />
            <div className="mt-1.5 max-h-44 overflow-y-auto">
              {services
                .filter((s) => !serviceQuery.trim() || s.name.includes(serviceQuery.trim()))
                .slice(0, 30)
                .map((s) => (
                  <button key={s.id} className="menu-item w-full !justify-start" onClick={() => addServiceLine(s)}>
                    <span className="min-w-0 flex-1 truncate text-right">{s.name}</span>
                    <span className="text-[11px] text-zinc-500">{fmtMoney(s.price)}</span>
                  </button>
                ))}
              {services.length === 0 && <p className="p-2 text-xs text-zinc-400">تعرفه‌ای ثبت نشده — از «افزودن دستی» استفاده کنید.</p>}
            </div>
          </div>
        )}

        {lines.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon="cart" title="فاکتور خالی است" body="با جست‌وجو/اسکن بارکد کالا اضافه کنید یا خدمات تعمیر بیفزایید." />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="th text-right">شرح</th>
                  <th className="th w-24">تعداد</th>
                  <th className="th w-36">قیمت واحد</th>
                  <th className="th w-28">تخفیف</th>
                  <th className="th w-32">جمع</th>
                  <th className="th w-24"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.key} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="td">
                      <input
                        className="input !py-1 text-[13px]"
                        value={l.name}
                        onChange={(e) => patchLine(l.key, { name: e.target.value })}
                        aria-label={`شرح ردیف ${idx + 1}`}
                        dir="auto"
                      />
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="badge-gray !text-[9px]">{chargeKindLabel(l.kind,type)}</span>
                        {l.sku && <span className="text-[10px] text-zinc-400 ltr-num" dir="ltr">{l.sku}</span>}
                        {l.employee_id != null && employees.find((e) => e.id === l.employee_id) && (
                          <span className="text-[10px] text-zinc-400">{employees.find((e) => e.id === l.employee_id)!.name.split(" ")[0]}</span>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <input
                        type="number"
                        min={0.01}
                        step="any"
                        className="input ltr-num !py-1 text-center text-[13px]"
                        dir="ltr"
                        value={l.qty}
                        onChange={(e) => patchLine(l.key, { qty: Math.max(0, Number(e.target.value)) })}
                        aria-label={`تعداد ردیف ${idx + 1}`}
                      />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="input ltr-num !py-1 text-center text-[13px]"
                          dir="ltr"
                          value={l.unit_price}
                          disabled={!config?.can_edit_price && l.fromCatalog}
                          title={!config?.can_edit_price && l.fromCatalog ? "تغییر قیمت نیازمند دسترسی «ویرایش فاکتور» است" : undefined}
                          onChange={(e) => patchLine(l.key, { unit_price: Math.max(0, Math.round(Number(String(e.target.value).replace(/[^\d]/g, "")) || 0)) })}
                          aria-label={`قیمت ردیف ${idx + 1}`}
                        />
                        {l.kind === "part" && (
                          <button className="btn-ghost btn-sm btn-icon shrink-0" title="دریافت قیمت از انبار" aria-label="دریافت قیمت از انبار" onClick={() => void fetchCatalogPrice(l)}>
                            <Icon name="refresh" size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input ltr-num !py-1 text-center text-[13px]"
                        dir="ltr"
                        value={l.discount}
                        disabled={!config?.can_edit_price}
                        onChange={(e) => patchLine(l.key, { discount: Math.min(Math.round(Number(String(e.target.value).replace(/[^\d]/g, "")) || 0), Math.round(l.qty * l.unit_price)) })}
                        aria-label={`تخفیف ردیف ${idx + 1}`}
                      />
                    </td>
                    <td className="td font-medium">{fmtMoney(Math.round(l.qty * l.unit_price) - Math.min(l.discount || 0, Math.round(l.qty * l.unit_price)))}</td>
                    <td className="td">
                      <button className="btn-ghost btn-sm btn-icon text-red-500" onClick={() => removeLine(l.key)} aria-label={`حذف ردیف ${idx + 1}`}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        </fieldset>
        {/* جمع‌بندی */}
        {totals.error && <p role="alert" className="mt-3 text-sm text-red-600">{totals.error}</p>}
        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm flex-1 space-y-2">
            <div>
              <label className="label" htmlFor="inv-disc">تخفیف کل فاکتور</label>
              <input
                id="inv-disc"
                type="text"
                inputMode="numeric"
                className="input ltr-num w-40"
                dir="ltr"
                value={endDiscount}
                disabled={sourceRef != null || !config?.can_edit_price}
                onChange={(e) => { setEndDiscount(Math.round(Number(String(e.target.value).replace(/[^\d]/g, "")) || 0)); setDirty(true); }}
              />
              {!config?.can_edit_price && <span className="mt-1 block text-xs text-zinc-400">اعمال تخفیف نیازمند دسترسی «ویرایش فاکتور» است.</span>}
            </div>
            <div>
              <label className="label" htmlFor="inv-notes">توضیحات</label>
              <textarea id="inv-notes" className="input" rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
            </div>
            {!config?.vat_configured && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <Icon name="alert" size={13} />
                نرخ ارزش افزوده در تنظیمات ثبت نشده — فاکتور بدون مالیات محاسبه می‌شود.
              </p>
            )}
          </div>
          <div className="w-full max-w-72 space-y-1 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/40">
            <div className="flex justify-between"><span className="text-zinc-500">جمع اقلام</span><span>{fmtMoney(totals.gross)}</span></div>
            {totals.discount > 0 && <div className="flex justify-between"><span className="text-zinc-500">تخفیف</span><span>−{fmtMoney(totals.discount)}</span></div>}
            {totals.tax > 0 && <div className="flex justify-between"><span className="text-zinc-500">{sourceRef ? "مالیات سند مبدأ" : `ارزش افزوده (${toFaDigits(config?.tax_rate ?? 0)}٪)`}</span><span>{fmtMoney(totals.tax)}</span></div>}
            {totals.duty > 0 && <div className="flex justify-between"><span className="text-zinc-500">عوارض</span><span>{fmtMoney(totals.duty)}</span></div>}
            <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold dark:border-zinc-700"><span>مبلغ قابل پرداخت</span><span>{fmtMoney(totals.total)}</span></div>
          </div>
        </div>
      </section>

      {/* پرداخت همراه ثبت */}
      {config?.can_pay && (
        <section className="card card-pad mt-4">
          {type === "repair" && allocated > 0 && <p className="mb-2 text-sm text-zinc-500">پیش‌دریافت قابل تخصیص: {fmtMoney(advances.settled)}؛ چک در انتظار وصول: {fmtMoney(advances.pending)}. دریافت جدید حداکثر {fmtMoney(availablePayment)} است.</p>}
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={payOpen} onChange={(e) => { setPayOpen(e.target.checked); if (e.target.checked && !payAmount) setPayAmount(String(availablePayment)); }} />
            ثبت پرداخت همراه با ثبت فاکتور (اختیاری)
          </label>
          {payOpen && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label" htmlFor="pay-method">روش پرداخت</label>
                <SearchableSelect id="pay-method" className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  {METHOD_FA.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </SearchableSelect>
              </div>
              <div>
                <label className="label" htmlFor="pay-amount">مبلغ ({type === "purchase" ? "پرداختی" : "دریافتی"})</label>
                <input
                  id="pay-amount"
                  className="input ltr-num"
                  dir="ltr"
                  inputMode="numeric"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ""))}
                />
                <span className="mt-0.5 block text-xs text-zinc-400">مانده پس از این پرداخت: {fmtMoney(balance)}</span>
              </div>
              <div>
                <label className="label" htmlFor="pay-ref">{payMethod === "check" ? "شماره چک" : "شماره پیگیری/مرجع (اختیاری)"}</label>
                <input id="pay-ref" className="input ltr-num" dir="ltr" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
              </div>
              {payMethod === "check" && (
                <>
                  <div>
                    <label className="label" htmlFor="chk-due">سررسید چک</label>
                    <JalaliDatePicker id="chk-due" value={cheque.due_date} onChange={(v) => setCheque((c) => ({ ...c, due_date: v }))} />
                  </div>
                  <div>
                    <label className="label" htmlFor="chk-bank">بانک</label>
                    <input id="chk-bank" className="input" value={cheque.bank_name} onChange={(e) => setCheque((c) => ({ ...c, bank_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label" htmlFor="chk-sayad">شناسه صیادی (اختیاری)</label>
                    <input id="chk-sayad" className="input ltr-num" dir="ltr" value={cheque.sayad_id} onChange={(e) => setCheque((c) => ({ ...c, sayad_id: e.target.value.replace(/[^\d]/g, "") }))} />
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* نوار اقدام */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur lg:pr-[260px] dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">
            {lines.length > 0 ? `${toFaDigits(lines.length)} قلم · مبلغ ${fmtMoney(totals.total)}` : "فاکتور خالی"}
          </span>
          <span className="flex-1" />
          <button className="btn-secondary" disabled={saving !== "none" || lines.length === 0} onClick={() => void submit("draft")}>
            {saving === "draft" ? "در حال ذخیره…" : editMode ? "ذخیره ویرایش پیش‌نویس" : "ذخیره پیش‌نویس"}
          </button>
          <button className="btn-secondary" disabled={saving !== "none"} onClick={() => void submit("confirm")}>
            {saving === "confirm" ? "در حال ثبت…" : "ثبت بدون چاپ"}
          </button>
          <button className="btn-primary" disabled={saving !== "none"} onClick={() => void submit("confirm-print")}>
            <Icon name="receipt" size={15} />
            {saving === "confirm-print" ? "در حال ثبت…" : "ثبت"}
          </button>
        </div>
      </div>
    </div>
  );
}
