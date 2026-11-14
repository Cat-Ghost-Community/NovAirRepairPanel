import type {DatabaseSync} from 'node:sqlite';
import type {Session} from './auth';
import {canForUser} from './auth';
import {HttpError,requirePerm,auditRecord} from './api';
import {atomic} from './db/transaction';
import {requireRepairAccess} from './repair-access';
import {getStatuses,transitionTicket} from './repair';
import {signatureValidationError} from './signature-validation';
import {DELIVERY_CONSENT} from './delivery-signature-shared';

function deliverable(db:DatabaseSync,id:number){
 const row=db.prepare('SELECT * FROM repair_tickets WHERE id=?').get(id);
 if(!row)throw new HttpError(404,'پذیرش یافت نشد.');
 const status=getStatuses().find(item=>item.id===row.status_id);
 if(!status?.customer_visible)throw new HttpError(409,'وضعیت پذیرش برای مشتری قابل نمایش نیست؛ ابتدا تنظیم وضعیت را بررسی کنید.');
 if(status?.name!=='Delivered'&&!status?.allowed_next.includes('Delivered'))throw new HttpError(409,'این پذیرش هنوز آمادهٔ تحویل نیست.');
 return row;
}
export function requestDeliverySignature(db:DatabaseSync,session:Session,id:number,cookie?:string){return atomic(db,()=>{
 requirePerm(session,'repairs.deliver');requirePerm(session,'repairs.status');requireRepairAccess(session,id,cookie);
 const ticket=deliverable(db,id);
 if(ticket.delivery_signature)throw new HttpError(409,'امضای تحویل قبلاً ثبت شده و قابل بازنویسی نیست.');
 const existing=db.prepare('SELECT * FROM repair_delivery_requests WHERE ticket_id=?').get(id);
 if(existing&&!existing.fulfilled_at&&Number(existing.expires_at)>Date.now())return {ok:true,requested:true};
 db.prepare(`INSERT INTO repair_delivery_requests(ticket_id,requested_by,expires_at) VALUES(?,?,?)
 ON CONFLICT(ticket_id) DO UPDATE SET requested_by=excluded.requested_by,requested_at=datetime('now'),expires_at=excluded.expires_at,fulfilled_at=NULL,signed_ip=NULL,consent_text=NULL`).run(id,session.user.id,Date.now()+24*60*60*1000);
 auditRecord(db,session,'request_signature','repair_ticket',id,null,{source:'customer_tracking',branch_id:ticket.branch_id});
 return {ok:true,requested:true};
});}

export function signTrackedDelivery(db:DatabaseSync,id:number,input:Record<string,unknown>,ip:string|null){return atomic(db,()=>{
 const request=db.prepare('SELECT * FROM repair_delivery_requests WHERE ticket_id=?').get(id);
 if(!request||Number(request.expires_at)<=Date.now())throw new HttpError(409,'درخواست امضای فعال وجود ندارد؛ با تعمیرگاه تماس بگیرید.');
 const name=typeof input.signed_name==='string'?input.signed_name.trim():'';
 const signature=typeof input.signature==='string'?input.signature:'';
 if(input.consent!==true||name.length<3||name.length>120)throw new HttpError(400,'نام تحویل‌گیرنده و پذیرش مفاد رسید الزامی است.');
 const error=signatureValidationError(signature,true);if(error)throw new HttpError(400,error);
 const ticket=deliverable(db,id);
 if(ticket.delivery_signature||request.fulfilled_at){
  if(ticket.delivery_signature===signature&&ticket.delivery_signed_name===name)return {ok:true,duplicate:true};
  throw new HttpError(409,'امضای ثبت‌شده قابل بازنویسی نیست.');
 }
 const actor=db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=? AND is_active=1').get(Number(request.requested_by));
 if(!actor||!canForUser(String(actor.role),'repairs.deliver',Number(actor.id))||!canForUser(String(actor.role),'repairs.status',Number(actor.id)))throw new HttpError(403,'مجوز درخواست تحویل تغییر کرده است؛ درخواست تازه لازم است.');
 const session={user:actor} as Session;requireRepairAccess(session,id);
 transitionTicket(id,'Delivered',Number(actor.id),'تأیید تحویل و امضا توسط مشتری در صفحهٔ پیگیری');
 const signedAt=new Date().toISOString();
 db.prepare('UPDATE repair_tickets SET delivery_signature=?,delivery_signed_name=?,delivery_signed_at=?,updated_at=? WHERE id=?').run(signature,name,signedAt,signedAt,id);
 db.prepare('UPDATE repair_delivery_requests SET fulfilled_at=?,signed_ip=?,consent_text=? WHERE ticket_id=?').run(signedAt,ip,DELIVERY_CONSENT,id);
 db.prepare("INSERT INTO audit_logs(action,entity,entity_id,\"after\",branch_id) VALUES('customer_signature','repair_ticket',?,?,?)").run(id,JSON.stringify({source:'tracking',signed_name:name,requested_by:actor.id,consent:DELIVERY_CONSENT}),ticket.branch_id);
 return {ok:true,duplicate:false};
});}
