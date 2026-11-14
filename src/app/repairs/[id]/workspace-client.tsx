"use client";
import { SignatureView } from "@/components/signature-pad";


import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast, Modal, EmptyState, Avatar } from "@/components/ui";
import { Icon } from "@/components/icon";
import { fmtMoney, fmtDate, fmtDateTime, timeAgo, toFaDigits, parseMoneyInput, moneyDisplayValue } from "@/lib/format";
import { statusFa, sourceFa } from "@/lib/status-fa";
import type { WorkLogRow } from "@/lib/worklog-shared";
import { WorkLogPanel } from "./worklog-panel";
import {RepairServiceCard} from '@/components/repair-service-card';
import {chargeKindLabel} from '@/lib/charge-category';

type Props = {
  ticket: any;
  statuses: Array<{ id: number; name: string; color: string; category: string }>;
  statusName: string;
  history: any[];
  notes: any[];
  items: any[];
  attachments: any[];
  timeEntries: any[];
  /** گزارش کار تعمیرکار روی این دستگاه (زمان‌سنج + وضعیت + شرح کار) */
  workLog: WorkLogRow[];
  activeTimer: any | null;
  estimate: { id: number; number: string; status: string; total: number; version: number; public_token: string } | null;
  invoice: { id: number; number: string; status: string; total: number; paid: number } | null;
  warranty: { id: number; end_date: string; terms: string } | null;
  messages: any[];
  parts: Array<{ id: number; name: string; sku: string; stock: number; price: number; avg_cost: number }>;
  services: any[];
  /** تعرفه‌های فعال تعمیرات (بخش تعرفه تعمیرات) — انتخاب سریع اجرت */
  tariffs: any[];
  users: any[];
  flags: { canEdit: boolean; canTechnical?:boolean;canQc?:boolean;canNotes?:boolean; canTrack?:boolean;canStatus: boolean; canFinancial: boolean; canReveal: boolean; hidePrices?: boolean };
  financialSummary: { subtotal: number|null; cost: number|null; paid: number|null;availableAdvance?:number|null;pendingAdvance?:number|null };
  nativeReadOnly?:boolean;
  nativeTimeSnapshot?:{totalMinutes:number;lastEntryId:number;running:{id:number;started_at:string}|null};
  financialReview?:{notes:string[];basis:string};
};

const TABS = ["عیب‌یابی", "قطعات و اجرت", "چک‌این", "یادداشت‌ها", "فایل‌ها", "مالی", "گاه‌شمار"];

const SECURITY_TYPE_FA: Record<string, string> = {
  password: "رمز عبور", pattern: "الگوی قفل", pin: "رمز عددی (PIN)", none: "بدون قفل",
};

import { TimeTracker } from "./time-tracker";
import { PatternLockView } from "@/components/pattern-lock";
import { postFinancial } from "@/lib/financial-client";

