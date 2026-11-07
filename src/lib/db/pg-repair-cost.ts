import {createHash} from 'node:crypto';
import {HttpError} from '../http-error';
import {multiplyRial,quantityMicro,rial,sumRial} from '../money';
import {postgresRelation} from './postgres-auth';
import {safePostgresInteger,type PostgresDatabase} from './postgres';

type Issue={id:number;part_id:number;location_id:number;branch_id:number;qty_micro:number;ref_type:string;ref_id:number;source_line_id:number|null;amount:number;basis:'recorded_extended_cost'|'recorded_legacy_unit_cost';valuation:Record<string,unknown>|null};
function conflict(message:string):never{throw new HttpError(409,message);}
function id(value:unknown){if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='bigint')return conflict('شناسهٔ مدرک بهای قطعه معتبر نیست.');const n=safePostgresInteger(value);if(n<=0)return conflict('شناسهٔ مدرک بهای قطعه معتبر نیست.');return n;}
function money(value:unknown){try{return rial(value);}catch{return conflict('بهای ثبت‌شدهٔ گردش قطعه دقیق یا معتبر نیست؛ بهای تخمینی جایگزین نشد.');}}
function quantity(value:unknown,precision:number){try{if(typeof value!=='string'&&typeof value!=='number')return conflict('مقدار قطعه معتبر نیست.');const n=quantityMicro(String(value).replace(/^\-/,''),precision);if(n<=0)return conflict('مقدار گردش قطعه باید مثبت باشد.');return n;}catch(error){if(error instanceof HttpError)throw error;return conflict('دقت مقدار قطعه با واحد ثبت‌شده سازگار نیست.');}}

/** Source evidence, not a posting policy. Caller must authorize the original
 * ticket/branch and share this transaction with invoice finalization. A consumed
 * flag is billing state here: physical evidence always comes from movements. */
