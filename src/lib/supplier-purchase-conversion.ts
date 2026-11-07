import type {DatabaseSync} from 'node:sqlite';import type {Session} from '@/lib/auth';
import {HttpError,requirePerm,validate,auditRecord} from '@/lib/api';import {ledgerScope,accountingDate} from '@/lib/accounting';
import {atomic} from '@/lib/db/transaction';import {nextSeq} from '@/lib/db/schema';
import {multiplyRial,percentRial,sumRial,quantityValue,quantityMicro} from '@/lib/money';import {taxRatePct} from '@/lib/finance';
/** A purchase order is a commitment, not another inventory receipt or payable. */
export function convertSupplierPurchaseList(db:DatabaseSync,session:Session,supplierId:number,branch:number,input:{expected_date?:unknown;expected_total?:unknown}={}){
 requirePerm(session,'purchasing.manage');ledgerScope(session,branch,null,'purchasing.manage');validate.id(supplierId);
 const expected=input.expected_date==null?null:accountingDate(String(input.expected_date));
 return atomic(db,()=>{
  if(!db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplierId))throw new HttpError(404,'تأمین‌کننده یافت نشد.');
  const items=db.prepare(`SELECT i.id,i.part_id,i.name,i.qty,i.est_cost,p.is_active,p.quantity_precision FROM supplier_purchase_items i
    LEFT JOIN parts p ON p.id=i.part_id WHERE i.supplier_id=? AND i.branch_id=? AND i.po_id IS NULL AND i.status IN ('pending','ordered')
    ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,i.id LIMIT 201`).all(supplierId,branch);
  if(!items.length)throw new HttpError(409,'قلم بازی برای تبدیل باقی نمانده است؛ سفارش‌های قبلی را بررسی کنید.');
  if(items.length>200)throw new HttpError(409,'بیش از ۲۰۰ قلم باز است؛ فهرست را به سفارش‌های مستقل تقسیم کنید.');
  const lines=items.map(item=>{
   const qty=quantityValue(item.qty),cost=validate.amount(item.est_cost,'بهای تخمینی');if(qty<=0||qty>1000000)throw new HttpError(400,'تعداد قلم خرید معتبر نیست.');
   if(item.part_id!=null){if(item.is_active!==1)throw new HttpError(409,'یکی از کالاهای فهرست غیرفعال یا نامعتبر است.');quantityMicro(qty,Number(item.quantity_precision));}
   return {id:Number(item.id),part_id:item.part_id,name:validate.maxLength(validate.required(item.name,'نام قلم'),200,'نام قلم'),qty,cost,total:multiplyRial(cost,qty)};
  });
  const itemsTotal=sumRial(lines.map(line=>line.total)),rate=taxRatePct(),tax=percentRial(itemsTotal,rate),total=sumRial([itemsTotal,tax]);
  if(input.expected_total!=null&&validate.amount(input.expected_total)!==total)throw new HttpError(409,'جمع سفارش تغییر کرده است؛ مالیات تنظیم‌شده و اقلام را دوباره بررسی کنید.');
  const number=nextSeq('po','PO-'),id=Number(db.prepare(`INSERT INTO purchase_orders(number,supplier_id,branch_id,date,expected_date,status,items_total,discount,tax,shipping,total,notes,created_by)
    VALUES(?,?,?,?,?,'sent',?,0,?,0,?,?,?)`).run(number,supplierId,branch,new Date().toISOString().slice(0,10),expected,itemsTotal,tax,total,'ساخته‌شده از فهرست خرید؛ مالیات مطابق تنظیمات جاری',session.user.id).lastInsertRowid);
  const insert=db.prepare('INSERT INTO purchase_order_items(po_id,part_id,name,qty,unit_cost,total) VALUES(?,?,?,?,?,?)'),update=db.prepare("UPDATE supplier_purchase_items SET status='ordered',po_id=?,done_at=NULL WHERE id=? AND po_id IS NULL AND branch_id=?");
  for(const line of lines){insert.run(id,line.part_id,line.name,line.qty,line.cost,line.total);if(Number(update.run(id,line.id,branch).changes)!==1)throw new HttpError(409,'قلم هم‌زمان تغییر کرده است؛ سفارش ساخته نشد.');}
  auditRecord(db,session,'create','purchase_order',id,null,{number,total,tax_rate:rate,source_list_ids:lines.map(line=>line.id),branch_id:branch});return {id,number,count:lines.length,total};
 });
}
