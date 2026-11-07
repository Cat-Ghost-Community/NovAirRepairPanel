"use client";
import { InstallmentSettlement } from '@/components/installment-settlement';
import { InstallmentAgreement } from '@/components/installment-agreement';
import { fmtMoney,fmtDate,faNum } from '@/lib/format';
type Inst={id:number;seq:number;amount:number;paid_amount:number;due_date:string;status:string;legacy_review:number};
const labels:Record<string,string>={pending:'در انتظار',partially_paid:'پرداخت جزئی',paid:'تسویه با رسید',overdue:'سررسید گذشته',legacy_review:'نیازمند بررسی سابقه'};
export function InstallmentsPanel({invoiceId,balance,installments,canManage=false,canReceive=false,canViewHistory=false}:{invoiceId:number;balance:number;installments:Inst[];canManage?:boolean;canReceive?:boolean;canViewHistory?:boolean}){
 return <section className="card card-pad space-y-4" id="installments"><h2 className="section-title">اقساط فاکتور</h2><p className="text-sm text-zinc-500">ماندهٔ فاکتور از اسناد معتبر: {fmtMoney(Math.max(0,balance),'rial')}؛ قسط فقط با تخصیص رسیدِ تسویه‌شده پرداخت محسوب می‌شود.</p>
  {!installments.length?<p className="text-sm text-zinc-500">قسط فعالی برای این نسخه ثبت نشده است؛ توافق‌ها و پیشنهادها در پایین محفوظ‌اند.</p>:<div className="space-y-2">{installments.map(i=><div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800" key={i.id}><span className="badge-gray">قسط {faNum(i.seq)}</span><span>{fmtDate(i.due_date)}</span><span className="font-medium">{fmtMoney(i.amount-i.paid_amount)}</span><span className={i.legacy_review?'badge-amber':i.status==='paid'?'badge-green':'badge-gray'}>{labels[i.status]}</span>{canManage&&!i.legacy_review&&i.amount>i.paid_amount&&<InstallmentSettlement id={i.id} invoiceId={invoiceId} remaining={i.amount-i.paid_amount} canReceive={canReceive}/>}</div>)}</div>}
  {canViewHistory?<InstallmentAgreement key={installments.map(i=>`${i.id}:${i.paid_amount}:${i.status}`).join('|')} invoiceId={invoiceId} canManage={canManage}/>:<p className="text-sm text-zinc-500">بازبینی توافق‌ها نیازمند دسترسی مالی است.</p>}
 </section>;
}
