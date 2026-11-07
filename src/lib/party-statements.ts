import type { DatabaseSync } from 'node:sqlite';
import { SETTLED_PAYMENT } from '@/lib/payment-state';
import { readSnapshot } from '@/lib/db/transaction';
import { HttpError } from '@/lib/api';
export type StatementRow={key:string;day:string;title:string;detail:string;debit:number;credit:number;balance:number;href:string};
/** One source per obligation/cash movement. Pending cheques never settle a
 * statement. Original invoices and separate credit/reversal rows retain history. */
export function partyStatement(db:DatabaseSync,type:'customer'|'supplier',id:number,branch:number|null,from='',to='9999-12-31',page=1){
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحهٔ صورتحساب معتبر نیست.');
 const party=type==='customer'?'customer_id':'supplier_id',direction=type==='customer'?'in':'out';
 const events=`WITH events AS (
  SELECT 'invoice-'||i.id key,substr(COALESCE(i.date,i.created_at),1,10) day,'فاکتور '||i.number title,'اصل سند' detail,i.total debit,0 credit,'/invoices/'||i.id href
  FROM invoices i WHERE i.${party}=:party AND ${type==='customer'?"i.type!='purchase'":"i.type='purchase'"} AND i.status NOT IN ('draft','cancelled') AND (:branch IS NULL OR i.branch_id=:branch)
  ${type==='customer'?`UNION ALL SELECT 'sale-'||s.id,substr(s.created_at,1,10),'فروش '||s.number,'سند فروش صندوق',s.total,0,'/sales/'||s.id FROM sales s WHERE s.customer_id=:party AND s.status!='cancelled'
   AND (:branch IS NULL OR s.branch_id=:branch) AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))`:''}
  UNION ALL SELECT 'payment-'||p.id,substr(CASE WHEN p.method IN ('check','cheque') THEN (SELECT settled_at FROM checks WHERE payment_id=p.id) ELSE p.created_at END,1,10),'تسویه '||p.number,'سند وجه تسویه‌شده',0,p.amount,CASE WHEN p.invoice_id IS NULL THEN '/payments' ELSE '/invoices/'||p.invoice_id END
  FROM payments p WHERE p.${party}=:party AND p.direction='${direction}' AND ${SETTLED_PAYMENT} AND (:branch IS NULL OR p.branch_id=:branch)
  UNION ALL SELECT 'refund-'||r.id,substr(r.created_at,1,10),'استرداد '||r.number,COALESCE(r.reason,''),r.amount,0,'/payments'
  FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.${party}=:party AND p.direction='${direction}' AND ${SETTLED_PAYMENT} AND (:branch IS NULL OR r.branch_id=:branch)
  UNION ALL SELECT 'credit-'||n.id,j.posting_date,'اعتبارنامه '||n.number,n.reason,0,n.amount,'/returns?return_id='||n.return_id
  FROM credit_notes n JOIN accounting_journals j ON j.id=n.journal_id WHERE n.${party}=:party AND n.status IN ('posted','reversed') AND (:branch IS NULL OR n.branch_id=:branch)
  UNION ALL SELECT 'credit-reversal-'||n.id,j.posting_date,'برگشت اعتبارنامه '||n.number,j.memo,n.amount,0,'/returns?return_id='||n.return_id
  FROM credit_notes n JOIN accounting_journals j ON j.id=n.reversal_id WHERE n.${party}=:party AND n.status='reversed' AND (:branch IS NULL OR n.branch_id=:branch)
  ${type==='customer'?`UNION ALL SELECT 'installment-allocation-'||a.id,substr(a.created_at,1,10),'تخصیص رسید '||p.number,'تخصیص به قسط؛ بدون دریافت وجه جدید',0,0,'/invoices/'||i.invoice_id||'#installments'
   FROM installment_allocations a JOIN payments p ON p.id=a.payment_id JOIN installments i ON i.id=a.installment_id WHERE i.customer_id=:party AND (:branch IS NULL OR a.branch_id=:branch)
   UNION ALL SELECT 'installment-allocation-reversal-'||r.id,substr(r.created_at,1,10),'برگشت تخصیص رسید '||p.number,r.reason,0,0,'/invoices/'||i.invoice_id||'#installments'
   FROM installment_allocation_reversals r JOIN installment_allocations a ON a.id=r.allocation_id JOIN payments p ON p.id=a.payment_id JOIN installments i ON i.id=a.installment_id WHERE i.customer_id=:party AND (:branch IS NULL OR a.branch_id=:branch)`:''}
 ${type==='customer'?`UNION ALL SELECT 'customer-credit-'||o.id,o.posting_date,CASE WHEN o.kind='allocation' THEN 'تخصیص اعتبار موجود' ELSE 'برگشت تخصیص اعتبار' END,o.reason,0,0,'/payments/credit?customer_id='||o.customer_id
 FROM customer_credit_operations o WHERE o.customer_id=:party AND o.state='posted' AND (:branch IS NULL OR o.branch_id=:branch)`:''}
 )`;
 return readSnapshot(db,()=>{const params={party:id,branch,from,to};
  const totals=db.prepare(`${events} SELECT COALESCE(SUM(CASE WHEN day<:from THEN debit-credit ELSE 0 END),0) opening,
   COALESCE(SUM(CASE WHEN day>=:from AND day<=:to THEN debit ELSE 0 END),0) debit,COALESCE(SUM(CASE WHEN day>=:from AND day<=:to THEN credit ELSE 0 END),0) credit,
   COUNT(CASE WHEN day>=:from AND day<=:to THEN 1 END) count FROM events`).get(params)!;
  const rows=db.prepare(`${events}, running AS(SELECT *,SUM(debit-credit) OVER(ORDER BY day,key ROWS UNBOUNDED PRECEDING) balance FROM events)
   SELECT * FROM running WHERE day>=:from AND day<=:to ORDER BY day,key LIMIT 100 OFFSET :offset`).all({...params,offset:(page-1)*100}) as unknown as StatementRow[];
  for(const n of [totals.opening,totals.debit,totals.credit,...rows.map(r=>r.balance)])if(!Number.isSafeInteger(n))throw new HttpError(409,'ماندهٔ صورتحساب خارج از محدودهٔ صحیح است؛ سند فاقد تاریخ یا مبلغ نامعتبر را بررسی کنید.');
  const opening=Number(totals.opening),debit=Number(totals.debit),credit=Number(totals.credit),closing=opening+debit-credit;
  if(!Number.isSafeInteger(closing))throw new HttpError(409,'ماندهٔ صورتحساب از محدودهٔ مجاز بیشتر است.');
  return {rows,opening,closing,totals:{debit,credit},page,totalPages:Math.max(1,Math.ceil(Number(totals.count)/100)),currency:'IRR',basis:'original_documents_with_posted_adjustments_and_verified_settlements'};
 });
}
