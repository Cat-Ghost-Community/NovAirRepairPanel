import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '@/lib/auth';
import { auditRecord,HttpError,requirePerm,validate } from '@/lib/api';
import { ledgerScope,reverseJournal,postAutomaticFinancialEvent } from '@/lib/accounting';
import { atomic } from '@/lib/db/transaction';
import { nextSeq } from '@/lib/db/schema';
import { addQuantity,weightedAverageRial,multiplyRial,quantityValue,quantityMicro,cumulativeCostRial,carryingShareRial,rial as exactRial,sumRial } from '@/lib/money';
import { carryingPolicy,planCarryingMovement,originalMovementCost } from '@/lib/inventory-valuation';
import { moveStock } from '@/lib/inventory';
import { captureFinancialDocument } from '@/lib/accounting-events';
import { returnRefundCapacity,refreshReturnCompletion,postPendingReturnCosts } from '@/lib/return-state';
import { refundReceipt } from '@/lib/customer-payments';
import { refreshInvoiceFinancialState } from '@/lib/payment-state';
import { invoiceObligation } from '@/lib/invoice-obligation';
import { legacyCreditUniqueness } from '@/lib/credit-reissue-schema';
import { requireCreditSchedule } from '@/lib/installments';

type Header={id:number;number:string;invoice_id:number;branch_id:number;kind:'customer'|'supplier';state:string;requested_by:number};
type ReturnLine={id:number;invoice_item_id:number;part_id:number;qty_micro:number;unit_price:number;unit_cost:number;gross_limit:number;disposition:string|null;location_id:number|null;movement_id:number|null;rejection_release_reference:string|null};
function words(value:unknown,label:string,min=5){if(typeof value!=='string'||value.trim().length<min||value.length>1000)throw new HttpError(400,`${label} را مستند وارد کنید.`);return value.trim();}
function rial(value:unknown){try{return exactRial(value);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'مبلغ ریال معتبر نیست.');}}
function micros(value:unknown){try{const qty=quantityValue(Number(value)),[whole,fraction='']=String(qty).split('.');const scaled=BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,'0'));if(qty<=0||scaled>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('quantity');return Number(scaled);}catch{throw new HttpError(400,'تعداد مرجوعی معتبر نیست؛ حداکثر شش رقم اعشار مجاز است.');}}
function header(db:DatabaseSync,session:Session,id:number,cookie?:string|null,permission='invoices.view'){
 requirePerm(session,permission);const row=db.prepare('SELECT * FROM business_returns WHERE id=?').get(validate.id(id)) as Header|undefined;
 if(!row)throw new HttpError(404,'مرجوعی یافت نشد.');ledgerScope(session,row.branch_id,cookie,permission);return row;
}
function lines(db:DatabaseSync,id:number){return db.prepare('SELECT * FROM business_return_lines WHERE return_id=? ORDER BY id LIMIT 101').all(id) as ReturnLine[];}
function state(row:Header,allowed:string[]){if(!allowed.includes(row.state))throw new HttpError(409,'مرحلهٔ مرجوعی اجازهٔ این عملیات را نمی‌دهد؛ اطلاعات را تازه‌سازی کنید.');}
function record(db:DatabaseSync,session:Session,row:Header,action:string,after:unknown){auditRecord(db,session,action,'business_return',row.id,{state:row.state},{branch_id:row.branch_id,...after as object});}

