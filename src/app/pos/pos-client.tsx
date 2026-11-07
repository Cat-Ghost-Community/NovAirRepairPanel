"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postFinancial } from "@/lib/financial-client";
import { useToast } from "@/components/ui";
import { fmtMoney, toFaDigits } from "@/lib/format";
import { multiplyRial, percentRial, sumRial } from "@/lib/money";

type CartLine = { key: string; kind: "part" | "service"; ref_id: number; name: string; unit_price: number; cost: number; qty: number; stock: number };

export function PosClient({ parts, services, taxRate, branchId, branchName }: { parts: any[]; services: any[]; taxRate: number; branchId: number; branchName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [customer, setCustomer] = useState<any>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<any[]>([]);
  const [custSearchTimer, setCustSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState<{ id: number; number: string; total: number; hadCustomer: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // قیمت‌گذاری مشتری‌محور: همکار → wholesale_price، VIP/عمده → قیمت تیپ خودش
  const custPriceType = customer?.price_type ?? (customer?.is_vip ? "vip" : "general");
  const priceOf = (p: any) => {
    if (p.price_type === "wholesale") return p.wholesale_price && custPriceType !== "general" ? p.wholesale_price : p.price;
    if (custPriceType === "wholesale" || custPriceType === "vip") return p.wholesale_price || p.price;
    return p.price;
  };

  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [
      ...parts.map((p) => ({ kind: "part" as const, ref_id: p.id, name: p.name, price: priceOf(p), sku: p.sku, barcode: p.barcode, stock: p.stock, cost: p.avg_cost || 0 })),
      ...services.map((s) => ({ kind: "service" as const, ref_id: s.id, name: s.name, price: s.price, sku: "", barcode: null, stock: Infinity, cost: 0 })),
    ];
    if (!q) return all.slice(0, 24);
    return all.filter((x) => x.name.toLowerCase().includes(q) || x.sku?.toLowerCase().includes(q) || x.barcode === query.trim()).slice(0, 24);
  }, [query, parts, services, custPriceType]);


  const addToCart = (item: any) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.kind === item.kind && l.ref_id === item.ref_id);
      if (existing) {
        if (existing.qty + 1 > existing.stock) {
          toast(`فقط ${toFaDigits(existing.stock)} عدد موجود است`, "error");
          return prev;
        }
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { key: `${item.kind}-${item.ref_id}`, kind: item.kind, ref_id: item.ref_id, name: item.name, unit_price: item.price, cost: item.cost, qty: 1, stock: item.stock }];
    });
    setQuery("");
    searchRef.current?.focus();
  };

  // barcode exact match on Enter
  const onScan = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const code = query.trim();
    if (!code) return;
    const exact = catalog.find((x) => x.barcode === code || x.sku?.toLowerCase() === code.toLowerCase());
    if (exact) addToCart(exact);
  };

  const arithmetic = useMemo(() => {
    try {
      const subtotal = sumRial(cart.map(line => multiplyRial(line.unit_price, line.qty)));
      const discount = percentRial(subtotal, discountPct);
      const tax = percentRial(subtotal - discount, taxRate);
      return { subtotal, discount, tax, total: sumRial([subtotal - discount, tax]), error: "" };
    } catch { return { subtotal: 0, discount: 0, tax: 0, total: 0, error: "مبلغ یا نرخ فروش معتبر نیست؛ تعداد و تنظیمات مالی را بررسی کنید." }; }
  }, [cart, discountPct, taxRate]);
  const { subtotal, discount, tax, total } = arithmetic;
  const amountLabel = (value: number) => arithmetic.error ? "—" : fmtMoney(value);

  const checkout = async () => {
    if (cart.length === 0 || arithmetic.error) return;
    setBusy(true);
    try {
      const data = await postFinancial<{ id: number; number: string; total: number }>("/api/sales", {
          customer_id: customer?.id ?? null,
          method,
          expected_total: total,
          expected_branch_id: branchId,
          discount,
          items: cart.map((l) => ({ kind: l.kind, ref_id: l.ref_id, name: l.name, qty: l.qty, unit_price: l.unit_price, cost: l.cost })),
      });
      setLastSale({ id: Number(data.id), number: data.number, total: data.total, hadCustomer: customer?.id != null });
      setCart([]);
      setDiscountPct(0);
      setCustomer(null);
      toast(`فروش ${data.number} ثبت شد`);
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 grid lg:grid-cols-5 gap-4">
      {/* Catalog */}
      <div className="lg:col-span-3 space-y-3">
        <div>
          <h1 className="text-lg font-bold">صندوق فروش <span className="text-sm font-normal text-zinc-500">{branchName}</span></h1>
          <p className="text-xs text-zinc-500">بارکد بکشید یا جستجو کنید؛ کلید Enter برای تطبیق دقیق کد. <kbd className="rounded border px-1">Esc</kbd> پاک می‌کند.</p>
        </div>
        <input
          ref={searchRef}
          className="input text-base"
          placeholder="اسکن بارکد یا جستجوی کالا…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onScan(e);
            if (e.key === "Escape") setQuery("");
          }}
          autoFocus
          aria-label="جستجوی کالا یا اسکن بارکد"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {catalog.map((item) => (
            <button key={`${item.kind}-${item.ref_id}`} onClick={() => addToCart(item)}
              className="card p-3 text-left hover:border-brand-400 transition-colors disabled:opacity-40"
              disabled={item.stock <= 0}>
              <div className="text-[13px] font-medium leading-tight line-clamp-2">{item.name}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-semibold">{fmtMoney(item.price)}</span>
                <span className={`text-xs ${item.stock === Infinity ? "text-blue-500" : item.stock <= 2 ? "text-amber-600" : "text-zinc-400"}`}>
                  {item.stock === Infinity ? "خدمت" : `موجودی ${toFaDigits(item.stock)}`}
                </span>
              </div>
            </button>
          ))}
          {catalog.length === 0 && <p className="col-span-full text-sm text-zinc-400 py-6 text-center">کالایی پیدا نشد؛ عبارت جستجو را تغییر دهید.</p>}
        </div>
      </div>

      {/* Cart */}
      <div className="lg:col-span-2">
        <div className="card sticky top-4">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="font-semibold">سبد ({toFaDigits(cart.reduce((s, l) => s + l.qty, 0))})</h2>
            {cart.length > 0 && <button className="text-xs text-red-500 hover:underline" onClick={() => setCart([])}>پاک کردن</button>}
          </div>
          {lastSale && (
            <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[13px] dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <div className="flex items-center justify-between gap-2 text-emerald-700 dark:text-emerald-400">
                <span>فروش <span className="font-mono font-semibold">{lastSale.number}</span> ثبت شد — {fmtMoney(lastSale.total)}</span>
                <button className="underline" onClick={() => setLastSale(null)}>بستن</button>
              </div>
              {lastSale.hadCustomer ? (
                <a href={`/invoices/new?from_sale=${lastSale.id}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline dark:text-brand-400">
                  صدور فاکتور رسمی از این فروش
                </a>
              ) : (
                <p className="mt-1 text-[11px] text-emerald-700/80 dark:text-emerald-400/80">فروش مهمان — برای فاکتور رسمی، مشتری را قبل از فروش انتخاب کنید.</p>
              )}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {cart.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-400">سبد خالی است — برای افزودن، روی کالاها بزنید.</p>}
            {cart.map((l) => (
              <div key={l.key} className="px-4 py-2.5 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{l.name}</div>
                  <div className="text-xs text-zinc-400">{fmtMoney(l.unit_price)} برای هر واحد</div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="btn-ghost btn-sm !px-2" aria-label="کاهش" onClick={() => setCart(cart.map((x) => (x.key === l.key ? { ...x, qty: Math.max(0, x.qty - 1) } : x)).filter((x) => x.qty > 0))}>−</button>
                  <span className="w-6 text-center text-sm font-medium">{l.qty}</span>
                  <button className="btn-ghost btn-sm !px-2" aria-label="افزایش" onClick={() => {
                    if (l.qty + 1 > l.stock) { toast(`فقط ${toFaDigits(l.stock)} عدد موجود است`, "error"); return; }
                    setCart(cart.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)));
                  }}>+</button>
                </div>
                <span className="w-16 text-right text-sm font-medium">{fmtMoney(l.qty * l.unit_price)}</span>
              </div>
            ))}
          </div>

          {/* Customer */}
          <div className="px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800">
            {customer ? (
              <div className="flex items-center justify-between text-sm">
                <span>{customer.first_name} {customer.last_name}</span>
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setCustomer(null)}>تغییر</button>
              </div>
            ) : (
              <div className="relative">
                <input className="input !py-1.5 text-[13px]" placeholder="+ اتصال مشتری (اختیاری — مشتری حضوری)" value={custQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustQuery(v);
                    if (custSearchTimer) clearTimeout(custSearchTimer);
                    const t = setTimeout(async () => {
                      if (v.trim().length < 2) { setCustResults([]); return; }
                      const res = await fetch(`/api/customers/lookup?q=${encodeURIComponent(v)}`);
                      setCustResults((await res.json()).customers ?? []);
                    }, 200);
                    setCustSearchTimer(t);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && custResults.length > 0) { setCustomer(custResults[0]); setCustQuery(""); setCustResults([]); }
                  }} />
                {custQuery && custResults.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full card divide-y divide-zinc-100 dark:divide-zinc-800 max-h-40 overflow-y-auto">
                    {custResults.map((c) => (
                      <button key={c.id} className="block w-full text-left px-3 py-2 text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        onClick={() => { setCustomer(c); setCustQuery(""); setCustResults([]); }}>
                        {c.first_name} {c.last_name} <span className="text-zinc-400">{c.mobile}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {custQuery.length > 1 && !custResults.length && (
              <p className="text-xs text-zinc-400 mt-1">در حال جستجو… (برای مشتری حضوری خالی بگذارید)</p>
            )}
          </div>

          {/* Totals */}
          <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5 text-sm">
            {arithmetic.error && <p role="alert" className="text-red-600">{arithmetic.error}</p>}
            <div className="flex justify-between"><span className="text-zinc-500">جمع کل</span><span>{amountLabel(subtotal)}</span></div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-500">تخفیف</span>
              <span className="flex items-center gap-1">
                <input type="number" min={0} max={100} value={discountPct} onChange={(e) => setDiscountPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                  className="input !w-16 !py-1 text-right" aria-label="درصد تخفیف" />
                <span className="text-zinc-400">%</span>
                <span className="w-16 text-right">{discount ? `−${fmtMoney(discount)}` : "—"}</span>
              </span>
            </div>
            <div className="flex justify-between"><span className="text-zinc-500">مالیات ({toFaDigits(taxRate)}٪)</span><span>{amountLabel(tax)}</span></div>
            <div className="flex justify-between text-base font-bold pt-1 border-t border-zinc-200 dark:border-zinc-800">
              <span>جمع کل</span><span>{amountLabel(total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="px-4 pb-4 pt-1 border-t border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-4 gap-1.5 py-2">
              {[["cash", "نقد"], ["card", "کارتخوان"], ["transfer", "حواله"], ["other", "سایر"]].map(([m, label]) => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`rounded-lg border px-1 py-2 text-xs font-medium ${method === m ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-zinc-200 dark:border-zinc-800"}`}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn-primary btn-lg w-full" disabled={busy || !!arithmetic.error || cart.length === 0} onClick={checkout}>
              {busy ? "در حال ثبت…" : `ثبت فروش ${amountLabel(total)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
