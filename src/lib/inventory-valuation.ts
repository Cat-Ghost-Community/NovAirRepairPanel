import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from '@/lib/api';
import { quantityMicro,rial,multiplyRial,carryingShareRial,sumRial } from '@/lib/money';

type Pool={method:'location_carrying_v1';policy_id:number;qty_micro:number;value:number;used_micro:number;used_value:number};
export function carryingPolicy(db:DatabaseSync,branch:number){return db.prepare("SELECT id FROM accounting_recognition_policies WHERE branch_id=? AND kind='inventory_carrying_v1' AND status='approved' AND effective_date<=date('now')").get(branch);}
/** Existing nonempty positions are never guessed into a new valuation policy.
 * A genuinely empty warehouse position may begin at proven zero prospectively. */
export function planCarryingMovement(db:DatabaseSync,input:{branch:number;qty:number;unitCost:number;currentQty:number;currentValue:unknown;state:unknown;extended?:number}){
 const policy=carryingPolicy(db,input.branch);if(!policy){if(input.currentValue!=null||input.state!=null)throw new HttpError(409,'سیاست ارزش‌گذاری این موجودی غیرفعال است؛ ادامه با روش قدیمی مجاز نیست.');return null;}
 const beforeQty=quantityMicro(input.currentQty),qty=quantityMicro(Math.abs(input.qty));
 if(input.currentValue==null&&beforeQty!==0)throw new HttpError(409,'موجودی قبلی این انبار به افتتاحیهٔ ارزش‌گذاریِ مستند و تأیید مستقل نیاز دارد؛ ارزش فرضی ساخته نشد.');
 const before=input.currentValue==null?0:rial(input.currentValue),old:Pool=input.state==null?{method:'location_carrying_v1',policy_id:Number(policy.id),qty_micro:0,value:0,used_micro:0,used_value:0}:JSON.parse(String(input.state));
 if(old.method!=='location_carrying_v1'||old.qty_micro-old.used_micro!==beforeQty||old.value-old.used_value!==before||[old.qty_micro,old.used_micro,old.value,old.used_value].some(n=>!Number.isSafeInteger(n)||n<0))throw new HttpError(409,'تعداد و ارزش دفتری با سابقهٔ گردش تطبیق ندارند؛ بررسی لازم است.');
 let amount:number,next:Pool;
 if(input.qty>0){amount=input.extended==null?multiplyRial(input.unitCost,input.qty):rial(input.extended);next={method:old.method,policy_id:Number(policy.id),qty_micro:beforeQty+qty,value:sumRial([before,amount]),used_micro:0,used_value:0};}
 else{
  if(qty>beforeQty)throw new HttpError(409,'مقدار خروج از موجودی انبار بیشتر است.');
  amount=carryingShareRial(old.value,old.used_micro+qty,old.qty_micro)-old.used_value;
  if(input.extended!=null&&input.extended!==amount)throw new HttpError(409,'بهای خروج با ارزش دفتری و باقیماندهٔ مستند سازگار نیست؛ تعدیل مصوب لازم است.');
  next={...old,policy_id:Number(policy.id),used_micro:old.used_micro+qty,used_value:old.used_value+amount};
 }
 const after=next.value-next.used_value;if(!Number.isSafeInteger(next.qty_micro)||after<0)throw new HttpError(409,'ماندهٔ ارزش‌گذاری از محدودهٔ مجاز خارج است.');
 return {amount,after,state:JSON.stringify(next),proof:{method:old.method,policy_id:Number(policy.id),before_qty_micro:beforeQty,after_qty_micro:next.qty_micro-next.used_micro,before_value:before,after_value:after,amount,pool_before:old,pool_after:next}};
}

export function originalMovementCost(db:DatabaseSync,invoice:number,line:number){
 const row=db.prepare("SELECT extended_cost,qty,valuation_json FROM inventory_movements WHERE ref_type='invoice' AND ref_id=? AND source_line_id=? AND type='sale'").get(invoice,line);
 return row?.valuation_json!=null?{amount:rial(row.extended_cost),qty_micro:quantityMicro(Math.abs(Number(row.qty)))}:null;
}
