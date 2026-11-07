import { createHash } from "node:crypto";
import {bankEventPayload,type BankEventDocument} from './bank-event';
import type { DatabaseSync } from "node:sqlite";
import { cancellationPosition } from '@/lib/repair-cancellation';
import type { Session } from "@/lib/auth";
import { audit, HttpError } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";
import { createJournal, ledgerScope, postJournal, postAutomaticFinancialEvent, type JournalLine } from "@/lib/accounting";
import { multiplyRial, rial, sumRial } from "@/lib/money";
import { validateReturnPosting,finalizeReturnEvent } from '@/lib/return-state';

export type FinancialDocument = "invoice" | "payment" | "refund" | "sale" | "expense" | "stock" | "cheque" | "commission" | "commission_payment" | "bank" | "credit_note" | "return_cost" | "repair" | 'customer_credit' | 'commission_correction';
const sources: Record<FinancialDocument,{table:string;fields:string}> = {
  commission_correction:{table:'commission_corrections',fields:'id,run_id,branch_id,user_id,kind,reverses_id,amount,expense_account,liability_amount,recovery_amount,posting_date,reason,evidence_reference,basis_hash,snapshot_hash,approved_by,state'},
  customer_credit:{table:'customer_credit_operations',fields:'id,kind,reverses_id,payment_id,invoice_id,source_invoice_id,installment_id,branch_id,customer_id,amount,source_account,posting_date,reason,evidence_reference,snapshot_hash,approved_by,state'},
  credit_note:{table:'credit_notes',fields:'id,return_id,invoice_id,branch_id,customer_id,supplier_id,amount,net_amount,tax_amount,status'},
  return_cost:{table:'business_return_lines',fields:'id,return_id,part_id,qty_micro,unit_cost,disposition,(SELECT branch_id FROM business_returns WHERE id=return_id) branch_id'},
  invoice:{table:"invoices",fields:"id,type,customer_id,supplier_id,branch_id,ticket_id,sale_id,purchase_order_id,status,subtotal,discount,tax,total"},
  payment:{table:"payments",fields:"id,invoice_id,sale_id,ticket_id,customer_id,supplier_id,branch_id,amount,method,direction"},
  refund:{table:"refunds",fields:"id,payment_id,invoice_id,sale_id,customer_id,branch_id,amount,method"},
  sale:{table:"sales",fields:"id,customer_id,branch_id,subtotal,discount,tax,total,status"},
  expense:{table:"expenses",fields:"id,branch_id,category,amount,date,method"},
  stock:{table:"inventory_movements",fields:"id,part_id,location_id,qty,type,unit_cost,ref_type,ref_id,branch_id"},
  cheque:{table:"checks",fields:"id,kind,amount,status,invoice_id,payment_id,bank_account_id,customer_id,supplier_id,branch_id,settled_at"},
  commission:{table:"payroll_runs",fields:"id,user_id,source_ticket_id,branch_id,earned_commission,net_payable,status"},
  bank:{table:"bank_transactions",fields:"id,account_id,type,amount,to_account_id,date,check_id"},
  commission_payment:{table:"commission_payments",fields:"id,run_id,branch_id,user_id,amount,method,payment_date"},
  repair:{table:'repair_tickets',fields:'id,number,customer_id,branch_id,status_id,completed_at,cancel_reason'},
};
/** Capture the actual source snapshot inside its existing transaction. Review
 * mode is deliberate: no recognition policy is inferred or historical data backfilled. */