export function requestReturn(db:DatabaseSync,session:Session,input:{invoice_id:number;reason:string;delivery_reference:string;lines:Array<{invoice_item_id:number;qty:number}>},cookie?:string|null){
 requirePerm(session,'invoices.edit');const reason=words(input.reason,'دلیل مرجوعی'),delivery=words(input.delivery_reference,'مرجع تحویل اصلی');
 if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100||input.lines.some(l=>!l||typeof l!=='object'||Array.isArray(l))||new Set(input.lines.map(l=>l?.invoice_item_id)).size!==input.lines.length)throw new HttpError(400,'بین یک تا صد ردیفِ بدون تکرار انتخاب کنید.');
 return atomic(db,()=>{
  const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(validate.id(input.invoice_id));if(!inv)throw new HttpError(404,'فاکتور اصلی یافت نشد.');ledgerScope(session,Number(inv.branch_id),cookie,'invoices.edit');
  if(['draft','cancelled'].includes(String(inv.status))||!inv.stock_posted)throw new HttpError(409,'مرجوعی کالا فقط برای فاکتور قطعی دارای سابقهٔ موجودی مجاز است.');
  if(inv.type==='repair'&&!db.prepare("SELECT t.id FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=? AND s.name='Delivered'").get(inv.ticket_id))throw new HttpError(409,'قطعهٔ تعمیرِ تحویل‌نشده به گردش لغو/مصرف تعمیر نیاز دارد؛ تحویل واقعی را بررسی کنید.');
  const source=db.prepare(`SELECT i.*,p.quantity_precision,COALESCE((SELECT SUM(l.qty_micro) FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id WHERE l.invoice_item_id=i.id AND r.state!='rejected' AND l.rejection_release_reference IS NULL),0) reserved_micro FROM invoice_items i JOIN parts p ON p.id=i.ref_id WHERE i.invoice_id=? AND i.id IN (SELECT value FROM json_each(?)) AND i.kind='part' AND i.ref_id IS NOT NULL ORDER BY i.id`).all(inv.id,JSON.stringify(input.lines.map(l=>validate.id(l.invoice_item_id))));
  const prepared=input.lines.map(line=>{const original=source.find(s=>s.id===validate.id(line.invoice_item_id));if(!original)throw new HttpError(400,'ردیف کالا متعلق به فاکتور اصلی نیست.');
   if(original.cost==null)throw new HttpError(409,'بهای مستند ردیف اصلی نامشخص است؛ بازبینی منبع لازم است و صفر فرض نمی‌شود.');
   const qty=micros(line.qty),cost=rial(original.cost),unitPrice=rial(original.unit_price);quantityMicro(line.qty,Number(original.quantity_precision));if(qty>micros(original.qty)-Number(original.reserved_micro))throw new HttpError(409,'تعداد مرجوعی از ماندهٔ قابل برگشت بیشتر است.');return {original,qty,cost,unitPrice,limit:cumulativeCostRial(unitPrice,Number(original.reserved_micro)+qty)-cumulativeCostRial(unitPrice,Number(original.reserved_micro))};});
  const number=nextSeq('business_return','RET-'),kind=inv.type==='purchase'?'supplier':'customer';
  const id=Number(db.prepare('INSERT INTO business_returns(number,invoice_id,branch_id,kind,reason,delivery_reference,requested_by) VALUES(?,?,?,?,?,?,?)').run(number,inv.id,inv.branch_id,kind,reason,delivery,session.user.id).lastInsertRowid);
  for(const p of prepared)db.prepare('INSERT INTO business_return_lines(return_id,invoice_item_id,part_id,qty_micro,unit_price,unit_cost,gross_limit) VALUES(?,?,?,?,?,?,?)').run(id,p.original.id,p.original.ref_id,p.qty,p.unitPrice,p.cost,p.limit);
  record(db,session,{id,number,invoice_id:Number(inv.id),branch_id:Number(inv.branch_id),kind,state:'requested',requested_by:session.user.id},'request',{line_count:prepared.length,invoice_id:inv.id});return {id,number,state:'requested'};
 });
}
export function authorizeReturn(db:DatabaseSync,session:Session,id:number,accept:boolean,cookie?:string|null){
 return atomic(db,()=>{const row=header(db,session,id,cookie,'invoices.edit');state(row,['requested']);
  if(typeof accept!=='boolean')throw new HttpError(400,'نتیجهٔ بررسی معتبر نیست.');
  db.prepare('UPDATE business_returns SET state=?,authorized_by=? WHERE id=?').run(accept?'authorized':'rejected',session.user.id,id);record(db,session,row,'authorize',{accepted:accept});return {id,state:accept?'authorized':'rejected'};});
}
export function receiveReturn(db:DatabaseSync,session:Session,id:number,reference:string,cookie?:string|null){
 const proof=words(reference,'مرجع رسید فیزیکی');return atomic(db,()=>{const row=header(db,session,id,cookie,'inventory.manage');state(row,row.kind==='customer'?['authorized']:['dispatched']);
  db.prepare("UPDATE business_returns SET state='received',receipt_reference=? WHERE id=?").run(proof,id);record(db,session,row,'receive',{receipt_reference:proof});return {id,state:'received'};});
}
export function inspectReturn(db:DatabaseSync,session:Session,id:number,input:{reference:string;lines:Array<{id:number;disposition:string;location_id?:number;note:string}>},cookie?:string|null){
 const proof=words(input.reference,'مرجع بازرسی');return atomic(db,()=>{const row=header(db,session,id,cookie,'inventory.manage');state(row,row.kind==='customer'?['received','inspected']:['authorized','inspected']);
  const items=lines(db,id);if(!Array.isArray(input.lines)||input.lines.length!==items.length||input.lines.some(l=>!l||typeof l!=='object'||Array.isArray(l))||new Set(input.lines.map(l=>l?.id)).size!==items.length)throw new HttpError(400,'نتیجهٔ بازرسی تمام ردیف‌ها را بدون تکرار وارد کنید.');
  for(const result of input.lines){const item=items.find(l=>l.id===result.id);if(!item||item.movement_id)throw new HttpError(409,'ردیف تعیین‌تکلیف‌شده قابل بازنویسی نیست.');
   if(item.rejection_release_reference){if(result.disposition!=='rejected')throw new HttpError(409,'کالای تحویل‌مجددشده نیازمند درخواست تازه است.');continue;}
   const allowed=row.kind==='customer'?['restock','damaged','disposed','quarantined','rejected']:['supplier','quarantined','rejected'];if(!allowed.includes(result.disposition))throw new HttpError(400,'تعیین تکلیف کالا معتبر نیست.');
   const note=words(result.note,'گزارش وضعیت کالا');let location:number|null=null;
   if(['restock','supplier'].includes(result.disposition)){location=validate.id(result.location_id);if(!db.prepare('SELECT id FROM inventory_locations WHERE id=? AND branch_id=?').get(location,row.branch_id))throw new HttpError(400,'انبار متعلق به شعبهٔ مرجوعی نیست.');}
   db.prepare('UPDATE business_return_lines SET disposition=?,inspection_note=?,location_id=? WHERE id=?').run(result.disposition,note,location,item.id);
  }
  db.prepare("UPDATE business_returns SET state='inspected',inspection_reference=? WHERE id=?").run(proof,id);record(db,session,row,'inspect',{inspection_reference:proof,dispositions:input.lines.map(l=>({id:l.id,disposition:l.disposition}))});return {id,state:'inspected'};
 });
}
export function disposeReturn(db:DatabaseSync,session:Session,id:number,input:{reference:string;confirmed:boolean},cookie?:string|null){
 const proof=words(input.reference,'مرجع ثبت واقعی انبار/ارسال/اسقاط');if(input.confirmed!==true)throw new HttpError(400,'انجام واقعی تعیین تکلیف کالا را تأیید کنید.');
 return atomic(db,()=>{const row=header(db,session,id,cookie,'inventory.manage');state(row,['inspected']);const items=lines(db,id);
  if(items.some(l=>!l.disposition||l.disposition==='quarantined'))throw new HttpError(409,'کالای قرنطینه باید پیش از ثبت مالی تعیین تکلیف شود.');
  if(items.some(l=>l.disposition==='rejected'&&!l.rejection_release_reference))throw new HttpError(409,'برای ردیف ردشده ابتدا رسید تحویل مجدد به فرستنده ثبت کنید.');
  for(const item of items){if(item.disposition==='rejected')continue;if(item.movement_id)throw new HttpError(409,'برای این ردیف قبلاً حرکت موجودی ثبت شده است.');
   const qty=item.qty_micro/1000000;
   const original=db.prepare('SELECT qty,cost FROM invoice_items WHERE id=?').get(item.invoice_item_id)!;
   const previous=db.prepare(`SELECT l.qty_micro,l.cost_amount,l.unit_cost FROM business_return_lines l JOIN business_returns r ON r.id=l.return_id WHERE l.invoice_item_id=? AND l.id!=? AND l.disposition!='rejected' AND (l.cost_amount IS NOT NULL OR r.state IN ('disposed','dispatched','credit_pending','completed'))`).all(item.invoice_item_id,item.id);
   const priorQty=previous.reduce((n,l)=>n+Number(l.qty_micro),0),priorCost=sumRial(previous.map(l=>l.cost_amount==null?multiplyRial(Number(l.unit_cost),Number(l.qty_micro)/1000000):Number(l.cost_amount)));
   const originalCost=row.kind==='customer'?originalMovementCost(db,Number(row.invoice_id),Number(item.invoice_item_id)):null;
   let costAmount=row.kind==='customer'?(originalCost?carryingShareRial(originalCost.amount,priorQty+item.qty_micro,originalCost.qty_micro):cumulativeCostRial(item.unit_cost,priorQty+item.qty_micro))-priorCost:0;
   if(costAmount<0)throw new HttpError(409,'بهای برگشت‌های قبلی از سهم تجمعی بیشتر است؛ تطبیق مستند لازم است.');
   const valuation:Record<string,unknown>={method:originalCost?'original_carrying_cumulative_v3':'original_cost_cumulative_v2',original_qty_micro:originalCost?.qty_micro??quantityMicro(Number(original.qty)),original_cost:originalCost?.amount??multiplyRial(item.unit_cost,Number(original.qty)),prior_qty_micro:priorQty,prior_cost:priorCost,cost_amount:costAmount};
   if(['restock','supplier'].includes(item.disposition!)){
    const unitCost=row.kind==='supplier'?Number(db.prepare('SELECT avg_cost FROM parts WHERE id=?').get(item.part_id)!.avg_cost):item.unit_cost;
    if(row.kind==='supplier'){
     const stock=db.prepare('SELECT qty,carrying_value,valuation_json FROM inventory_stock WHERE part_id=? AND location_id=?').get(item.part_id,item.location_id);
     if(!stock||Number(stock.qty)<qty)throw new HttpError(409,'موجودی کافی برای ارسال واقعی به تأمین‌کننده نیست.');
     costAmount=multiplyRial(unitCost,Number(stock.qty))-multiplyRial(unitCost,addQuantity(Number(stock.qty),-qty));
     const exact=planCarryingMovement(db,{branch:Number(row.branch_id),qty:-qty,unitCost,currentQty:Number(stock.qty),currentValue:stock.carrying_value,state:stock.valuation_json});if(exact)costAmount=exact.amount;
     Object.assign(valuation,{method:'carrying_cost_depletion_v2',cost_amount:costAmount,before_qty:stock.qty,before_avg:unitCost});
    }
    if(row.kind==='customer'&&carryingPolicy(db,Number(row.branch_id))){
     if(!originalCost)throw new HttpError(409,'بهای دفتریِ ردیف اصلی مستند نیست؛ پیوند فرضی برای مرجوعی ساخته نشد.');
     Object.assign(valuation,{method:'original_carrying_cumulative_v3',original_cost:originalCost.amount,original_qty_micro:originalCost.qty_micro});
    }else if(row.kind==='customer'){
     const stocks=db.prepare('SELECT s.qty,s.location_id,l.branch_id,p.avg_cost FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id JOIN parts p ON p.id=s.part_id WHERE s.part_id=?').all(item.part_id);
     const totalQty=stocks.reduce((n,s)=>addQuantity(n,Number(s.qty)),0),oldAvg=Number(db.prepare('SELECT avg_cost FROM parts WHERE id=?').get(item.part_id)!.avg_cost),newAvg=weightedAverageRial(oldAvg,totalQty,unitCost,qty);
     const before=sumRial(stocks.map(s=>multiplyRial(oldAvg,Number(s.qty)))),after=sumRial(stocks.map(s=>multiplyRial(newAvg,addQuantity(Number(s.qty),s.location_id===item.location_id?qty:0))))+(stocks.some(s=>s.location_id===item.location_id)?0:multiplyRial(newAvg,qty));
     if(after-before!==costAmount||stocks.some(s=>s.branch_id!==row.branch_id&&Number(s.qty)>0&&oldAvg!==newAvg))throw new HttpError(409,'میانگین گرد‌شده یا تغییر ارزش شعبهٔ دیگر با بهای واقعی مرجوعی تطبیق ندارد؛ سیاست ارزش‌گذاری دقیق لازم است و موجودی تغییر نکرد.');
     Object.assign(valuation,{before_value:before,after_value:after,before_avg:oldAvg,after_avg:newAvg});
    }
    db.prepare('UPDATE business_return_lines SET cost_amount=?,valuation_json=? WHERE id=?').run(costAmount,JSON.stringify(valuation),item.id);
    moveStock({part_id:item.part_id,location_id:item.location_id,qty:row.kind==='supplier'?-qty:qty,type:row.kind==='supplier'?'supplier_return':'return',unit_cost:unitCost,extended_cost:costAmount,ref_type:'business_return',ref_id:item.id,branch_id:row.branch_id,user_id:session.user.id,note:`${row.number}: ${item.disposition}`});
    const movement=db.prepare("SELECT id FROM inventory_movements WHERE ref_type='business_return' AND ref_id=?").get(item.id)!;
    db.prepare('UPDATE business_return_lines SET movement_id=? WHERE id=?').run(movement.id,item.id);
   }else{
    db.prepare('UPDATE business_return_lines SET cost_amount=?,valuation_json=? WHERE id=?').run(costAmount,JSON.stringify(valuation),item.id);
    if(costAmount>0)captureFinancialDocument(db,'return_cost',item.id,'disposition',session.user.id,row.branch_id);
   }
  }
  const next=row.kind==='supplier'?'dispatched':'disposed';db.prepare('UPDATE business_returns SET state=?,disposition_reference=? WHERE id=?').run(next,proof,id);record(db,session,row,'dispose',{state:next,reference:proof});return {id,state:next};
 });
}
export function releaseRejectedReturn(db:DatabaseSync,session:Session,id:number,reference:string,cookie?:string|null){
 const proof=words(reference,'رسید تحویل مجدد کالای ردشده');return atomic(db,()=>{const row=header(db,session,id,cookie,'inventory.manage');state(row,['inspected']);const items=lines(db,id),rejected=items.filter(l=>l.disposition==='rejected'&&!l.rejection_release_reference);
  if(!rejected.length)throw new HttpError(409,'ردیف ردشدهٔ منتظر تحویل مجدد وجود ندارد.');
  for(const line of rejected)db.prepare('UPDATE business_return_lines SET rejection_release_reference=? WHERE id=?').run(proof,line.id);
  if(items.every(l=>l.disposition==='rejected'))db.prepare("UPDATE business_returns SET state='rejected' WHERE id=?").run(id);
  record(db,session,row,'release_rejected',{reference:proof,line_ids:rejected.map(l=>l.id)});return {id,released:true};
 });
}
export function proposeCreditNote(db:DatabaseSync,session:Session,id:number,input:{reason:string;evidence_reference:string;tax_amount:number;lines:Array<{return_line_id:number;net_amount:number}>},cookie?:string|null){
 requirePerm(session,'finance.manage');const reason=words(input.reason,'مبنای اعتبارنامه'),evidence=words(input.evidence_reference,'مرجع اصلاح مالی');
 return atomic(db,()=>{const row=header(db,session,id,cookie,'finance.manage');
  const draft=db.prepare('SELECT * FROM credit_notes WHERE return_id=? ORDER BY id DESC LIMIT 1').get(id);
  state(row,[...(row.kind==='customer'?['disposed']:['received']),...(draft?.status==='reversed'||draft?.replaces_note_id?['credit_pending']:[])]);
  if(draft?.status==='reversed'&&legacyCreditUniqueness(db))throw new HttpError(409,'این پایگاه سابقهٔ اعتبارنامهٔ نسخهٔ قبلی دارد؛ جایگزینی نیازمند مهاجرت تأییدشده پس از پشتیبان‌گیری و بازگردانی آزمایشی است.');
  const items=lines(db,id).filter(l=>l.disposition!=='rejected'),tax=rial(input.tax_amount??0);
  if(!Array.isArray(input.lines)||input.lines.length!==items.length||input.lines.some(l=>!l||typeof l!=='object'||Array.isArray(l))||new Set(input.lines.map(l=>l?.return_line_id)).size!==items.length)throw new HttpError(400,'مبالغ تمام ردیف‌های مرجوعی را مشخص کنید.');
  const budgets=db.prepare(`SELECT r.id,i.total,COALESCE(p.amount,0) previous FROM business_return_lines r JOIN invoice_items i ON i.id=r.invoice_item_id
   LEFT JOIN (SELECT r.invoice_item_id,SUM(l.net_amount) amount FROM credit_note_lines l JOIN credit_notes n ON n.id=l.note_id JOIN business_return_lines r ON r.id=l.return_line_id WHERE n.status IN ('approved','posted') GROUP BY r.invoice_item_id) p ON p.invoice_item_id=i.id WHERE r.return_id=?`).all(id);
  for(const entry of input.lines){const source=items.find(l=>l.id===entry.return_line_id);if(!source||rial(entry.net_amount)>source.gross_limit)throw new HttpError(400,'اعتبار ردیف از مبلغ کالای مرجوعی بیشتر است.');
   const budget=budgets.find(b=>b.id===entry.return_line_id)!;
   if(Number(budget.previous)+entry.net_amount>Number(budget.total))throw new HttpError(409,'اعتبار تجمعی از خالص ردیف اصلی بیشتر است؛ تخصیص تخفیف نیازمند بررسی است.');
  }
  const net=sumRial(input.lines.map(l=>rial(l.net_amount))),amount=sumRial([net,tax]);if(!amount)throw new HttpError(400,'اعتبارنامه باید مبلغ مثبت داشته باشد.');
  const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(row.invoice_id)!;
  const priorTotals=db.prepare("SELECT COALESCE(SUM(amount),0) amount,COALESCE(SUM(tax_amount),0) tax FROM credit_notes WHERE invoice_id=? AND status IN ('approved','posted')").get(row.invoice_id)!;
  if(amount+Number(priorTotals.amount)>Number(inv.total)||tax+Number(priorTotals.tax)>Number(inv.tax))throw new HttpError(409,'اعتبار و مالیات تجمعی از سند اصلی بیشتر است.');
  if(draft&&!['draft','reversed'].includes(String(draft.status)))throw new HttpError(409,'اعتبارنامه پس از تأیید قابل بازنویسی نیست.');
  if(draft?.status==='draft'&&draft.requested_by!==session.user.id)throw new HttpError(403,'اصلاح پیش‌نویس فقط برای پیشنهاددهنده مجاز است؛ تأییدکننده نباید پیشنهاد خودش را تأیید کند.');
  if(draft?.status==='draft'){
   db.prepare('UPDATE credit_notes SET amount=?,net_amount=?,tax_amount=?,reason=?,evidence_reference=? WHERE id=?').run(amount,net,tax,reason,evidence,draft.id);
   db.prepare('DELETE FROM credit_note_lines WHERE note_id=?').run(draft.id);
   for(const entry of input.lines)db.prepare('INSERT INTO credit_note_lines(note_id,return_line_id,net_amount) VALUES(?,?,?)').run(draft.id,entry.return_line_id,entry.net_amount);
   record(db,session,row,'edit_credit_draft',{credit_note_id:draft.id,before:{amount:draft.amount,net_amount:draft.net_amount,tax_amount:draft.tax_amount},amount,net_amount:net,tax_amount:tax});return {id:Number(draft.id),number:String(draft.number),status:'draft'};
  }
  const number=nextSeq('credit_note',row.kind==='customer'?'CN-':'SCN-');
  const replaces=draft?.status==='reversed'?Number(draft.id):null;
  if(replaces&&reason===draft!.reason&&evidence===draft!.evidence_reference)throw new HttpError(400,'مبنای بازصدور و مرجع بازبینی تازه را صریح ثبت کنید.');
  const noteId=Number(db.prepare('INSERT INTO credit_notes(number,return_id,invoice_id,branch_id,customer_id,supplier_id,amount,net_amount,tax_amount,reason,evidence_reference,requested_by,replaces_note_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(number,id,row.invoice_id,row.branch_id,row.kind==='customer'?inv.customer_id:null,row.kind==='supplier'?inv.supplier_id:null,amount,net,tax,reason,evidence,session.user.id,replaces).lastInsertRowid);
  for(const entry of input.lines)db.prepare('INSERT INTO credit_note_lines(note_id,return_line_id,net_amount) VALUES(?,?,?)').run(noteId,entry.return_line_id,entry.net_amount);
  record(db,session,row,'propose_credit',{credit_note_id:noteId,amount,replaces_note_id:replaces});return {id:noteId,number,status:'draft'};
 });
}
export function approveCreditNote(db:DatabaseSync,session:Session,id:number,cookie?:string|null){
 requirePerm(session,'finance.manage');return atomic(db,()=>{const note=db.prepare('SELECT * FROM credit_notes WHERE id=?').get(validate.id(id));if(!note)throw new HttpError(404,'اعتبارنامه یافت نشد.');
  const row=header(db,session,Number(note.return_id),cookie,'finance.manage');if(note.status!=='draft')throw new HttpError(409,'اعتبارنامه در مرحلهٔ تأیید نیست.');
  if(note.requested_by===session.user.id)throw new HttpError(403,'تأیید مستقل اعتبارنامه لازم است.');
  requireCreditSchedule(db,id,'credit');
  if(row.kind==='supplier'){
   const cost=sumRial(db.prepare('SELECT l.qty_micro,m.unit_cost,m.extended_cost FROM business_return_lines l JOIN inventory_movements m ON m.id=l.movement_id WHERE l.return_id=?').all(row.id).map(l=>l.extended_cost==null?multiplyRial(Number(l.unit_cost),Number(l.qty_micro)/1000000):Number(l.extended_cost)));
   if(cost!==note.net_amount)throw new HttpError(409,'اختلاف اعتبار تأمین‌کننده با بهای دفتری نیازمند سیاست و سند تعدیل مستقل است.');
  }
  db.prepare("UPDATE credit_notes SET status='approved',approved_by=? WHERE id=?").run(session.user.id,id);
  db.prepare("UPDATE business_returns SET state='credit_pending' WHERE id=?").run(row.id);
  const event=captureFinancialDocument(db,'credit_note',id,'recognition',session.user.id,row.branch_id);
  record(db,session,row,'approve_credit',{credit_note_id:id,event_id:event,amount:note.amount});refreshReturnCompletion(db,row.id);
  return {id,event_id:event,status:String(db.prepare('SELECT status FROM credit_notes WHERE id=?').get(id)!.status)};
 });
}
export function approveZeroReturnCredit(db:DatabaseSync,session:Session,id:number,reference:string,cookie?:string|null){
 const proof=words(reference,'مرجع اثبات صفر بودن اصلاح مالی');return atomic(db,()=>{const row=header(db,session,id,cookie,'finance.manage');state(row,row.kind==='customer'?['disposed']:['received']);
  if(row.requested_by===session.user.id)throw new HttpError(403,'تأیید مالیِ صفر نیز باید مستقل از درخواست‌دهنده باشد.');
  if(invoiceObligation(db,row.invoice_id).effective_total!==0||db.prepare('SELECT id FROM credit_notes WHERE return_id=?').get(id))throw new HttpError(409,'این سند اصلاح مالیِ مثبت یا بررسی اعتبارنامه نیاز دارد؛ صفر فرض نمی‌شود.');
  if(row.kind==='supplier'&&lines(db,id).some(l=>l.unit_cost>0))throw new HttpError(409,'مطالبهٔ بهای کالا قابل حذف نیست؛ تعدیل مصوب جداگانه لازم است.');
  db.prepare("UPDATE business_returns SET zero_credit_approved_by=?,zero_credit_reference=?,state='credit_pending' WHERE id=?").run(session.user.id,proof,id);
  record(db,session,row,'approve_zero_credit',{reference:proof,amount:0});postPendingReturnCosts(db,id,postAutomaticFinancialEvent);refreshReturnCompletion(db,id);return {id,zero_credit_approved:true};
 });
}
export function refundReturn(db:DatabaseSync,session:Session,id:number,input:{payment_id:number;amount:number;method:string;reference:string;confirmed:boolean},cookie?:string|null){
 requirePerm(session,'payments.refund');return atomic(db,()=>{const row=header(db,session,id,cookie,'payments.refund'),capacity=returnRefundCapacity(db,id);
  const amount=rial(input.amount);if(!amount||amount>capacity.remaining)throw new HttpError(409,'مبلغ از اعتبار واقعی و قابل استرداد مرجوعی بیشتر است.');
  if(input.confirmed!==true)throw new HttpError(400,'پرداخت/دریافت انجام‌شده را صریح تأیید کنید.');const reference=words(input.reference,'مرجع سند استرداد');
  const payment=db.prepare(`SELECT p.* FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.id=? AND p.invoice_id=? AND p.branch_id=? AND p.direction=?
   AND ((p.direction='in' AND p.customer_id IS i.customer_id) OR (p.direction='out' AND p.supplier_id IS i.supplier_id))`).get(validate.id(input.payment_id),row.invoice_id,row.branch_id,row.kind==='supplier'?'out':'in');
  if(!payment)throw new HttpError(404,'پرداخت اصلی متعلق به این فاکتور نیست.');
  // The source's normal refund event owns cash; attaching the return below
  // gives accounting its original obligation without creating another movement.
  const result=refundReceipt(db,session,{payment_id:input.payment_id,amount,method:input.method,reason:`${row.number}: ${reference}`,return_id:id,document_reference:reference,confirmed:true},row.branch_id);
  record(db,session,row,'refund',{refund_id:result.id,amount,reference});return result;
 });
}
export function reverseReturnCredit(db:DatabaseSync,session:Session,noteId:number,date:string,reason:string,cookie?:string|null){
 return atomic(db,()=>{const note=db.prepare('SELECT * FROM credit_notes WHERE id=?').get(validate.id(noteId));if(!note||note.status!=='posted')throw new HttpError(409,'اعتبارنامهٔ نهایی یافت نشد.');
  header(db,session,Number(note.return_id),cookie,'finance.manage');
  const result=reverseJournal(db,session,Number(note.journal_id),date,words(reason,'دلیل برگشت اعتبارنامه'),cookie);
  refreshInvoiceFinancialState(db,Number(note.invoice_id));return result;
 });
}