export async function actualRepairIssueCost(db:PostgresDatabase,schema:string,ticketId:number,branchId:number){
 if(!db.isTransaction())throw Error('Repair issue cost requires its authoritative transaction');
 if(!Number.isSafeInteger(ticketId)||ticketId<=0||!Number.isSafeInteger(branchId)||branchId<=0)throw new HttpError(400,'شناسهٔ پذیرش یا شعبه معتبر نیست.');
 const t=(name:string)=>postgresRelation(schema,name),ticket=(await db.query(`SELECT id,number,branch_id,customer_id,device_id FROM ${t('repair_tickets')} WHERE id=$1 AND branch_id=$2 FOR UPDATE`,[ticketId,branchId])).rows[0];
 if(!ticket)throw new HttpError(404,'پذیرش در شعبهٔ مجاز یافت نشد.');
 const returned=(await db.query(`SELECT m.id FROM ${t('inventory_movements')} m JOIN ${t('business_return_lines')} l ON l.movement_id=m.id OR (m.ref_type='business_return' AND m.ref_id=l.id) JOIN ${t('business_returns')} r ON r.id=l.return_id JOIN ${t('invoices')} i ON i.id=r.invoice_id WHERE i.ticket_id=$1 LIMIT 1`,[ticketId])).rows;
 if(returned.length)conflict('برگشت فیزیکی مرتبط وجود دارد؛ تطبیق بهای برگشت و WIP از گردش مرجوعی تأییدشده لازم است.');
 const items=(await db.query(`SELECT i.id,i.ref_id,i.qty,p.quantity_precision FROM ${t('ticket_items')} i LEFT JOIN ${t('parts')} p ON p.id=i.ref_id WHERE i.ticket_id=$1 AND i.kind='part' ORDER BY i.id LIMIT 1001`,[ticketId])).rows;
 const rows=(await db.query(`SELECT m.*,p.quantity_precision,l.branch_id location_branch,i.ticket_id linked_ticket,i.kind linked_kind,i.ref_id linked_part FROM ${t('inventory_movements')} m LEFT JOIN ${t('parts')} p ON p.id=m.part_id LEFT JOIN ${t('inventory_locations')} l ON l.id=m.location_id LEFT JOIN ${t('ticket_items')} i ON m.ref_type='ticket_item' AND i.id=m.ref_id WHERE (m.ref_type IN ('repair','ticket') AND m.ref_id=$1) OR (m.ref_type='ticket_item' AND i.ticket_id=$1) ORDER BY m.id LIMIT 1001`,[ticketId])).rows;
 if(items.length>1000||rows.length>1000)conflict('سابقهٔ بزرگ قطعات نیازمند بررسی دسته‌ای است؛ جمع ناقص محاسبه نشد.');
 const issues:Issue[]=[],seen=new Set<number>(),itemIssued=new Map<number,bigint>(),legacyByPart=new Map<number,bigint>(),policyIds=new Set<number>();
 for(const row of rows){
  const movementId=id(row.id);if(seen.has(movementId))conflict('شناسهٔ گردش قطعه تکراری است؛ بهای تکراری محاسبه نشد.');seen.add(movementId);
  if(row.quantity_precision==null||row.location_branch==null||id(row.branch_id)!==branchId||id(row.location_branch)!==branchId)conflict('مالکیت شعبه یا انبار گردش قطعه نیازمند تطبیق است.');
  if(row.type!=='repair_consumption'||!String(row.qty).startsWith('-'))conflict('گردش برگشت یا نوع خروج نامشخص نیازمند بررسی مستقل است؛ ارزش آن خودکار تهاتر نشد.');
  const precision=safePostgresInteger(row.quantity_precision),qty=quantity(row.qty,precision),part=id(row.part_id),reference=id(row.ref_id);
  if(row.ref_type==='ticket_item'){
   if(row.linked_kind!=='part'||id(row.linked_ticket)!==ticketId||id(row.linked_part)!==part)conflict('خروج قطعه با قلم اصلی پذیرش تطبیق ندارد.');
   itemIssued.set(reference,(itemIssued.get(reference)??BigInt(0))+BigInt(qty));
  }else legacyByPart.set(part,(legacyByPart.get(part)??BigInt(0))+BigInt(qty));
  let amount:number,basis:Issue['basis'];
  if(row.extended_cost!=null){amount=money(row.extended_cost);basis='recorded_extended_cost';}
  else{if(row.unit_cost==null||row.valuation_json!=null)conflict('بهای واقعی گردش قطعه موجود نیست؛ قیمت تخمینی قلم یا میانگین فعلی استفاده نشد.');try{amount=multiplyRial(money(row.unit_cost),String(row.qty).replace(/^-/,''));}catch{conflict('بهای ثبت‌شدهٔ خروج قطعه از محدودهٔ دقیق پشتیبانی‌شده بیشتر است.');}basis='recorded_legacy_unit_cost';}
  let valuation:Record<string,unknown>|null=null;
  if(row.valuation_json!=null){
   try{const proof:unknown=JSON.parse(String(row.valuation_json));if(!proof||typeof proof!=='object'||Array.isArray(proof))throw Error('Invalid proof');valuation=proof as Record<string,unknown>;}catch{conflict('مدرک ارزش دفتری گردش قطعه معتبر نیست.');}
   if(valuation.method!=='location_carrying_v1'||money(valuation.amount)!==amount||money(valuation.before_value)-money(valuation.after_value)!==amount||!Number.isSafeInteger(valuation.before_qty_micro)||!Number.isSafeInteger(valuation.after_qty_micro)||Number(valuation.before_qty_micro)-Number(valuation.after_qty_micro)!==qty||!Number.isSafeInteger(valuation.policy_id)||Number(valuation.policy_id)<=0)conflict('مبلغ یا تعداد گردش با مدرک ارزش دفتری اصلی سازگار نیست.');
   policyIds.add(Number(valuation.policy_id));
  }
  issues.push({id:movementId,part_id:part,location_id:id(row.location_id),branch_id:branchId,qty_micro:qty,ref_type:String(row.ref_type),ref_id:reference,source_line_id:row.source_line_id==null?null:id(row.source_line_id),amount,basis,valuation});
 }
 if(policyIds.size){const policies=await db.query(`SELECT id FROM ${t('accounting_recognition_policies')} WHERE id=ANY($1::bigint[]) AND branch_id=$2 AND kind='inventory_carrying_v1'`,[[...policyIds],branchId]);if(policies.rowCount!==policyIds.size)conflict('سیاست ثبت‌شده در مدرک ارزش دفتری برای این شعبه یافت نشد.');}
 const unresolved=new Map<number,bigint>(),itemEvidence:{id:number;part_id:number;qty_micro:number}[]=[];
 for(const item of items){
  if(item.quantity_precision==null||item.ref_id==null)conflict('مرجع قطعهٔ اصلی پذیرش موجود نیست.');
  const itemId=id(item.id),part=id(item.ref_id),qty=quantity(item.qty,safePostgresInteger(item.quantity_precision)),issued=itemIssued.get(itemId)??BigInt(0);
  if(issued!==BigInt(0)&&issued!==BigInt(qty))conflict('مقدار خروج واقعی با قلم پذیرش تطبیق ندارد؛ خروج ناقص یا تکراری نیازمند اصلاح است.');
  if(issued===BigInt(0))unresolved.set(part,(unresolved.get(part)??BigInt(0))+BigInt(qty));
  itemEvidence.push({id:itemId,part_id:part,qty_micro:qty});
 }
 for(const [part,qty]of unresolved)if((legacyByPart.get(part)??BigInt(0))!==qty)conflict('قلم قطعه فاقد خروج واقعیِ قابل تطبیق است؛ هزینهٔ صوری از قیمت قلم محاسبه نشد.');
 let amount:number;try{amount=sumRial(issues.map(issue=>issue.amount));}catch{conflict('جمع بهای مستند قطعات از محدودهٔ دقیق پشتیبانی‌شده بیشتر است.');}
 const snapshot={version:'repair_issue_cost_v1',ticket:{id:ticketId,number:String(ticket.number),branch_id:branchId,customer_id:id(ticket.customer_id),device_id:id(ticket.device_id)},items:itemEvidence,movements:issues};
 return {amount,cost:amount,movement_ids:issues.map(issue=>issue.id),ticket_item_ids:itemEvidence.map(item=>item.id),requires_accounting_review:issues.some(issue=>issue.ref_type!=='ticket_item'||issue.valuation==null),snapshot,source_hash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
