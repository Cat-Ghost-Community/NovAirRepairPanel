import type { DatabaseSync } from "node:sqlite";
import type { RawLine } from "@/lib/invoice";
import { HttpError } from "@/lib/api";
import { multiplyRial, rial, sumRial } from "@/lib/money";

export type SourceTotals = { gross: number; discount: number; tax: number; duty: number; total: number };
type PurchaseSource = { id: number; status: string; items_total: number; discount: number; tax: number; shipping: number; total: number };

/** A referenced operational document is one obligation, not permission to
 * create a second differently priced obligation. Metadata may be edited;
 * financial line changes require an explicit correction workflow. */
export function validateSourceLines(submitted: RawLine[] | undefined, source: RawLine[]) {
  if (!submitted?.length) return;
  if (submitted.length !== source.length || submitted.some((line, index) => {
    const original = source[index];
    return line.kind !== original.kind || Number(line.ref_id ?? 0) !== Number(original.ref_id ?? 0)
      || Number(line.qty ?? 1) !== Number(original.qty ?? 1) || Number(line.unit_price ?? 0) !== Number(original.unit_price ?? 0)
      || Number(line.discount ?? 0) !== Number(original.discount ?? 0);
  })) throw new HttpError(409, "اقلام مالی باید با سند مبدأ یکسان باشند؛ تغییر مبلغ نیازمند فرایند اصلاح سند است.");
}

export function purchaseInvoiceSource(db: DatabaseSync, po: PurchaseSource): { items: RawLine[]; totals: SourceTotals } {
  const rows = db.prepare("SELECT part_id,name,qty,received_qty,unit_cost FROM purchase_order_items WHERE po_id=? ORDER BY id").all(po.id) as {
    part_id: number | null; name: string; qty: number; received_qty: number; unit_cost: number;
  }[];
  if (rows.some(row => row.received_qty < 0 || row.received_qty > row.qty)) throw new HttpError(409, "مقدار رسید از سفارش تجاوز کرده است؛ بررسی مالی لازم است.");
  const items: RawLine[] = rows.filter(row => row.received_qty > 0).map(row => ({ kind: row.part_id ? "part" : "other", ref_id: row.part_id,
    name: row.name, qty: row.received_qty, unit_price: row.unit_cost, cost: row.unit_cost }));
  if (!items.length) throw new HttpError(409, "این سفارش رسید کالای قابل فاکتور ندارد.");
  const receivedGross = sumRial(items.map(item => multiplyRial(Number(item.unit_price), Number(item.qty))));
  if (po.status !== "received") {
    if (po.discount || po.shipping || po.tax) throw new HttpError(409, "تخصیص مالیات، تخفیف و حمل در دریافت جزئی نیازمند سیاست تأییدشده است؛ سفارش را کامل دریافت یا صورتحساب را بررسی کنید.");
    return { items, totals: { gross: receivedGross, discount: 0, tax: 0, duty: 0, total: receivedGross } };
  }
  if (rows.some(row => row.received_qty !== row.qty) || receivedGross !== po.items_total) throw new HttpError(409, "اقلام سفارش و رسیدها تطبیق ندارند؛ پیش از صدور فاکتور بررسی مالی لازم است.");
  const shipping = rial(po.shipping ?? 0);
  if (shipping) items.push({ kind: "fee", name: "هزینه حمل سفارش خرید", qty: 1, unit_price: shipping, cost: 0 });
  const gross = sumRial([receivedGross, shipping]);
  const discount = rial(po.discount ?? 0);
  const tax = rial(po.tax ?? 0);
  if (discount > receivedGross) throw new HttpError(409, "تخفیف سند خرید نیازمند تطبیق است.");
  const total = sumRial([gross - discount, tax]);
  if (total !== po.total) throw new HttpError(409, "جمع سند خرید با اقلام و هزینه‌ها تطبیق ندارد.");
  return { items, totals: { gross, discount, tax, duty: 0, total } };
}
