"use client";

import {JalaliDatePicker} from '@/components/jalali-date-picker';
import { SearchableSelect } from "@/components/searchable-select";


import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Avatar,EmptyState } from "@/components/ui";
import { fmtMoney, fmtDate, todayISO,parseMoneyInput,moneyDisplayValue,getCurrencyUnit } from "@/lib/format";
import { postFinancial } from "@/lib/financial-client";
import Link from 'next/link';
import type {PayrollQuery} from '@/lib/payroll-query';

type Staff = {
  id: number; name: string; role: string; avatar_color: string;
  salary_type: string | null; fixed_monthly: number | null; percent_repair: number | null;
  percent_parts: number | null; percent_only_labor: number | null; pay_period: string | null;
  pending_commission: number; total_deductions: number;profile_active:number|null;
};
type Run = { cancellable:number;source_ticket_id:number|null;ticket_number:string|null;id: number; user_name: string; period_from: string | null; period_to: string | null; base_salary: number; earned_commission: number; deductions: number; net_payable: number; paid_amount:number; status: string;effective_net:number;effective_commission:number;payable:number;recoverable:number;recovered:number;corrected:number };
type Deduction = { id: number; user_name: string; amount: number; reason: string; date: string; notes: string | null };

const SALARY_TYPE_FA: Record<string, string> = { fixed: "ثابت", percent: "درصدی", mixed: "تلفیقی" };
const REASON_FA: Record<string, string> = { absence: "غیبت", late: "تأخیر", violation: "تخلف", mistake: "اشتباه عملیاتی", other: "سایر" };
const RUN_STATUS_FA: Record<string, string> = { pending: "در انتظار", approved: "تأییدشده",partially_paid:"پرداخت جزئی", paid: "پرداخت‌شده", cancelled: "لغوشده" };