export function captureFinancialDocument(db: DatabaseSync, type: FinancialDocument, id: number, action: string, actorId?: number | null, explicitBranch?: number, controlAmount?:number) {
  if (!db.isTransaction) throw new Error("Financial event capture requires the source transaction");
  const source=sources[type];
  const row=db.prepare(`SELECT ${source.fields} FROM ${source.table} WHERE id=?`).get(id);
  if (!row) throw new Error("Financial source document missing");
  if(type==='credit_note'){
    const replacement=db.prepare('SELECT replaces_note_id FROM credit_notes WHERE id=?').get(id);
    if(replacement?.replaces_note_id!=null)row.replaces_note_id=replacement.replaces_note_id;
    const service=db.prepare('SELECT d.* FROM service_credit_documents d JOIN credit_notes n ON n.return_id=d.return_id WHERE n.id=?').get(id);
    if(service)(row as Record<string,unknown>).service_correction={...service,lines:db.prepare('SELECT invoice_item_id,net_amount FROM service_credit_lines WHERE note_id=? ORDER BY invoice_item_id').all(id)};
  }
  // Preserve old source hashes: append v2 fields only when actually recorded.
  if(type==='stock'||type==='return_cost'){
    if(type==='stock'){
      const valuation=db.prepare('SELECT valuation_json FROM inventory_movements WHERE id=?').get(id);
      if(valuation?.valuation_json)row.carrying_valuation=JSON.parse(String(valuation.valuation_json));
    }
    const cost=db.prepare(type==='stock'?'SELECT extended_cost FROM inventory_movements WHERE id=?':'SELECT cost_amount FROM business_return_lines WHERE id=?').get(id)!;
    const exact=type==='stock'?cost.extended_cost:cost.cost_amount;
    if(exact!=null){
      row.extended_cost=rial(exact);
      const basis=db.prepare('SELECT valuation_json FROM business_return_lines WHERE id=?').get(type==='stock'&&row.ref_type==='business_return'?Number(row.ref_id):type==='return_cost'?id:-1);
      if(basis?.valuation_json)row.return_valuation=JSON.parse(String(basis.valuation_json));
    }
  }
  const branch=Number(explicitBranch??row.branch_id);
  if (!Number.isSafeInteger(branch) || branch<=0) throw new HttpError(409,"شعبهٔ رویداد مالی مشخص نیست؛ ابتدا انتساب سند را بررسی کنید.");
  let control=type==="invoice"||type==="sale"?rial(row.total):type==="stock"?multiplyRial(rial(row.unit_cost??0),Math.abs(Number(row.qty)))
    :type==='return_cost'?multiplyRial(rial(row.unit_cost),Number(row.qty_micro)/1000000):type==="commission"?rial(row.net_payable):type==='repair'?0:rial(row.amount);
  if (type==="payment" && ["check","cheque"].includes(String(row.method))) control=0;
  if (type==="cheque" && row.status!=="passed") control=0;
  // A linked POS invoice formalizes an already recognized sale; it is not a second revenue event.
  if (type==="invoice" && row.sale_id!=null) control=0;
  if(controlAmount!=null) control=rial(controlAmount);
  if(row.extended_cost!=null)control=rial(row.extended_cost);
  const cancellation=type==='repair'?cancellationPosition(db,id):null;if(cancellation)control=cancellation.wip_amount;
  const lines=type==="invoice"?db.prepare("SELECT kind,ref_id,qty,unit_price,cost,line_discount,total FROM invoice_items WHERE invoice_id=? ORDER BY sort,id").all(id)
    :type==="sale"?db.prepare("SELECT kind,ref_id,qty,unit_price,cost,total FROM sale_items WHERE sale_id=? ORDER BY id").all(id):[];
  const repairCostLines=type==="invoice"&&action==="repair_cost_recognition"&&row.ticket_id!=null
    ?db.prepare("SELECT id,ref_id,qty,cost,consumed FROM ticket_items WHERE ticket_id=? AND kind='part' AND consumed=1 ORDER BY id").all(row.ticket_id):[];
  const carryingCostLines=repairCostLines.length?db.prepare("SELECT m.id,m.extended_cost,m.valuation_json FROM inventory_movements m JOIN ticket_items i ON m.ref_type='ticket_item' AND m.ref_id=i.id WHERE i.ticket_id=? AND i.kind='part' AND i.consumed=1 AND m.type='repair_consumption' AND m.valuation_json IS NOT NULL ORDER BY m.id").all(row.ticket_id):[];
  const bankEvidence=type==="cheque"?db.prepare("SELECT id,account_id,type,amount,check_id FROM bank_transactions WHERE check_id=?").all(id):[];
  const advanceAllocations=type==='invoice'&&action==='advance_allocation'?db.prepare(`SELECT p.id payment_id,p.amount,p.method,p.customer_id,p.branch_id,p.ticket_id,p.invoice_id,
    COALESCE((SELECT SUM(f.amount) FROM refunds f WHERE f.payment_id=p.id),0) refunded,
    e.id receipt_event_id FROM payments p LEFT JOIN accounting_events e ON e.source_type='payment' AND e.source_id=CAST(p.id AS TEXT) AND e.event_type='receipt'
    WHERE p.invoice_id=? AND p.ticket_id=? AND p.direction='in' ORDER BY p.id LIMIT 1001`).all(id,row.ticket_id):[];
  if(advanceAllocations.length>1000)throw new HttpError(409,'تعداد تخصیص‌های پیش‌دریافت نیازمند بررسی دسته‌ای است.');
  const payload={document:{...row},lines,bank_evidence:bankEvidence,repair_cost_lines:repairCostLines,...(advanceAllocations.length?{advance_allocations:advanceAllocations}:{}),...(carryingCostLines.length===repairCostLines.length&&carryingCostLines.length?{repair_carrying_cost_lines:carryingCostLines}:{}),...(cancellation?{cancellation}:{}),control_amount:control,currency:"IRR",policy:"review_required",
    branch_basis:type==="bank"?"actor_branch_requires_accounting_review":"source_document"};
  const encodedBank=type==='bank'&&controlAmount==null?bankEventPayload(row as unknown as BankEventDocument):null;
  const json=encodedBank?.json??JSON.stringify(payload), hash=encodedBank?.hash??createHash("sha256").update(json).digest("hex"), key=`${type}:${id}:${action}`;
  const existing=db.prepare("SELECT id,payload_hash FROM accounting_events WHERE event_key=?").get(key);
  if(existing){if(existing.payload_hash!==hash) throw new HttpError(409,"رویداد مالی با همین مرجع و محتوای متفاوت وجود دارد.");return Number(existing.id);}
  const eventId=Number(db.prepare(`INSERT INTO accounting_events(event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash,actor_id)
    VALUES(?,?,?,?,?,?,?,?)`).run(key,type,String(id),branch,action,json,hash,actorId??null).lastInsertRowid);
  postAutomaticFinancialEvent(db,eventId);
  return eventId;
}