export function RepairWorkspaceClient(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState("عیب‌یابی");
  const [busy, setBusy] = useState(false);
  const [refreshing,startRefresh]=useTransition();
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealValue, setRevealValue] = useState<string | null>(null);

  // وقتی پذیرش عوض می‌شود (ناوبری نرم)، مقدار نمایش‌داده‌شده پاک شود تا از پذیرش قبلی نماند
  useEffect(() => {
    setRevealValue(null);
    setRevealOpen(false);
  }, [p.ticket.id]);

  const call = async (url: string, body: any, successMsg?: string) => {
    setBusy(true);
    try {
      let data: any;
      if (p.nativeReadOnly&&/\/(diagnosis|checklist|qc|status)$/.test(url)) data=await postFinancial(url,{...body,expected_work_version:p.ticket.work_version});
      else if (/\/(items|invoice|settle|notes)$/.test(url)) data = await postFinancial(url, body);
      else {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "عملیات ناموفق بود");
      }
      if (successMsg) toast(successMsg);
      startRefresh(()=>router.refresh());
      return data;
    } catch (e: any) {
      toast(e.message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const ticket = p.ticket;

  return (
    <div className="mt-4">
      {/* Tabs */}
      <div className="tab-scroll flex gap-1 border-b border-zinc-200 dark:border-zinc-800 mb-4" role="tablist" aria-label="بخش‌های پرونده تعمیر">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap px-3 py-2 text-[13px] font-medium border-b-2 transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:-outline-offset-2 ${
              tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t}
            {t === "یادداشت‌ها" && p.notes.length > 0 && <span className="ml-1 badge-gray">{p.notes.length}</span>}
            {t === "فایل‌ها" && p.attachments.length > 0 && <span className="ml-1 badge-gray">{p.attachments.length}</span>}
          </button>
        ))}
      </div>

      {tab === "عیب‌یابی" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card card-pad space-y-3">
            <h3 className="section-title">ایراد و عیب‌یابی</h3>
            <InfoRow label="ایراد اعلام‌شده" value={ticket.problem} />
            <InfoRow label="نوع تعمیر" value={ticket.repair_type} />
            <DiagnosisForm ticket={ticket} busy={busy} onSubmit={(body: any) => call(`/api/repairs/${ticket.id}/diagnosis`, body, "عیب‌یابی ذخیره شد")} canEdit={p.flags.canTechnical??p.flags.canEdit} />
          </section>
          <section className="card card-pad space-y-3">
            <h3 className="section-title">ثبت زمان</h3>
            <TimeTracker ticketId={ticket.id} canTrack={(p.flags.canTrack??p.flags.canEdit)&&(p.nativeReadOnly||p.statusName!=='Cancelled')} closed={p.nativeReadOnly&&['Cancelled','Delivered'].includes(p.statusName)} snapshot={p.nativeTimeSnapshot} native={p.nativeReadOnly} sourceVersion={ticket.work_version} pending={busy||refreshing} />
            <h3 className="section-title pt-2">کنترل کیفیت</h3>
            <QcSection ticket={ticket} busy={busy} call={call} canEdit={(p.flags.canTechnical??p.flags.canEdit)&&p.statusName!=='Cancelled'} canQc={p.flags.canQc??p.flags.canEdit} />
          </section>
        </div>
      )}

      {tab === "قطعات و اجرت" && (() => {
        const suggestedWarranty = Math.max(0, ...p.items.map((i: any) => Number(i.warranty_days ?? 0)));
        return (
        <div className="space-y-4">
          <div className="card">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="section-title">قطعات و خدمات این پذیرش</h3>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {suggestedWarranty > 0 && (
                  <span className="badge-purple">گارانتی اقلام: {toFaDigits(suggestedWarranty)} روز</span>
                )}
                {p.items.length > 0 && !p.flags.hidePrices && (
                  <span>
                    <span className="text-zinc-500">جمع کل: </span>
                    <span className="font-semibold">{fmtMoney(p.financialSummary.subtotal)}</span>
                  </span>
                )}
              </div>
            </div>
            {p.items.length === 0 ? (
              <EmptyState icon="package-plus" title="هنوز قطعه یا خدماتی نیست" body="قطعات از انبار و خدمات قابل‌قبض را اضافه کنید. قطعات هنگام افزودن خودکار از موجودی کسر می‌شوند." />
            ) : (
              <table className="w-full">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr><th className="th">قلم</th><th className="th">نوع</th><th className="th">تعداد</th><th className="th">گارانتی</th>{!p.flags.hidePrices && <><th className="th">قیمت</th><th className="th">جمع کل</th></>}<th className="th"></th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {p.items.map((i: any) => (
                    <tr key={i.id}>
                      <td className="td">{i.name}</td>
                      <td className="td"><span className="badge-gray">{chargeKindLabel(i.kind)}</span></td>
                      <td className="td">{i.qty}</td>
                      <td className="td">{Number(i.warranty_days ?? 0) > 0 ? `${toFaDigits(i.warranty_days)} روز` : "—"}</td>
                      {!p.flags.hidePrices && <><td className="td">{fmtMoney(i.unit_price)}</td>
                      <td className="td font-medium">{fmtMoney(i.qty * i.unit_price)}</td></>}
                      <td className="td">
                        {p.flags.canEdit&&!i.consumed&&p.statusName!=='Cancelled' && (
                          <button className="btn-ghost btn-sm text-red-600" disabled={busy}
                            onClick={() => call(`/api/repairs/${ticket.id}/items/${i.id}/remove`, {}, "ردیف حذف شد")}>
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {p.flags.canEdit&&p.statusName!=='Cancelled' && (
            <div className="grid md:grid-cols-2 gap-4">
              <AddPartCard ticketId={ticket.id} parts={p.parts} busy={busy} call={call} />
              <RepairServiceCard ticketId={ticket.id} services={p.services} tariffs={p.tariffs??[]} busy={busy} call={call} hidePrices={!!p.flags.hidePrices}/>
            </div>
          )}
        </div>
        );
      })()}

      {tab === "چک‌این" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card card-pad space-y-3">
            <h3 className="section-title">وضعیت دستگاه هنگام پذیرش</h3>
            <InfoRow label="روش دریافت" value={sourceFa(ticket.source)} />
            <InfoRow label="وضعیت ظاهری" value={ticket.condition_notes} />
            <InfoRow label="لوازم همراه" value={ticket.accessories} />
            {Object.keys(ticket.inspection ?? {}).length > 0 && (
              <div>
                <div className="label">آسیب علامت‌گذاری‌شده هنگام پذیرش</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(ticket.inspection).filter(([, v]: any) => v).map(([k]) => (
                    <span key={k} className="badge-red">{k}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="card card-pad space-y-3">
            <h3 className="section-title">تحویل دستگاه</h3>
            {ticket.delivery_signature ? (
              <div className="space-y-2">
                <span className="badge-green">تحویل حضوری با امضا</span>
                <div className="flex flex-wrap items-center gap-3">
                  <SignatureView dataUrl={ticket.delivery_signature} alt="امضای تحویل" className="w-full sm:max-w-md" />
                  <div className="text-sm space-y-0.5">
                    <div>تحویل‌گیرنده: <strong>{ticket.delivery_signed_name}</strong></div>
                    <div className="text-xs text-zinc-400">زمان: {fmtDateTime(ticket.delivery_signed_at)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">هنوز تحویل ثبت نشده — هنگام تحویل حضوری، دکمه «تحویل با امضا» در بالای صفحه رسید تحویل امضاشده می‌سازد.</p>
            )}
          </section>
          <section className="card card-pad space-y-3">
            <h3 className="section-title">اطلاعات امنیتی دستگاه</h3>
            {ticket.security_type ? (
              <>
                <InfoRow label="نوع" value={SECURITY_TYPE_FA[ticket.security_type] ?? ticket.security_type} />
                <InfoRow label="راهنما" value={ticket.security_hint} />
                <div>
                  <div className="label">مقدار (رمزنگاری‌شده)</div>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-sm font-mono">••••••••</code>
                    {p.flags.canReveal && (
                      <button className="btn-secondary btn-sm" onClick={() => setRevealOpen(true)} disabled={busy}><Icon name="eye" size={14} /> نمایش رمز</button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">نمایش رمز تأیید و در گزارش رخدادها ثبت دائمی می‌شود.</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-400">اطلاعات امنیتی ثبت نشده است.</p>
            )}
          </section>
          <Modal open={revealOpen} onClose={() => setRevealOpen(false)} title="نمایش اطلاعات امنیتی دستگاه؟">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {ticket.security_type === "password" ? "رمز عبور" : "الگوی قفل"} پذیرش <strong>{ticket.number}</strong> فقط یک‌بار نمایش داده می‌شود. این عملیات با نام شما و زمان فعلی در لاگ حسابرسی ثبت خواهد شد.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRevealOpen(false)}>انصراف</button>
              <button
                className="btn-danger"
                disabled={busy}
                onClick={async () => {
                  const data = await call(`/api/repairs/${ticket.id}/reveal-security`, {});
                  if (data) { setRevealValue(data.value); setRevealOpen(false); }
                }}
              >
                نمایش و ثبت در گزارش
              </button>
            </div>
          </Modal>
          <Modal open={revealValue !== null} onClose={() => setRevealValue(null)} title="مقدار امنیتی">
            <div className="text-center py-6">
              {ticket.security_type === "pattern" && revealValue ? (
                <div className="flex justify-center">
                  <PatternLockView value={revealValue} />
                </div>
              ) : (
                <code className="text-2xl font-mono font-bold tracking-widest">{revealValue}</code>
              )}
              <p className="mt-3 text-xs text-zinc-400">این دسترسی ثبت شد. با بستن این پنجره به‌صورت خودکار مخفی می‌شود.</p>
            </div>
          </Modal>
        </div>
      )}

      {tab === "یادداشت‌ها" && <NotesSection ticketId={ticket.id} notes={p.notes} busy={busy} call={call} canEdit={p.flags.canNotes??p.flags.canEdit} />}

      {tab === "فایل‌ها" && (
        <FilesSection ticketId={ticket.id} attachments={p.attachments} busy={busy} canEdit={p.flags.canEdit} readOnly={p.nativeReadOnly} onUploaded={()=>router.refresh()} />
      )}

      {tab === "مالی"&&p.flags.hidePrices&&<div className="card card-pad text-sm text-zinc-500">نمایش اطلاعات مالی برای نقش شما محدود است.</div>}
      {tab === "مالی"&&!p.flags.hidePrices && (
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card card-pad space-y-3">
            <h3 className="section-title">برآورد</h3>
            {p.estimate ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">برآورد</span><Link className="font-medium text-brand-600 hover:underline" href={p.nativeReadOnly?'#':`/estimates/${p.estimate.id}`} aria-disabled={p.nativeReadOnly} onClick={event=>{if(p.nativeReadOnly)event.preventDefault();}}>{p.estimate.number} (نسخهٔ {toFaDigits(p.estimate.version)})</Link></div>
                <div className="flex justify-between"><span className="text-zinc-500">وضعیت</span><EstStatusBadge status={p.estimate.status} /></div>
                <div className="flex justify-between"><span className="text-zinc-500">جمع کل</span><span className="font-semibold">{fmtMoney(p.estimate.total)}</span></div>
                <div className="flex gap-2 pt-2">
                  <Link href={p.nativeReadOnly?'#':`/estimates/${p.estimate.id}`} aria-disabled={p.nativeReadOnly} onClick={event=>{if(p.nativeReadOnly)event.preventDefault();}} className="btn-secondary btn-sm">مشاهده برآورد</Link>
                  <a href={p.nativeReadOnly?undefined:`/api/estimates/${p.estimate.id}/document`} aria-disabled={p.nativeReadOnly} target="_blank" className="btn-secondary btn-sm"><Icon name="printer" size={14} /> چاپ</a>
                </div>
              </div>
            ) : (
              <EstimateCreate ticketId={ticket.id} subtotal={p.financialSummary.subtotal??0} busy={busy} call={call} tariffs={p.tariffs ?? []} canFinancial={p.flags.canFinancial&&p.statusName!=='Cancelled'} />
            )}
          </section>
          <section className="card card-pad space-y-3">
            <h3 className="section-title">فاکتور و پرداخت</h3>
            {p.invoice ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">فاکتور</span><Link className="font-medium text-brand-600 hover:underline" href={p.nativeReadOnly?'#':`/invoices/${p.invoice.id}`} aria-disabled={p.nativeReadOnly} onClick={event=>{if(p.nativeReadOnly)event.preventDefault();}}>{p.invoice.number}</Link></div>
                <div className="flex justify-between"><span className="text-zinc-500">وضعیت</span><InvStatusBadge status={p.invoice.status} /></div>
                <div className="flex justify-between"><span className="text-zinc-500">جمع کل</span><span className="font-medium">{fmtMoney(p.invoice.total)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">پرداخت‌شده</span><span className="font-medium text-emerald-600">{fmtMoney(p.invoice.paid)}</span></div>
                <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-2"><span className="text-zinc-500">مانده حساب</span><span className="font-semibold">{fmtMoney(p.invoice.total - p.invoice.paid)}</span></div>
                <div className="flex gap-2 pt-2">
                  <Link href={p.nativeReadOnly?'#':`/invoices/${p.invoice.id}`} aria-disabled={p.nativeReadOnly} onClick={event=>{if(p.nativeReadOnly)event.preventDefault();}} className="btn-secondary btn-sm">مشاهده فاکتور</Link>
                  <Link href={p.nativeReadOnly?'#':`/payments/new?invoice_id=${p.invoice.id}`} aria-disabled={p.nativeReadOnly} onClick={event=>{if(p.nativeReadOnly)event.preventDefault();}} className="btn-primary btn-sm">ثبت پرداخت</Link>
                </div>
              </div>
            ) : (
              <div className="text-sm text-zinc-500 space-y-3">
                <p>هنوز فاکتوری صادر نشده است. هنگام تحویل دستگاه می‌توانید فاکتور بسازید.</p>
                {p.flags.canFinancial&&p.statusName!=='Cancelled' && p.financialSummary.subtotal!=null&&p.financialSummary.subtotal > 0 && (
                  <button className="btn-primary" disabled={busy} onClick={() => call(`/api/repairs/${ticket.id}/invoice`, {}, "فاکتور صادر شد")}>
                    صدور فاکتور از اقلام
                  </button>
                )}
                {p.financialSummary.subtotal === 0 && <p className="text-xs text-zinc-400">ابتدا قطعه یا خدمت ثبت کنید — فاکتور از روی اقلام تولید می‌شود.</p>}
              </div>
            )}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5 text-sm">
              {p.nativeReadOnly&&<><div className="flex flex-wrap justify-between gap-2"><span className="text-zinc-500">پیش‌دریافت تخصیص‌نیافته</span><span>{p.financialSummary.availableAdvance==null?'نیازمند تطبیق':fmtMoney(p.financialSummary.availableAdvance)}</span></div><div className="flex flex-wrap justify-between gap-2"><span className="text-zinc-500">پیش‌دریافت در انتظار وصول</span><span>{p.financialSummary.pendingAdvance==null?'نیازمند تطبیق':fmtMoney(p.financialSummary.pendingAdvance)}</span></div></>}
              <div className="flex justify-between"><span className="text-zinc-500">جمع اقلام</span><span>{p.financialSummary.subtotal==null?'نیازمند تطبیق':fmtMoney(p.financialSummary.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">{p.nativeReadOnly?'بهای مستند قطعات مصرف‌شده':'هزینه برآوردی'}</span><span>{p.financialSummary.cost==null?'نیازمند تطبیق':fmtMoney(p.financialSummary.cost)}</span></div>
              {!p.nativeReadOnly&&p.financialSummary.subtotal!=null&&p.financialSummary.cost!=null&&<div className="flex justify-between"><span className="text-zinc-500">حاشیه سود تخمینی</span><span className="font-medium text-emerald-600">{fmtMoney(p.financialSummary.subtotal-p.financialSummary.cost)}</span></div>}
              {p.nativeReadOnly&&<p className="text-xs text-amber-700 dark:text-amber-300">بهای قطعات، هزینه کل تعمیر یا سود نهایی نیست؛ تکمیل دستمزد و WIP همچنان در انتظار یکپارچه‌سازی است.</p>}
              {p.financialReview?.notes.map((note,index)=><p key={index} role="status" className="text-xs text-amber-700 dark:text-amber-300 break-words">{note}</p>)}
            </div>
          </section>
          <PostalSection ticket={ticket} busy={busy} call={call} canEdit={p.flags.canEdit} />
        </div>
      )}

      {tab === "گاه‌شمار" && (
        <div className="space-y-4">
          {/* گزارش کار تعمیرکار — پنل مستقل، با فیلتر و خروجی */}
          <WorkLogPanel rows={p.workLog} ticketNumber={ticket.number} />

          {/* خط زمانی تغییر وضعیت‌ها */}
          <section className="card card-pad">
            <h3 className="section-title mb-4">خط زمانی فعالیت‌ها</h3>
            <ol className="relative ml-2 border-l border-zinc-200 dark:border-zinc-800 space-y-4">
              {p.history.map((h: any) => (
                <li key={h.id} className="ml-4">
                  <span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-zinc-900" style={{ backgroundColor: h.color ?? "#a1a1aa" }} />
                  <div className="text-sm font-medium">
                    {h.status_name ? statusFa(h.status_name) : "تغییر وضعیت"}
                    {h.user_name && <span className="text-zinc-400 font-normal"> · {h.user_name}</span>}
                  </div>
                  <div className="text-xs text-zinc-400">{fmtDateTime(h.created_at)}{h.note ? ` · ${h.note}` : ""}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{value || <span className="text-zinc-400">—</span>}</div>
    </div>
  );
}

export function EstStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "badge-gray", sent: "badge-blue", viewed: "badge-blue", approved: "badge-green",
    rejected: "badge-red", expired: "badge-gray", converted: "badge-green",
  };
  const fa: Record<string, string> = {
    draft: "پیش‌نویس", sent: "ارسال‌شده", viewed: "مشاهده‌شده", approved: "تأییدشده",
    rejected: "ردشده", expired: "منقضی", converted: "تبدیل‌شده",
  };
  return <span className={map[status] ?? "badge-gray"}>{fa[status] ?? status}</span>;
}

export function InvStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "badge-gray", issued: "badge-blue", partially_paid: "badge-amber", paid: "badge-green",
    overdue: "badge-red", cancelled: "badge-gray", refunded: "badge-purple",
  };
  const fa: Record<string, string> = {
    draft: "پیش‌نویس", issued: "صادرشده", partially_paid: "پرداخت جزئی", paid: "پرداخت‌شده",
    overdue: "سررسید گذشته", cancelled: "لغوشده", refunded: "بازگشت‌خورده",
  };
  return <span className={map[status] ?? "badge-gray"}>{fa[status] ?? status}</span>;
}

function DiagnosisForm({ ticket, busy, onSubmit, canEdit }: any) {
  const [diagnosis, setDiagnosis] = useState(ticket.diagnosis ?? "");
  const [outcome, setOutcome] = useState(ticket.diagnosis_outcome ?? "");
  const [rootCause, setRootCause] = useState(ticket.root_cause ?? "");
  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="diag">عیب‌یابی / یافته‌ها</label>
        <textarea id="diag" className="input min-h-20" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} disabled={!canEdit}
          placeholder="نتیجه تست چه بود؟" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="outcome">نتیجه</label>
          <SearchableSelect id="outcome" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={!canEdit}>
            <option value="">—</option>
            <option value="repairable">قابل تعمیر</option>
            <option value="not_repairable">غیرقابل تعمیر</option>
            <option value="no_fault_found">عیبی نداشت</option>
            <option value="customer_declined">مشتری نپذیرفت</option>
            <option value="waiting_parts">در انتظار قطعه</option>
          </SearchableSelect>
        </div>
        <div>
          <label className="label" htmlFor="rc">علت ریشه‌ای</label>
          <input id="rc" className="input" value={rootCause} onChange={(e) => setRootCause(e.target.value)} disabled={!canEdit} placeholder="مثلاً ضربه فیزیکی" />
        </div>
      </div>
      {canEdit && (
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => onSubmit({ diagnosis, diagnosis_outcome: outcome, root_cause: rootCause })}>
          ذخیره عیب‌یابی
        </button>
      )}
    </div>
  );
}

function QcSection({ ticket, busy, call, canEdit,canQc }: any) {
  const [notes, setNotes] = useState(ticket.qc_notes ?? "");
  const items: any[] = ticket.checklist ?? [];
  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div>
          <div className="label">چک‌لیست کنترل کیفیت</div>
          <div className="space-y-1">
            {items.map((c: any, i: number) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  defaultChecked={c.done}
                  disabled={!canEdit || busy}
                  onChange={(e) => call(`/api/repairs/${ticket.id}/checklist`, { index: i, done: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                {c.item}
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="qc-notes">یادداشت کنترل کیفیت</label>
        <textarea id="qc-notes" className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canQc} />
      </div>
      {canQc && (
        <div className="flex gap-2">
          <button className="btn-primary btn-sm" disabled={busy} onClick={() => call(`/api/repairs/${ticket.id}/qc`, { result: "pass", notes }, "کنترل کیفیت قبول")}>قبولی کنترل کیفیت</button>
          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => call(`/api/repairs/${ticket.id}/qc`, { result: "fail", notes }, "کنترل کیفیت مردود")}><Icon name="x" size={14} /> مردود</button>
        </div>
      )}
      {ticket.qc_status && <div className="text-xs text-zinc-400">Last QC: {ticket.qc_status}</div>}
    </div>
  );
}

function NotesSection({ ticketId, notes, busy, call, canEdit }: any) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("internal");
  const [similar, setSimilar] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const [similarPage, setSimilarPage] = useState(1);
  const [similarMore, setSimilarMore] = useState(false);
  const [similarQuery, setSimilarQuery] = useState("");

  const searchSimilar = async (page=1) => {
    const query=page===1?body.trim().slice(0,200):similarQuery;
    if (query.length < 3||searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/repairs/${ticketId}/notes?q=${encodeURIComponent(query)}&page=${page}&perPage=20`);
      const d = await res.json();
      if(!res.ok)throw new Error(d.error??"جست‌وجو انجام نشد؛ دوباره تلاش کنید.");
      if(!Array.isArray(d.notes))throw new Error("پاسخ جست‌وجو معتبر نیست؛ صفحه را تازه کنید.");
      setSimilar(previous=>page===1?d.notes:[...previous,...d.notes]);
      setSimilarPage(page);setSimilarMore(d.hasMore===true);setSimilarQuery(query);setSearched(true);
    } catch(error) {setSearchError(error instanceof Error?error.message:"جست‌وجو انجام نشد؛ دوباره تلاش کنید.");}
    finally{setSearching(false);}
  };

  const KIND_FA: Record<string, string> = { private: "خصوصی", internal: "داخلی", public: "عمومی (مشتری)", customer: "عمومی" };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap gap-2">
            <SearchableSelect className="input w-full sm:w-44" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy} aria-label="نوع شرح کار">
              <option value="internal">داخلی (پرسنل)</option>
              <option value="public">عمومی (مشتری می‌بیند)</option>
              <option value="private">خصوصی (فقط من)</option>
            </SearchableSelect>
          </div>
          <textarea className="input min-h-20" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} disabled={busy} aria-label="متن شرح کار" placeholder="شرح کار انجام‌شده را بنویسید…" />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" disabled={!body.trim() || busy}
              onClick={async () => { const saved=await call(`/api/repairs/${ticketId}/notes`, { body, kind }, "شرح کار ثبت شد");if(saved?.ok===true) { setBody(""); setSimilar([]);setSearched(false);setSimilarMore(false);setSearchError(""); } }}>
              ثبت شرح کار
            </button>
            <button className="btn-secondary btn-sm" disabled={body.trim().length < 3 || searching||busy} onClick={()=>void searchSimilar()} title="جستجوی شرح کارهای مشابه در پذیرش‌های قبلی">
              {searching ? "…" : "تجربیات مشابه"}
            </button>
          </div>
          {searchError&&<p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{searchError}</p>}
          {searched&&!searching&&similar.length===0&&!searchError&&<EmptyState title="شرح کار مشابهی پیدا نشد" body="عبارت کوتاه‌تر یا بخشی از ایراد دستگاه را جست‌وجو کنید." />}
          {similar.length > 0 && (
            <div className="rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50/50 dark:bg-brand-500/10 p-3 space-y-2">
              <div className="text-xs font-medium text-brand-700 dark:text-brand-300">شرح کارهای مشابه از دستگاه‌های قبلی:</div>
              {similar.map((s, i) => (
                <div key={s.id??i} className="min-w-0 break-words text-xs text-zinc-600 dark:text-zinc-300 border-r-2 border-brand-300 pr-2">
                  <span className="font-medium">{s.ticket_number}</span> · {s.brand} {s.model} · <span className="text-zinc-400">{s.author}</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{s.body}</p>
                </div>
              ))}
              {similarMore&&<button className="btn-secondary btn-sm" disabled={searching||busy} onClick={()=>void searchSimilar(similarPage+1)}>{searching?"در حال دریافت…":"نتایج بیشتر"}</button>}
            </div>
          )}
        </div>
      )}
      <div className="space-y-2">
        {notes.length === 0 && <EmptyState title="هنوز شرح کاری ثبت نشده است" body={canEdit?"شرح کار را در فرم بالا ثبت کنید.":"یادداشت‌های ثبت‌شده و مجاز در این بخش نمایش داده می‌شوند."} />}
        {notes.map((n: any) => (
          <div key={n.id} className={`card card-pad ${n.kind === "public" || n.kind === "customer" ? "border-blue-200 dark:border-blue-500/30" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mb-1 min-w-0">
              <span className="font-medium text-zinc-600 dark:text-zinc-300">{n.user_name ?? "سیستمی"}</span>
              <span>·</span>
              <span>{timeAgo(n.created_at)}</span>
              <span className={(n.kind === "public" || n.kind === "customer") ? "badge-blue ml-auto" : "badge-gray ml-auto"}>{KIND_FA[n.kind] ?? n.kind}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words min-w-0">{n.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilesSection({ ticketId, attachments, busy,canEdit,onUploaded,readOnly }: {ticketId:number;attachments:Array<{id:number;filename:string;mime:string;phase:string|null;size:number}>;busy:boolean;canEdit:boolean;onUploaded:()=>void;readOnly?:boolean}) {
  const toast = useToast();
  const [uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState('');
  return (
    <div className="space-y-4">
      {canEdit&&<div className="card card-pad">
        <h3 className="section-title mb-2">بارگذاری عکس / ویدیو / سند</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <SearchableSelect id="phase" className="input w-40" defaultValue="before" aria-label="مرحله" disabled={busy||uploading}>
            <option value="before">قبل از تعمیر</option>
            <option value="during">حین تعمیر</option>
            <option value="after">بعد از تعمیر</option>
            <option value="document">سند</option>
          </SearchableSelect>
          <label className="btn-secondary cursor-pointer focus-within:ring-2 focus-within:ring-brand-500">
            {uploading?'در حال بارگذاری…':'انتخاب فایل'}
            <input type="file" className="sr-only" accept="image/*,video/*,.pdf" disabled={busy||uploading}
              onChange={async (e) => {
                const input=e.currentTarget,file = input.files?.[0];
                if (!file) return;
                setUploading(true);setUploadError('');
                try{
                const phase = (document.getElementById("phase") as HTMLSelectElement).value;
                const fd = new FormData();
                fd.append("file", file);
                fd.append("phase", phase);
                const res = await fetch(`/api/repairs/${ticketId}/attachments`, { method: "POST", body: fd });
                if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error??'بارگذاری ناموفق بود؛ دوباره تلاش کنید.');}
                toast('فایل با موفقیت ثبت شد');onUploaded();
                }catch(error){setUploadError(error instanceof Error?error.message:'ارتباط قطع شد؛ فهرست فایل‌ها را بررسی کنید و دوباره تلاش کنید.');}finally{setUploading(false);input.value='';}
              }}
            />
          </label>
          <span className="text-xs text-zinc-400">ثبت تصویر دستگاه قبل، حین و بعد از تعمیر برای جلوگیری از اختلاف، بسیار ارزشمند است.</span>
        </div>
        {uploadError&&<p role="alert" className="mt-2 text-sm text-red-600">{uploadError}</p>}
      </div>}
      {attachments.length === 0 ? (
        <EmptyState icon="paperclip" title="هنوز پیوستی نیست" body="عکس پذیرش، تصویر عیب‌یابی یا مدارک مشتری را بارگذاری کنید." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {attachments.map((a: any) => (
            <a key={a.id} href={readOnly?undefined:`/api/files/${a.id}`} aria-disabled={readOnly} title={readOnly?'دریافت فایل در انتظار یکپارچه‌سازی PostgreSQL است.':undefined} target="_blank" className="card p-3 text-center hover:border-brand-400">
              <div className="flex h-10 items-center justify-center text-zinc-400" aria-hidden><Icon name={a.mime?.startsWith("image") ? "image" : a.mime?.startsWith("video") ? "video" : "file"} size={22} strokeWidth={1.6} /></div>
              <div className="mt-1 text-xs truncate">{a.filename}</div>
              <div className="text-xs text-zinc-400">{a.phase ?? "file"} · {(a.size / 1024).toFixed(0)} KB</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPartCard({ ticketId, parts, busy, call }: any) {
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(1);
  const sel = parts.find((x: any) => String(x.id) === partId);
  const outOfStock = sel && sel.stock < qty;
  return (
    <div className="card card-pad space-y-3">
      <h3 className="section-title">افزودن قطعه از انبار</h3>
      <div>
        <label className="label" htmlFor="part-sel">قطعه</label>
        <SearchableSelect id="part-sel" className="input" value={partId} onChange={(e) => setPartId(e.target.value)}>
          <option value="">انتخاب قطعه…</option>
          {parts.map((x: any) => (
            <option key={x.id} value={x.id}>{x.name} — موجودی {toFaDigits(x.stock)}</option>
          ))}
        </SearchableSelect>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="p-qty">تعداد</label><input id="p-qty" type="number" min={1} className="input" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        <div><label className="label" htmlFor="p-price">قیمت واحد</label><input id="p-price" className="input" value={sel ? fmtMoney(sel.price) : "—"} disabled /></div>
      </div>
      {outOfStock && <p className="text-xs text-amber-600">تعداد بیشتر از موجودی انبار ({sel?.stock}) — می‌توانید ثبت کنید و قطعه بعداً دریافت شود.</p>}
      <button className="btn-primary btn-sm w-full" disabled={!partId || busy}
        onClick={() => call(`/api/repairs/${ticketId}/items`, { kind: "part", ref_id: Number(partId), qty }, "قطعه اضافه شد — از موجودی کسر شد")}>
        افزودن قطعه (از موجودی کسر می‌شود)
      </button>
    </div>
  );
}

function PostalSection({ ticket, busy, call, canEdit }: any) {
  const [code, setCode] = useState(ticket.postal_tracking ?? "");
  return (
    <section className="card card-pad space-y-3">
      <h3 className="section-title">ارسال پستی دستگاه</h3>
      <p className="text-sm text-zinc-500">پس از اتمام کار، اگر دستگاه برای مشتری پست می‌شود، کد رهگیری را ثبت کنید — مشتری در صفحه پیگیری خود آن را می‌بیند.</p>
      <div>
        <label className="label" htmlFor="postal">کد رهگیری پستی</label>
        <input id="postal" className="input" dir="ltr" placeholder="مثلاً RA123456789IR" value={code} onChange={(e) => setCode(e.target.value)} disabled={!canEdit} />
      </div>
      {canEdit && (
        <button className="btn-primary btn-sm" disabled={busy}
          onClick={() => call(`/api/repairs/${ticket.id}/postal`, { postal_tracking: code.trim() }, code.trim() ? "کد رهگیری ثبت شد — در صفحه پیگیری مشتری نمایش داده می‌شود" : "کد رهگیری حذف شد")}>
          ذخیره کد رهگیری
        </button>
      )}
      {ticket.postal_tracking && (
        <div className="rounded-lg bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3 py-2 text-sm">
          <span className="text-emerald-700 dark:text-emerald-400 font-medium">ارسال‌شده</span>
          <span dir="ltr" className="font-mono mr-2">{ticket.postal_tracking}</span>
          <a href={`https://tracking.post.ir/?id=${encodeURIComponent(ticket.postal_tracking)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline mr-2">
            رهگیری در سایت پست ↗
          </a>
        </div>
      )}
    </section>
  );
}

function EstimateCreate({ ticketId, subtotal, busy, call, canFinancial, tariffs }: any) {
  const toast=useToast();
  const [deposit, setDeposit] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  if (!canFinancial) return <p className="text-sm text-zinc-400">شما اجازهٔ دسترسی به برآورد هزینه را ندارید.</p>;
  const pickedRows = (tariffs ?? []).filter((t: any) => picked.includes(Number(t.id)));
  const pickedTotal = pickedRows.reduce((s: number, t: any) => s + Number(t.labor_price ?? 0), 0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        برآورد از قطعات و خدمات ثبت‌شده روی این پذیرش ساخته می‌شود
        {subtotal > 0 ? ` (اکنون ${fmtMoney(subtotal)})` : ""}. اگر کاری طبق تعرفه انجام می‌شود، همین‌جا اضافه کنید.
      </p>
      {(tariffs ?? []).length > 0 && (
        <div>
          <span className="label">افزودن اقلام از تعرفهٔ تعمیرات (اختیاری)</span>
          <div className="flex flex-wrap gap-1.5">
            {(tariffs ?? []).map((t: any) => {
              const on = picked.includes(Number(t.id));
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  className={`${on ? "btn-primary" : "btn-secondary"} btn-sm`}
                  onClick={() => setPicked((prev) => (on ? prev.filter((x) => x !== Number(t.id)) : [...prev, Number(t.id)]))}
                >
                  {t.device_type} — {t.title}
                  {Number(t.labor_price ?? 0) > 0 ? ` — ${fmtMoney(t.labor_price)}` : ""}
                </button>
              );
            })}
          </div>
          {pickedRows.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {toFaDigits(pickedRows.length)} قلم تعرفه انتخاب شد{pickedTotal > 0 ? ` · جمع ${fmtMoney(pickedTotal)}` : ""}
              {" · این اقلام ابتدا به پذیرش اضافه و بعد در برآورد می‌آیند."}
            </p>
          )}
        </div>
      )}
      <div>
        <label className="label" htmlFor="est-dep">بیعانهٔ درخواستی (اختیاری)</label>
        <input
          id="est-dep"
          type="number"
          step="0.01"
          className="input w-40"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          placeholder={moneyDisplayValue(0)}
        />
      </div>
      <button
        className="btn-primary btn-sm"
        disabled={busy}
        onClick={() => {try{
          call(
            `/api/repairs/${ticketId}/estimate`,
            { deposit: deposit ? parseMoneyInput(deposit,undefined,true) : 0, extra_tariffs: picked },
            "برآورد ایجاد و ارسال شد"
          );}catch(error){toast(error instanceof Error?error.message:'مبلغ معتبر نیست.','error');}}}
      >
        ساخت و ارسال برآورد
      </button>
    </div>
  );
}