export function PayrollClient({ staff, runs, deductions,canManage,canPay,canReview,filters,summary }: { staff: Staff[]; runs: Run[]; deductions: Deduction[];canManage:boolean;canPay:boolean;canReview:boolean;filters:PayrollQuery;summary:{count:number;payable:number;paid:number;recoverable:number} }) {
  const router = useRouter();
  const toast = useToast();
  const [profileFor, setProfileFor] = useState<Staff | null>(null);
  const [dedFor, setDedFor] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);
  const [dateFilters,setDateFilters]=useState({from:filters.from,to:filters.to});
  const [payFor,setPayFor]=useState<Run|null>(null);
  const [payout,setPayout]=useState({amount:"",method:"cash",payment_date:todayISO(),document_reference:"",confirmed:false});
  const payrollMoney=(value:unknown)=>parseMoneyInput(String(value),getCurrencyUnit(),true);
  const [cancelFor,setCancelFor]=useState<Run|null>(null),[cancelReason,setCancelReason]=useState(''),[cancelReference,setCancelReference]=useState('');
  const cancelLock=useRef(false);
  const cancelCommission=async()=>{
   if(!cancelFor||cancelLock.current)return;cancelLock.current=true;setBusy(true);
   try{
    if(cancelFor.cancellable)await postFinancial('/api/payroll',{action:'cancel_run',id:cancelFor.id,reason:cancelReason,reference:cancelReference});
    else await postFinancial('/api/commission-corrections',{action:'propose',run_id:cancelFor.id,kind:'reduction',amount:cancelFor.effective_commission,posting_date:todayISO(),reason:cancelReason,evidence_reference:cancelReference});
    toast(cancelFor.cancellable?'پیش‌نویس پورسانت لغو شد.':'پیشنهاد ابطال برای تأیید مستقل ثبت شد.');
    if(!cancelFor.cancellable)router.push('/payroll/corrections?run_id='+cancelFor.id);
    setCancelFor(null);router.refresh();
   }catch(cause){toast(cause instanceof Error?cause.message:'عملیات انجام نشد.','error');}finally{setBusy(false);cancelLock.current=false;}
  };
  const runAction=async(body:unknown)=>{if(busy)return;setBusy(true);try{await postFinancial("/api/payroll",body);toast("سند ثبت شد");router.refresh();return true;}catch(e){toast(e instanceof Error?e.message:"عملیات ثبت نشد؛ دوباره تلاش کنید.","error");return false;}finally{setBusy(false);}};
  const [profile, setProfile] = useState<any>({});
  const [ded, setDed] = useState<any>({ amount: "", reason: "absence", date: todayISO(), notes: "" });

  const openProfile = (s: Staff) => {
    setProfile({
      salary_type: s.salary_type ?? "fixed",
      fixed_monthly: moneyDisplayValue(s.fixed_monthly??0,getCurrencyUnit()),
      percent_repair: s.percent_repair ?? 0,
      percent_parts: s.percent_parts ?? 0,
      percent_only_labor: s.percent_only_labor ?? 0,
      pay_period: s.pay_period ?? "monthly",is_active:s.profile_active??1,
    });
    setProfileFor(s);
  };

  const saveProfile = async () => {
    if (!profileFor) return;
    setBusy(true);
    try {
      const data = await postFinancial<{ok:boolean;error?:string}>("/api/payroll",{ action: "save_profile", user_id: profileFor.id, ...profile,fixed_monthly:payrollMoney(profile.fixed_monthly) });
      if (data.ok) { toast("پروفایل حقوق ذخیره شد"); setProfileFor(null); router.refresh(); }
      else toast(data.error ?? "ذخیره ناموفق بود", "error");
    } catch(e) { toast(e instanceof Error?e.message:"مشکل شبکه", "error"); }
    setBusy(false);
  };

  const saveDeduction = async () => {
    if (!dedFor || !ded.amount) { toast("مبلغ الزامی است", "error"); return; }
    setBusy(true);
    try {
      const data = await postFinancial<{ok:boolean;error?:string}>("/api/payroll",{ action: "add_deduction", user_id: dedFor.id, ...ded, amount: payrollMoney(ded.amount) });
      if (data.ok) { toast("کسر حقوق ثبت شد"); setDedFor(null); setDed({ ...ded, amount: "", notes: "" }); router.refresh(); }
      else toast(data.error ?? "ثبت ناموفق بود", "error");
    } catch(e) { toast(e instanceof Error?e.message:"مشکل شبکه", "error"); }
    setBusy(false);
  };

  return (
    <>
      <form action="/payroll" method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label><span className="label">کارمند</span><select name="employee" className="input" defaultValue={filters.employee??''}><option value="">همهٔ کارکنان</option>{staff.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <div><label htmlFor="payroll-from" className="label">از تاریخ</label><input name="from" type="hidden" value={dateFilters.from}/><JalaliDatePicker id="payroll-from" value={dateFilters.from} clearable onChange={value=>setDateFilters(previous=>({...previous,from:value}))}/></div>
        <div><label htmlFor="payroll-to" className="label">تا تاریخ</label><input name="to" type="hidden" value={dateFilters.to}/><JalaliDatePicker id="payroll-to" value={dateFilters.to} clearable onChange={value=>setDateFilters(previous=>({...previous,to:value}))}/></div>
        <label><span className="label">وضعیت</span><select name="status" className="input" defaultValue={filters.status}><option value="">همهٔ وضعیت‌ها</option>{Object.entries(RUN_STATUS_FA).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <div className="flex items-end gap-2"><button className="btn-primary" type="submit">گزارش</button><Link href="/payroll" className="btn-secondary">پاک کردن</Link></div>
      </form>
      <section aria-label="خلاصهٔ نتایج گزارش" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([['اسناد منطبق',String(summary.count)],['ماندهٔ قابل پرداخت',fmtMoney(summary.payable)],['پرداخت‌های ثبت‌شده',fmtMoney(summary.paid)],['مطالبهٔ بازیافت',fmtMoney(summary.recoverable)]] as const).map(([label,value])=><div key={label} className="card card-pad"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 break-words font-semibold"><bdi>{value}</bdi></p></div>)}
      </section>
      <section className="card mb-6 overflow-x-auto"><div className="card-pad border-b border-zinc-200 dark:border-zinc-800"><h2 className="section-title">قرارداد و کنترل کارکنان</h2><p className="mt-1 text-xs text-zinc-500">تعلیق محاسبهٔ جدید، پورسانت‌ها و پرداخت‌های قبلی را تغییر نمی‌دهد. حقوق پایهٔ قرارداد به‌صورت خودکار برای بازهٔ انتخابی تسهیم نمی‌شود.</p></div>
       {staff.length?<table className="w-full"><thead><tr><th className="th">کارمند</th><th className="th">قرارداد</th><th className="th">پورسانت در انتظار</th><th className="th">کسورات ثبت‌شده</th><th className="th">مدیریت</th></tr></thead><tbody>{staff.map(row=><tr key={row.id} className="row-hover border-t border-zinc-100 dark:border-zinc-800"><td className="td"><div className="flex items-center gap-2"><Avatar name={row.name} color={row.avatar_color}/><span>{row.name}</span></div></td><td className="td"><span>{row.salary_type?SALARY_TYPE_FA[row.salary_type]:'تعریف نشده'}</span>{row.fixed_monthly!=null&&<span className="block text-xs text-zinc-500">پایهٔ ماهانه: {fmtMoney(row.fixed_monthly)}</span>}{row.profile_active===0&&<span className="badge-amber mt-1">محاسبهٔ جدید معلق</span>}</td><td className="td">{fmtMoney(row.pending_commission)}</td><td className="td">{fmtMoney(row.total_deductions)}</td><td className="td"><div className="flex flex-wrap gap-2"><button className="btn-secondary btn-sm" disabled={!canManage||busy} onClick={()=>openProfile(row)}>قرارداد</button><button className="btn-secondary btn-sm" disabled={!canManage||busy} onClick={()=>setDedFor(row)}>ثبت کسری</button><Link className="btn-secondary btn-sm" href={'/payroll?employee='+row.id}>سوابق</Link></div></td></tr>)}</tbody></table>:<EmptyState title="کارمند فعالی یافت نشد" body="شعبه و صفحهٔ کارکنان را بررسی کنید."/>}
      </section>

      {/* پورسانت‌های در انتظار */}
      {runs.length > 0 && (
        <div className="card mb-5 overflow-x-auto">
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="section-title">پورسانت‌های ثبت‌شده</h2>
          </div>
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">کارمند</th>
                <th className="th">پورسانت</th>
                <th className="th">خالص پرداختی</th>
                <th className="th">وضعیت</th>
                <th className="th">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {runs.map((r) => (
                <tr key={r.id} className="row-hover">
                  <td className="td">{r.user_name}<div className="mt-1 text-xs text-zinc-500">{fmtDate(r.period_from)} تا {fmtDate(r.period_to)}</div>{r.source_ticket_id&&<Link className="text-xs text-brand-600" href={'/repairs/'+r.source_ticket_id}>{r.ticket_number??('پذیرش '+r.source_ticket_id)}</Link>}</td>
                  <td className="td">{fmtMoney(r.status==='cancelled'?0:r.effective_commission)}{(r.corrected>0||r.status==='cancelled')&&<span className="mt-1 block text-xs text-zinc-500">اصل سند: {fmtMoney(r.earned_commission)}</span>}{r.corrected>0&&r.effective_commission===0&&r.earned_commission>0&&<span className="badge-red mt-1">پورسانت با اصلاح مصوب باطل شد</span>}</td>
                  <td className="td font-semibold">{fmtMoney(r.status==='cancelled'?0:r.effective_net)}{r.recoverable>0&&<span className="badge-amber mt-1 block w-fit">مطالبهٔ مصوب: {fmtMoney(r.recoverable)}</span>}</td>
                  <td className="td">
                    <span className={`badge ${r.status === "paid" ? "badge-green" : r.status === "approved" ? "badge-blue" : "badge-amber"}`}>
                      {RUN_STATUS_FA[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="td">
                    {r.status === "pending" && !r.corrected && canReview && (
                      <button
                        className="btn-secondary btn-sm !py-1"
                        disabled={busy} onClick={()=>runAction({action:"approve_run",id:r.id})}
                      >تأیید</button>
                    )}
                    {(["approved","partially_paid"].includes(r.status)||r.corrected>0) && r.payable>0 && canPay && (
                      <button
                        className="btn-primary btn-sm !py-1"
                        disabled={busy} onClick={()=>{setPayFor(r);setPayout({amount:moneyDisplayValue(r.payable,getCurrencyUnit()),method:"cash",payment_date:todayISO(),document_reference:"",confirmed:false});}}
                      >ثبت سند پرداخت</button>
                    )}
                    {canManage&&r.status!=='cancelled'&&(r.cancellable||r.source_ticket_id&&r.effective_commission>0)&&<button type="button" className="btn-danger btn-sm mt-1" disabled={busy} onClick={()=>{setCancelFor(r);setCancelReason('');setCancelReference('');}}>{r.cancellable?'لغو پیش‌نویس':'ابطال پورسانت'}</button>}
                    {canManage&&<Link className="btn-secondary btn-sm mt-1" href={'/payroll/corrections?run_id='+r.id}>اصلاح و بازیافت</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* کسورات اخیر */}
      {runs.length===0&&<EmptyState title="پورسانتی ثبت نشده است" body="پس از تحویل تعمیر واجد شرایط، پورسانت از اقلام واقعی آن ثبت می‌شود."/>}
      {deductions.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="section-title">کسورات اخیر</h2>
          </div>
          <table className="w-full">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="th">کارمند</th>
                <th className="th">مبلغ</th>
                <th className="th">دلیل</th>
                <th className="th">تاریخ</th>
                <th className="th hidden md:table-cell">یادداشت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {deductions.slice(0, 10).map((d) => (
                <tr key={d.id} className="row-hover">
                  <td className="td">{d.user_name}</td>
                  <td className="td font-medium text-red-600">{fmtMoney(d.amount)}</td>
                  <td className="td">{REASON_FA[d.reason] ?? d.reason}</td>
                  <td className="td text-zinc-500">{fmtDate(d.date)}</td>
                  <td className="td text-zinc-500 hidden md:table-cell">{d.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!cancelFor} onClose={()=>setCancelFor(null)} dismissible={!busy} title={cancelFor?.cancellable?'لغو پیش‌نویس پورسانت':'پیشنهاد ابطال پورسانت'}><div className="space-y-3"><p className="text-sm leading-7">{cancelFor?.cancellable?'این سند هنوز تأیید یا در دفترکل ثبت نشده است. مبلغ اصلی و دلیل لغو در سابقه باقی می‌مانند.':'ابطال پورسانت با سند کاهش مستقل ثبت و توسط فرد مجاز دیگری تأیید می‌شود. پرداخت قبلی حذف نمی‌شود؛ اضافه‌پرداخت به مطالبهٔ بازیافت تبدیل می‌شود.'}</p><p className="font-semibold">{cancelFor?.user_name} · {fmtMoney(cancelFor?.effective_commission??0)}</p><label className="block"><span className="label">دلیل مستند *</span><textarea className="input" maxLength={1000} disabled={busy} value={cancelReason} onChange={event=>setCancelReason(event.target.value)}/></label><label className="block"><span className="label">مرجع تصمیم *</span><input className="input" maxLength={200} disabled={busy} value={cancelReference} onChange={event=>setCancelReference(event.target.value)}/></label><div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setCancelFor(null)}>انصراف</button><button className="btn-danger" disabled={busy||cancelReason.trim().length<5||cancelReference.trim().length<5} onClick={()=>void cancelCommission()}>{busy?'در حال ثبت…':cancelFor?.cancellable?'لغو مستند پیش‌نویس':'ارسال برای تأیید مستقل'}</button></div></div></Modal>
      <Modal open={!!payFor} onClose={()=>{if(!busy)setPayFor(null);}} title={`ثبت پرداخت انجام‌شده — ${payFor?.user_name??""}`}>
        <div className="space-y-3"><p className="text-sm text-zinc-500">این فرم انتقال بانکی انجام نمی‌دهد. فقط پرداخت انجام‌شده با مرجع معتبر را ثبت کنید.</p>
          <div><label className="label" htmlFor="commission-amount">مبلغ ({getCurrencyUnit()==='toman'?'تومان':'ریال'})</label><input id="commission-amount" className="input" inputMode="decimal" dir="ltr" value={payout.amount} onChange={e=>setPayout(p=>({...p,amount:e.target.value}))}/></div>
          <div><label className="label" htmlFor="commission-method">روش پرداخت</label><SearchableSelect id="commission-method" className="input" value={payout.method} onChange={e=>setPayout(p=>({...p,method:e.target.value}))}><option value="cash">نقد</option><option value="card">کارتخوان</option><option value="transfer">حواله</option></SearchableSelect></div>
          <div><label className="label" htmlFor="commission-date">تاریخ پرداخت</label><JalaliDatePicker id="commission-date" value={payout.payment_date} onChange={value=>setPayout(previous=>({...previous,payment_date:value}))}/></div>
          <div><label className="label" htmlFor="commission-reference">مرجع سند پرداخت</label><input id="commission-reference" className="input" value={payout.document_reference} maxLength={200} onChange={e=>setPayout(p=>({...p,document_reference:e.target.value}))}/></div>
          <label className="flex gap-2 items-start text-sm"><input className="mt-1" type="checkbox" checked={payout.confirmed} onChange={e=>setPayout(p=>({...p,confirmed:e.target.checked}))}/>پرداخت انجام شده و مرجع آن را بررسی کرده‌ام.</label>
          <div className="flex flex-wrap gap-2 justify-end"><button className="btn-secondary" disabled={busy} onClick={()=>setPayFor(null)}>انصراف</button><button className="btn-primary" disabled={busy||!payout.confirmed||payout.document_reference.trim().length<3} onClick={async()=>{if(!payFor)return;try{if(await runAction({action:"pay_run",id:payFor.id,...payout,amount:payrollMoney(payout.amount)}))setPayFor(null);}catch(e){toast(e instanceof Error?e.message:"مبلغ معتبر نیست.","error");}}}>{busy?"در حال ثبت…":"ثبت قطعی سند پرداخت"}</button></div>
        </div>
      </Modal>
      {/* مودال تنظیم حقوق */}
      <Modal open={!!profileFor} onClose={() => setProfileFor(null)} title={`تنظیم حقوق — ${profileFor?.name ?? ""}`}>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">نوع حقوق</label>
              <SearchableSelect className="input" value={profile.salary_type} onChange={(e) => setProfile({ ...profile, salary_type: e.target.value })}>
                <option value="fixed">ثابت</option>
                <option value="percent">درصدی</option>
                <option value="mixed">تلفیقی (ثابت + درصدی)</option>
              </SearchableSelect>
            </div>
            <div>
              <label className="label">دوره پرداخت</label>
              <SearchableSelect className="input" value={profile.pay_period} onChange={(e) => setProfile({ ...profile, pay_period: e.target.value })}>
                <option value="monthly">ماهانه</option>
                <option value="weekly">هفتگی</option>
                <option value="daily">روزانه</option>
              </SearchableSelect>
            </div>
            {profile.salary_type !== "percent" && (
              <div className="sm:col-span-2">
                <label className="label">حقوق پایهٔ ماهانهٔ قرارداد ({getCurrencyUnit()==='toman'?'تومان':'ریال'})</label>
                <input className="input num" dir="ltr" value={profile.fixed_monthly} onChange={(e) => setProfile({ ...profile, fixed_monthly: e.target.value })} />
              </div>
            )}
            {profile.salary_type !== "fixed" && (
              <>
                <div>
                  <label className="label">درصد از خدمات تعمیر</label>
                  <input type="number" min={0} max={100} className="input num" dir="ltr" value={profile.percent_repair} onChange={(e) => setProfile({ ...profile, percent_repair: e.target.value })} />
                </div>
                <div>
                  <label className="label">درصد از قطعات</label>
                  <input type="number" min={0} max={100} className="input num" dir="ltr" value={profile.percent_parts} onChange={(e) => setProfile({ ...profile, percent_parts: e.target.value })} />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!profile.percent_only_labor} onChange={(e) => setProfile({ ...profile, percent_only_labor: e.target.checked ? 1 : 0 })} />
                  پورسانت فقط از خدمات تعمیر (بدون سهم فروش قطعات)
                </label>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-500">پورسانت تعمیرکار فقط بعد از تحویل نهایی دستگاه به مشتری محاسبه می‌شود.</p>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.is_active===1} disabled={busy} onChange={event=>setProfile({...profile,is_active:event.target.checked?1:0})}/>محاسبهٔ پورسانت برای تحویل‌های جدید فعال باشد</label>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setProfileFor(null)}>انصراف</button>
          <button className="btn-primary" disabled={busy} onClick={saveProfile}>ذخیره</button>
        </div>
      </Modal>

      {/* مودال کسر حقوق */}
      <Modal open={!!dedFor} onClose={() => setDedFor(null)} title={`ثبت کسر حقوق — ${dedFor?.name ?? ""}`}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">مبلغ (تومان)</label>
            <input className="input num" dir="ltr" value={ded.amount} onChange={(e) => setDed({ ...ded, amount: e.target.value })} />
          </div>
          <div>
            <label className="label">دلیل</label>
            <SearchableSelect className="input" value={ded.reason} onChange={(e) => setDed({ ...ded, reason: e.target.value })}>
              <option value="absence">غیبت</option>
              <option value="late">تأخیر در حضور</option>
              <option value="violation">تخلف</option>
              <option value="mistake">اشتباه عملیاتی</option>
              <option value="other">سایر</option>
            </SearchableSelect>
          </div>
          <div>
            <label className="label">تاریخ</label>
            <JalaliDatePicker value={ded.date} onChange={value=>setDed({...ded,date:value})}/>
          </div>
          <div>
            <label className="label">یادداشت</label>
            <input className="input" value={ded.notes} onChange={(e) => setDed({ ...ded, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setDedFor(null)}>انصراف</button>
          <button className="btn-primary" disabled={busy} onClick={saveDeduction}>ثبت کسر</button>
        </div>
      </Modal>
    </>
  );
}