export function reviewFinancialEvent(db: DatabaseSync, session: Session, id: number,
  input: {posting_date:string;reason:string;lines:JournalLine[]}, cookie?:string|null) {
  return atomic(db,()=>{
    const event=db.prepare("SELECT * FROM accounting_events WHERE id=?").get(id);
    if(!event) throw new HttpError(404,"رویداد مالی یافت نشد.");
    if(['customer_credit','commission_correction'].includes(String(event.source_type)))throw new HttpError(409,'ثبت مالی این سند فقط از گردش تأیید و اجرای همان سند مجاز است.');
    ledgerScope(session,Number(event.branch_id),cookie,"finance.manage");
    if(db.prepare('SELECT event_id FROM accounting_opening_event_links WHERE event_id=?').get(id))throw new HttpError(409,'این منبع در افتتاحیهٔ مصوب لحاظ شده است؛ ثبت دوباره مجاز نیست.');
    if(typeof input.reason!=="string" || input.reason.trim().length<5 || input.reason.length>500) throw new HttpError(400,"دلیل و مبنای بررسی حسابداری را وارد کنید.");
    const payload=JSON.parse(String(event.payload_json));
    if(createHash("sha256").update(String(event.payload_json)).digest("hex")!==event.payload_hash) throw new HttpError(409,"اثر انگشت رویداد مالی معتبر نیست.");
    const control=rial(payload.control_amount);
    if(event.source_type==='bank'&&['transfer_in','transfer_out'].includes(String(payload.document?.type))&&!db.prepare('SELECT event_id FROM accounting_event_reviews WHERE event_id=?').get(id))throw new HttpError(409,'شناسایی انتقال دوطرفهٔ بانک به پیوند مستند و ثبت واحد دو گردش نیاز دارد؛ بررسی این گردش به‌تنهایی مجاز نیست.');
    if(!control) throw new HttpError(409,"این رویداد مبلغ قابل ثبت مستقل ندارد؛ نباید دوباره درآمد یا وجه ثبت شود.");
    if((payload.repair_carrying_cost_lines||event.source_type==='repair')&&!db.prepare('SELECT event_id FROM accounting_event_reviews WHERE event_id=?').get(id)){
      const actual=cancellationPosition(db,Number(event.source_type==='repair'?payload.document.id:payload.document.ticket_id));
      if(actual.flags.includes('warranty_review'))throw new HttpError(409,'تعیین تکلیف WIP گارانتی/دوباره‌کاری به سیاست مستقل مصوب نیاز دارد.');
      if(actual.flags.includes('branch_cost_review'))throw new HttpError(409,'انتساب شعبهٔ هزینه با پذیرش تطبیق ندارد؛ انتقال مالیِ مستند لازم است.');
      if(actual.wip_amount!==control)throw new HttpError(409,'ماندهٔ واقعی WIP با منبع تطبیق ندارد؛ ثبت دوبارهٔ هزینه مجاز نیست.');
      if(!Array.isArray(input.lines)||input.lines.length!==2||!input.lines.some(l=>l.account_code==='5010'&&l.debit===control&&!l.credit)||!input.lines.some(l=>l.account_code==='1120'&&l.credit===control&&!l.debit))throw new HttpError(409,'تسویهٔ این منبع فقط با بهای تعمیر و WIP مستند مجاز است؛ درآمد یا موجودی دوباره ثبت نمی‌شود.');
    }
    if(!Array.isArray(input.lines)||sumRial(input.lines.map(l=>rial(l.debit??0)))!==control||sumRial(input.lines.map(l=>rial(l.credit??0)))!==control) throw new HttpError(400,"مبلغ سند باید دقیقاً با مبلغ کنترلی رویداد برابر باشد.");
    const document=payload.document;
    validateReturnPosting(db,event,input.lines);
    const lines=input.lines.map(line=>{
      const result={...line};
      for(const [account,dimension,value] of [["1100","customer_id",document.customer_id],["2010","customer_id",document.customer_id],
        ["2000","supplier_id",document.supplier_id],["1310","supplier_id",document.supplier_id],["2030","employee_id",document.user_id],["1020","bank_account_id",document.bank_account_id??document.account_id],
        ["1110","part_id",document.part_id]] as const) {
        if(line.account_code!==account||value==null||value===0)continue;
        if(result[dimension]!=null&&result[dimension]!==value) throw new HttpError(400,"تفصیلی سند با مرجع مالی تطبیق ندارد.");
        result[dimension]=Number(value);
      }
      return result;
    });
    const journal=createJournal(db,session,{branch_id:Number(event.branch_id),posting_date:input.posting_date,memo:input.reason,
      source_type:"financial_event",source_id:String(id),event_key:`financial-event:${id}`,lines},cookie);
    const prior=db.prepare("SELECT journal_id FROM accounting_event_reviews WHERE event_id=?").get(id);
    if(prior && prior.journal_id!==journal.id) throw new HttpError(409,"رویداد قبلاً به سند دیگری متصل شده است.");
    postJournal(db,session,journal.id,cookie);
    if(!prior){
      db.prepare("INSERT INTO accounting_event_reviews(event_id,journal_id,reason,approved_by) VALUES(?,?,?,?)").run(id,journal.id,input.reason.trim(),session.user.id);
      audit(session,"approve_event","accounting_event",id,null,{journal_id:journal.id,control_amount:control,branch_id:event.branch_id});
    }
    finalizeReturnEvent(db,id,postAutomaticFinancialEvent);
    return {event_id:id,journal_id:journal.id};
  });
}
