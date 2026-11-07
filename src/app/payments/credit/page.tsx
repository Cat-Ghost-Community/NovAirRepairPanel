import Link from 'next/link';
import {cookies} from 'next/headers';
import {getDb} from '@/lib/db/schema';
import {requirePageAccess} from '@/lib/page-access';
import {activeBranch,BRANCH_COOKIE} from '@/lib/branch';
import {EmptyState} from '@/components/ui';
import {Pagination} from '@/components/pagination';
import {resolvePaging} from '@/lib/pagination';
import {canUser} from '@/lib/auth';
import {CustomerCreditClient} from './credit-client';
export const dynamic='force-dynamic';

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const session=await requirePageAccess('/finance'),cookieStore=await cookies(),scope=activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value),db=getDb(),q=await searchParams;
 const customer=Number(q.customer_id),search=(q.q??'').trim().slice(0,100);
 const branches=db.prepare(`SELECT id,name FROM branches WHERE is_active=1 ${scope.all?'':'AND id=?'} ORDER BY id`).all(...(scope.all?[]:[scope.branchId])) as {id:number;name:string}[];
 if(Number.isSafeInteger(customer)&&customer>0){
  const row=db.prepare(`SELECT c.id,c.first_name,c.last_name,c.branch_id FROM customers c WHERE c.id=? AND EXISTS(SELECT 1 FROM payments p WHERE p.customer_id=c.id ${scope.all?'':'AND p.branch_id=?'} UNION ALL SELECT 1 FROM invoices i WHERE i.customer_id=c.id ${scope.all?'':'AND i.branch_id=?'})`).get(customer,...(scope.all?[]:[scope.branchId,scope.branchId]));
  if(!row)return <div className="p-4 sm:p-6"><EmptyState title="سابقهٔ مالی مشتری در شعبهٔ مجاز یافت نشد" body="مشتری دیگری را از فهرست انتخاب کنید." action={<Link className="btn-secondary" href="/payments/credit">فهرست مشتریان</Link>}/></div>;
  const branch=scope.branchId??(branches.some(b=>b.id===row.branch_id)?Number(row.branch_id):branches[0]?.id);
  return <CustomerCreditClient key={customer+':'+scope.branchId} customer={{id:customer,name:`${row.first_name} ${row.last_name??''}`}} branches={branches.map(b=>({id:b.id,name:b.name}))} initialBranch={branch??0} canManage={canUser(session,'finance.manage')}/>;
 }
 const where=`EXISTS(SELECT 1 FROM payments p WHERE p.customer_id=c.id ${scope.all?'':'AND p.branch_id=:branch'} UNION ALL SELECT 1 FROM invoices i WHERE i.customer_id=c.id ${scope.all?'':'AND i.branch_id=:branch'}) AND (c.first_name||' '||COALESCE(c.last_name,'') LIKE :q OR c.mobile LIKE :q)`;
 const params={q:`%${search}%`,...(scope.all?{}:{branch:scope.branchId})};
 const total=Number(db.prepare(`SELECT COUNT(*) n FROM customers c WHERE ${where}`).get(params)!.n),paging=resolvePaging(q,total);
 const rows=db.prepare(`SELECT c.id,c.first_name,c.last_name,c.mobile FROM customers c WHERE ${where} ORDER BY c.id DESC LIMIT :limit OFFSET :offset`).all({...params,limit:paging.perPage,offset:paging.offset});
 return <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6"><div><h1 className="page-title">اعتبار مشتریان</h1><p className="page-sub">تخصیص موجودی قطعی، برگشت تخصیص و استرداد مستند؛ بدون دریافت وجه دوباره.</p></div><form className="card card-pad flex flex-wrap gap-2"><label className="min-w-0 flex-1"><span className="sr-only">جستجوی مشتری</span><input className="input" name="q" defaultValue={search} placeholder="نام یا موبایل مشتری…"/></label><button className="btn-primary">جستجو</button></form>
 <div className="card">{rows.length?<ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map(row=><li key={Number(row.id)}><Link className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-zinc-800" href={'/payments/credit?customer_id='+row.id}><span>{String(row.first_name)} {String(row.last_name??'')}</span><span className="text-sm text-brand-600">مدیریت اعتبار</span></Link></li>)}</ul>:<EmptyState title="مشتری دارای سابقهٔ مالی یافت نشد" body="عبارت جستجو یا شعبهٔ انتخابی را بررسی کنید."/>}<Pagination base="/payments/credit" sp={q} {...paging} total={total} unit="مشتری"/></div></div>;
}
