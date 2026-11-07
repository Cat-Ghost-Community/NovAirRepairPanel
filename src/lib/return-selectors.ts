import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '@/lib/auth';
import { HttpError,validate } from '@/lib/api';
import { ledgerScope } from '@/lib/accounting';
import { SETTLED_PAYMENT } from '@/lib/payment-state';

/** Bounded, branch-scoped selectors; identifiers are never interpolated from input. */
export function returnSelector(db:DatabaseSync,session:Session,branch:number|null,cookie:string|null|undefined,q:URLSearchParams){
 const entity=q.get('entity'),search=q.get('q')?.trim()??'',page=Number(q.get('page')??1);
 if(search.length>100||!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'جست‌وجو یا صفحه معتبر نیست.');
 let from:string,where:string,label:string,amount='NULL',extra:Record<string,string|number|null>={};
 if(entity==='payment'||entity==='location'){
  const doc=db.prepare('SELECT invoice_id,branch_id FROM business_returns WHERE id=?').get(validate.id(q.get('return_id')));
  if(!doc)throw new HttpError(404,'مرجوعی یافت نشد.');ledgerScope(session,Number(doc.branch_id),cookie,'invoices.view');branch=Number(doc.branch_id);
  if(entity==='payment'){
   from='payments p';label='p.number';amount='p.amount-COALESCE((SELECT SUM(amount) FROM refunds WHERE payment_id=p.id),0)';
   where=`p.invoice_id=:invoice AND p.branch_id=:branch AND p.direction=CASE (SELECT type FROM invoices WHERE id=:invoice) WHEN 'purchase' THEN 'out' ELSE 'in' END AND ${SETTLED_PAYMENT} AND p.number LIKE :q`;extra={invoice:Number(doc.invoice_id)};
  }else{from='inventory_locations p';label='p.name';where='p.branch_id=:branch AND p.name LIKE :q';}
 }else if(entity==='invoice'){
  from='effective_invoices p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN suppliers s ON s.id=p.supplier_id';
  label="p.number||' · '||COALESCE(c.first_name,s.name,'')";amount='p.total';
  where="p.branch_id IS NOT NULL AND (:branch IS NULL OR p.branch_id=:branch) AND p.status NOT IN ('draft','cancelled') AND p.stock_posted=1 AND (p.number LIKE :q OR c.first_name LIKE :q OR c.last_name LIKE :q OR s.name LIKE :q)";
 }else if(entity==='customer'){
  from='customers p';label="p.first_name||' '||COALESCE(p.last_name,'')";
  where="(:branch IS NULL OR p.branch_id=:branch OR EXISTS(SELECT 1 FROM invoices i WHERE i.customer_id=p.id AND i.branch_id=:branch)) AND (p.first_name LIKE :q OR p.last_name LIKE :q)";
 }else if(entity==='supplier'){
  // Suppliers are a shared business catalogue; no balances or bank data here.
  from='suppliers p';label='p.name';where='(:branch IS NULL OR :branch IS NOT NULL) AND p.name LIKE :q';
 }else throw new HttpError(400,'نوع انتخاب معتبر نیست.');
 const params={branch,q:`%${search}%`,...extra};
 const total=Number(db.prepare(`SELECT COUNT(*) n FROM ${from} WHERE ${where}`).get(params)!.n);
 const options=db.prepare(`SELECT p.id,${label} label,${amount} amount FROM ${from} WHERE ${where} ORDER BY p.id DESC LIMIT 50 OFFSET :offset`).all({...params,offset:(page-1)*50});
 return {options,page,total,totalPages:Math.max(1,Math.ceil(total/50))};
}
