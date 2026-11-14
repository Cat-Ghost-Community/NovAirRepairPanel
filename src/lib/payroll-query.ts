import {HttpError} from './http-error';

export type PayrollQuery={employee:number|null;from:string;to:string;status:string;page:number};
export function payrollQuery(input:Record<string,string|undefined>):PayrollQuery{
 const day=(value:string|undefined)=>{
  if(!value)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new HttpError(400,'تاریخ گزارش معتبر نیست.');
  return value;
 };
 const from=day(input.from),to=day(input.to),employee=input.employee?Number(input.employee):null,page=input.runPage?Number(input.runPage):1,status=input.status??'';
 if(from&&to&&from>to)throw new HttpError(400,'ابتدای بازه نباید پس از پایان آن باشد.');
 if(employee!==null&&(!Number.isSafeInteger(employee)||employee<1)||!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'کارمند یا صفحهٔ گزارش معتبر نیست.');
 if(!['','pending','approved','partially_paid','paid','cancelled'].includes(status))throw new HttpError(400,'وضعیت گزارش معتبر نیست.');
 return {employee,from,to,status,page};
}
export function payrollRunFilter(query:PayrollQuery){
 const clauses:string[]=[],params:(number|string)[]=[];
 if(query.employee!==null){clauses.push('r.user_id=?');params.push(query.employee);}
 if(query.from){clauses.push('date(r.period_from)>=?');params.push(query.from);}
 if(query.to){clauses.push('date(r.period_from)<=?');params.push(query.to);}
 if(query.status){clauses.push('r.status=?');params.push(query.status);}
 return {sql:clauses.length?' AND '+clauses.join(' AND '):'',params};
}
export const CANCELLABLE_COMMISSION_SQL=`r.status='pending' AND r.paid_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM commission_approvals WHERE run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM commission_payments WHERE run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM commission_corrections WHERE run_id=r.id AND state!='rejected')
 AND NOT EXISTS(SELECT 1 FROM accounting_events event JOIN accounting_event_reviews review ON review.event_id=event.id WHERE event.source_type='commission' AND event.source_id=CAST(r.id AS TEXT))`;
