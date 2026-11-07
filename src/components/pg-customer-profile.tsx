import Link from 'next/link';
import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {loadPostgresIdentity} from '@/lib/db/pg-app-auth';
import {PostgresCustomersRepository} from '@/lib/db/pg-customers';
import {postgresCookieBranch} from '@/lib/db/pg-branch';
import {HttpError} from '@/lib/http-error';
import {customerTypeFa} from '@/lib/customer-type';
import {CustomerProfileActions} from '@/app/customers/[id]/customer-actions';
import {hasPerm} from '@/lib/perms-shared';
import {postgresCustomerMergeHistory} from '@/lib/db/pg-customer-merge';
import {postgresRelation} from '@/lib/db/postgres-auth';
import {fmtDateTime,toFaDigits} from '@/lib/format';

/** Native contact/profile controls. Financial totals remain explicitly pending
 * until the complete customer statement/cutover workflow is certified. */
export async function PostgresCustomerProfile({id,historyPage=1}:{id:number;historyPage?:number}){
 const store=await cookies(),token=store.get('repaid_session')?.value,{database,schema}=await readyApplicationPostgres(),identity=await loadPostgresIdentity(database,schema,token);
 if(!identity)redirect('/login');
 const branch=await postgresCookieBranch(database,schema,identity.session,store.get('repaid_branch')?.value);
 let customer:Record<string,unknown>;
 try{customer=await new PostgresCustomersRepository(database,schema).get(token,branch,id);}catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))notFound();throw error;}
 const name=[customer.first_name,customer.last_name].filter(Boolean).join(' ')||String(customer.company??customer.code);
 const access=(await database.query(`SELECT COUNT(*) n FROM ${postgresRelation(schema,'customer_branch_access')} WHERE customer_id=$1`,[id])).rows[0];
 const sharedLegacy=customer.branch_id==null&&Number(access.n)>1,manager=['owner','admin'].includes(identity.session.user.role);
 const canEdit=hasPerm(identity.permissions,'customers.edit')&&(!sharedLegacy||manager&&branch!=null);
 const history=await postgresCustomerMergeHistory(database,schema,token,branch,id,historyPage);
 return <div className="mx-auto max-w-7xl p-4 sm:p-6">
  <div className="page-head"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h1 className="page-title break-words">{name}</h1><p className="page-sub">{String(customer.code)} · {customerTypeFa(String(customer.customer_type))}</p></div><CustomerProfileActions customerId={id} canEdit={canEdit} canMerge={customer.branch_id!=null} profile={customer} branchId={customer.branch_id==null?undefined:Number(customer.branch_id)}/><Link href="/customers" className="btn-secondary">بازگشت به مشتریان</Link></div>{sharedLegacy&&<p className="mt-3 text-sm text-zinc-500">نمایهٔ قدیمی مشترک است؛ ویرایش فقط برای مدیر شرکت با انتخاب شعبه انجام می‌شود.</p>}</div>
  <div className="grid gap-4 md:grid-cols-2">
   <section className="card card-pad min-w-0"><h2 className="font-semibold mb-4">اطلاعات مشتری</h2><dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[['موبایل','mobile'],['ایمیل','email'],['شرکت','company'],['شهر','city'],['نشانی','address'],['توضیحات','notes']].map(([label,key])=><div key={key} className="min-w-0"><dt className="text-sm text-zinc-500">{label}</dt><dd className="mt-1 break-words" dir={['mobile','email'].includes(key)?'ltr':undefined}>{String(customer[key]??'—')}</dd></div>)}</dl></section>
   <section className="card card-pad min-w-0"><h2 className="font-semibold mb-4">وضعیت مالی</h2><span className="badge-amber">در انتظار تطبیق مالی</span><p className="mt-3 text-sm text-zinc-500">مانده و عملیات مالی پس از تکمیل اتصال اسناد مالی قابل تأیید هستند.</p></section>
  </div>
  <section className="card card-pad mt-4 min-w-0"><h2 className="mb-3 font-semibold">سوابق اصلی و ادغام مشخصات</h2><p className="mb-4 text-sm leading-7 text-zinc-500">شناسهٔ مشتری و ثبت‌کنندهٔ هر رویداد اصلی حفظ شده‌اند؛ ادغام مشخصات، اسناد مالی را جابه‌جا نمی‌کند.</p>
   {!history.merges.length&&!history.events.length?<p className="text-sm text-zinc-500">هنوز رویدادی برای نمایش وجود ندارد.</p>:<div className="space-y-3">{history.merges.map(merge=><div key={'merge-'+merge.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700"><span className="break-words">نمایهٔ {toFaDigits(merge.merged_id)} به مشخصات {toFaDigits(merge.master_id)} پیوند داده شد.</span><time className="text-xs text-zinc-500">{fmtDateTime(String(merge.created_at))}</time></div>)}{history.events.map(event=><div key={'event-'+String(event.id)} className="min-w-0 border-r-2 border-zinc-200 pr-3 dark:border-zinc-700"><p className="break-words text-sm">{String(event.title??'رویداد ثبت‌شده')}</p><p className="mt-1 break-words text-xs text-zinc-500">مشتری اصلی {toFaDigits(String(event.customer_id))} · ثبت‌کننده {event.user_id==null?'سامانه':toFaDigits(String(event.user_id))} · {fmtDateTime(String(event.created_at))}</p></div>)}</div>}
   {(historyPage>1||history.hasMore||history.eventsHasMore)&&<nav aria-label="صفحه‌بندی سوابق مشتری" className="mt-4 flex flex-wrap items-center justify-between gap-2">{historyPage>1?<Link className="btn-secondary btn-sm" href={'/customers/'+id+'?historyPage='+(historyPage-1)}>صفحهٔ قبل</Link>:<span/>}<span className="text-sm text-zinc-500">صفحهٔ {toFaDigits(historyPage)}</span>{(history.hasMore||history.eventsHasMore)&&<Link className="btn-secondary btn-sm" href={'/customers/'+id+'?historyPage='+(historyPage+1)}>صفحهٔ بعد</Link>}</nav>}
  </section>
 </div>;
}
