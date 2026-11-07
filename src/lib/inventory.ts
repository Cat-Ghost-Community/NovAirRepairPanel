import { getDb } from "@/lib/db/schema";
import { atomic } from "@/lib/db/transaction";
import { addQuantity, weightedAverageRial, quantityValue,quantityMicro,rial,multiplyRial,sumRial,carryingUnitRial,cumulativeCostRial } from "@/lib/money";
import { planCarryingMovement,carryingPolicy } from '@/lib/inventory-valuation';
import { faQty } from "@/lib/format";
import { captureFinancialDocument } from "@/lib/accounting-events";

export class InventoryError extends Error {}

export type MovementType =
  | "purchase" | "sale" | "repair_consumption" | "return" | "adjustment"
  | "transfer_in" | "transfer_out" | "damage" | "loss" | "warranty_return" | "supplier_return";

export function getTotalQty(partId: number): number {
  let quantity = 0;
  for (const row of getDb().prepare("SELECT qty FROM inventory_stock WHERE part_id=?").iterate(partId)) {
    quantity = addQuantity(quantity, quantityValue(row.qty));
  }
  return quantity;
}

export function getStockMap(partIds: number[]): Record<number, number> {
  if (partIds.length === 0) return {};
  const rows = getDb()
    .prepare(
      `SELECT part_id, qty FROM inventory_stock
       WHERE part_id IN (${partIds.map(() => "?").join(",")})`
    )
    .iterate(...partIds);
  const map: Record<number, number> = {};
  for (const r of rows) map[Number(r.part_id)] = addQuantity(map[Number(r.part_id)] ?? 0, quantityValue(r.qty));
  return map;
}

export function moveStock(opts: {
  part_id: number;
  location_id?: number | null;
  qty: number; // signed
  type: MovementType;
  ref_type?: string;
  ref_id?: number;
  unit_cost?: number;
  extended_cost?: number;
  source_line_id?: number;
  note?: string;
  user_id?: number;
  branch_id?: number;
}) {
  const db = getDb();
  if (!Number.isFinite(opts.qty) || opts.qty === 0 || Math.abs(opts.qty) > Number.MAX_SAFE_INTEGER) throw new InventoryError("مقدار جابه‌جایی کالا معتبر نیست.");
  if (opts.unit_cost != null && (!Number.isSafeInteger(opts.unit_cost) || opts.unit_cost < 0)) throw new InventoryError("بهای کالا معتبر نیست.");
  return atomic(db, () => {
  let loc = opts.location_id;
  if (!loc) {
    const def = opts.branch_id == null
      ? db.prepare("SELECT id FROM inventory_locations WHERE is_default = 1 ORDER BY id LIMIT 1").get() as any
      : db.prepare("SELECT id FROM inventory_locations WHERE branch_id=? ORDER BY is_default DESC,id LIMIT 1").get(opts.branch_id) as any;
    loc = def?.id;
  }
  if (!loc) throw new InventoryError("انبار این شعبه تعریف نشده است؛ مدیر سامانه باید انبار و شعبهٔ آن را مشخص کند.");
  const location = db.prepare("SELECT branch_id FROM inventory_locations WHERE id=?").get(loc) as { branch_id: number | null } | undefined;
  if (!location || (opts.branch_id != null && location.branch_id !== opts.branch_id)) throw new InventoryError("انبار انتخاب‌شده متعلق به این شعبه نیست.");
  if(opts.type==='transfer_in'||opts.type==='transfer_out'){
    const transfer=opts.ref_type==='inventory_transfer'?db.prepare('SELECT qty,from_location,to_location FROM inventory_transfers WHERE id=? AND part_id=?').get(opts.ref_id??0,opts.part_id):null;
    if(!transfer||Number(transfer.qty)!==Math.abs(opts.qty)||(opts.type==='transfer_in'?transfer.to_location:transfer.from_location)!==loc)throw new InventoryError('گردش انتقال با سند دوطرفه، انبار و تعداد آن مطابقت ندارد.');
    if((opts.type==='transfer_in')!==(opts.qty>0))throw new InventoryError('جهت گردش انتقال معتبر نیست.');
    if(opts.type==='transfer_in'&&carryingPolicy(db,Number(location.branch_id))&&opts.extended_cost==null)throw new InventoryError('ارزش ورودی انتقال باید از خروج واقعی مبدأ گرفته شود.');
    if(opts.type==='transfer_in'&&opts.extended_cost!=null&&!carryingPolicy(db,Number(location.branch_id)))throw new InventoryError('مقصد انتقال باید همان سیاست ارزش دفتریِ مصوب را داشته باشد.');
  }
  const catalogue = db.prepare("SELECT avg_cost,purchase_price,quantity_precision FROM parts WHERE id=?").get(opts.part_id);
  if (!catalogue) throw new InventoryError("کالا یافت نشد.");
  quantityMicro(Math.abs(opts.qty),Number(catalogue.quantity_precision));
  if(carryingPolicy(db,Number(location.branch_id))&&['return','supplier_return','warranty_return'].includes(opts.type)&&opts.ref_type!=='business_return')throw new InventoryError('برگشت کالا به رسید و تعیین تکلیف مستند از مسیر مرجوعی نیاز دارد.');
  if(opts.type==='repair_consumption'){
    if(opts.qty>=0)throw new InventoryError('مصرف قطعه باید خروج واقعی از موجودی باشد.');
    const ticket=opts.ref_type==='ticket_item'?db.prepare('SELECT t.id,t.branch_id,s.name FROM ticket_items i JOIN repair_tickets t ON t.id=i.ticket_id JOIN repair_statuses s ON s.id=t.status_id WHERE i.id=?').get(opts.ref_id??0)
      :opts.ref_type==='ticket'?db.prepare('SELECT t.id,t.branch_id,s.name FROM repair_tickets t JOIN repair_statuses s ON s.id=t.status_id WHERE t.id=?').get(opts.ref_id??0):null;
    if(!ticket)throw new InventoryError('مرجع پذیرشِ مصرف قطعه معتبر نیست.');
    if(ticket.branch_id!==location.branch_id)throw new InventoryError('شعبهٔ مصرف قطعه با پذیرش مطابقت ندارد.');
    if(ticket.name==='Cancelled')throw new InventoryError('مصرف قطعه برای پذیرش لغوشده مجاز نیست.');
    if(opts.ref_type==='ticket_item'){
      const item=db.prepare('SELECT ref_id,qty FROM ticket_items WHERE id=?').get(opts.ref_id!);if(!item||item.ref_id!==opts.part_id||Number(item.qty)!==Math.abs(opts.qty))throw new InventoryError('مصرف قطعه با ردیف پذیرش و تعداد آن مطابقت ندارد.');
    }
  }
  if(opts.extended_cost!=null){
    rial(opts.extended_cost);
    const source=opts.ref_type==='business_return'?db.prepare('SELECT cost_amount FROM business_return_lines WHERE id=? AND part_id=? AND location_id=?').get(opts.ref_id??0,opts.part_id,loc)
      :opts.ref_type==='inventory_transfer'&&opts.type==='transfer_in'?db.prepare("SELECT extended_cost cost_amount FROM inventory_movements WHERE ref_type='inventory_transfer' AND ref_id=? AND type='transfer_out' AND part_id=? AND valuation_json IS NOT NULL").get(opts.ref_id??0,opts.part_id):null;
    if(!source||source.cost_amount!==opts.extended_cost)throw new InventoryError('بهای تمدیدشده به مرجع معتبر مرجوعی یا خروج انتقال نیاز دارد.');
  }
  const movementCost = opts.unit_cost ?? Number(catalogue.avg_cost ?? catalogue.purchase_price ?? 0);
  if (!Number.isSafeInteger(movementCost) || movementCost<0) throw new InventoryError("بهای موجودی معتبر نیست.");
  let exactExtended=opts.extended_cost;
  if(opts.type==='purchase'&&opts.ref_type==='goods_receipt'&&carryingPolicy(db,Number(location.branch_id))){
    const source=db.prepare('SELECT i.qty,i.received_qty,i.unit_cost FROM purchase_order_items i JOIN goods_receipts r ON r.po_id=i.po_id JOIN purchase_orders p ON p.id=i.po_id WHERE r.id=? AND i.id=? AND i.part_id=? AND p.branch_id=?').get(opts.ref_id??0,opts.source_line_id??0,opts.part_id,location.branch_id);
    if(!source||Number(source.unit_cost)!==movementCost)throw new InventoryError('ردیف واقعی سفارش و بهای رسید برای ارزش‌گذاری دقیق لازم است.');
    const previous=db.prepare("SELECT qty,extended_cost FROM inventory_movements WHERE ref_type='goods_receipt' AND source_line_id=? AND type='purchase'").all(opts.source_line_id!);
    const priorQty=previous.reduce((n,m)=>addQuantity(n,Number(m.qty)),0),through=Number(source.received_qty);
    if(addQuantity(priorQty,opts.qty)!==through||through>Number(source.qty)||previous.some(m=>m.extended_cost==null))throw new InventoryError('دریافت‌های قبلی این سفارش بهای تمدیدشدهٔ مستند ندارند؛ انتقال روش نیازمند بررسی است.');
    exactExtended=cumulativeCostRial(movementCost,quantityMicro(through))-sumRial(previous.map(m=>rial(m.extended_cost)));
    if(exactExtended<0)throw new InventoryError('بهای دریافت قبلی از سهم تجمعی بیشتر است؛ تطبیق لازم است.');
  }

  const cur = db
    .prepare("SELECT id,qty,reserved,carrying_value,valuation_json FROM inventory_stock WHERE part_id = ? AND location_id = ?")
    .get(opts.part_id, loc) as any;
  if (cur && (cur.qty == null || cur.reserved == null)) throw new InventoryError("ماندهٔ این انبار ناقص است؛ پیش از تغییر، تطبیق موجودی لازم است.");
  const currentQty = cur ? quantityValue(cur.qty) : 0;
  const currentReserved = cur ? quantityValue(cur.reserved) : 0;
  if (currentReserved > currentQty) throw new InventoryError("رزرو این انبار از موجودی بیشتر است؛ ابتدا تطبیق موجودی لازم است.");
  const newQty = addQuantity(currentQty, opts.qty);
  if (newQty < 0) throw new InventoryError("Not enough stock at this location.");
  if (opts.qty < 0 && newQty < currentReserved) throw new InventoryError("بخشی از موجودی رزرو شده است؛ ابتدا مالکیت و آزادسازی مجاز رزرو را بررسی کنید.");
  const valuation=planCarryingMovement(db,{branch:Number(location.branch_id),qty:opts.qty,unitCost:movementCost,currentQty,currentValue:cur?.carrying_value,state:cur?.valuation_json,extended:exactExtended});
  if(db.prepare('SELECT id FROM inventory_stock WHERE part_id=? AND location_id!=? AND ((?=1 AND qty>0 AND carrying_value IS NULL) OR (?=0 AND carrying_value IS NOT NULL)) LIMIT 1').get(opts.part_id,loc,valuation?1:0,valuation?1:0))throw new InventoryError('اختلاط روش قدیمی و ارزش دفتریِ مصوب برای این کالا مجاز نیست؛ ابتدا انتقال روش را بررسی کنید.');

  if (cur) {
    const reserved = currentReserved; // Aggregate reservation is not proof this ticket owns it.
    db.prepare("UPDATE inventory_stock SET qty=?,reserved=?,carrying_value=?,valuation_json=? WHERE id=?").run(newQty,reserved,valuation?.after??null,valuation?.state??null,cur.id);
  } else {
    db.prepare("INSERT INTO inventory_stock(part_id,location_id,qty,carrying_value,valuation_json) VALUES(?,?,?,?,?)").run(opts.part_id,loc,newQty,valuation?.after??null,valuation?.state??null);
  }
  const movement = db.prepare(
    `INSERT INTO inventory_movements(part_id,location_id,qty,type,ref_type,ref_id,unit_cost,note,user_id,branch_id,extended_cost,valuation_json,source_line_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    opts.part_id, loc, opts.qty, opts.type, opts.ref_type ?? null, opts.ref_id ?? null,
    movementCost,opts.note??null,opts.user_id??null,opts.branch_id??location.branch_id,valuation?.amount??opts.extended_cost??null,valuation?JSON.stringify(valuation.proof):null,opts.source_line_id??null
  );

  // recompute average cost on inbound purchase/consumption returns
  if(valuation){
    const positions=db.prepare('SELECT qty,carrying_value FROM inventory_stock WHERE part_id=?').all(opts.part_id),quantity=positions.reduce((n,p)=>addQuantity(n,Number(p.qty)),0);
    if(quantity>0)db.prepare('UPDATE parts SET avg_cost=? WHERE id=?').run(carryingUnitRial(sumRial(positions.map(p=>rial(p.carrying_value??0))),quantityMicro(quantity)),opts.part_id);
  }else if ((opts.type === "purchase" || opts.type==='return') && opts.unit_cost != null) {
    const part = db.prepare("SELECT avg_cost FROM parts WHERE id = ?").get(opts.part_id) as any;
    if (part) {
      const totalQty = getTotalQty(opts.part_id);
      const oldAvg = part.avg_cost ?? opts.unit_cost;
      const oldQty = addQuantity(totalQty, -opts.qty);
      const newAvg = totalQty > 0 ? weightedAverageRial(oldAvg, oldQty, opts.unit_cost, opts.qty) : opts.unit_cost;
      db.prepare("UPDATE parts SET avg_cost = ? WHERE id = ?").run(newAvg, opts.part_id);
    }
  }

  checkLowStock(opts.part_id, opts.user_id);
  captureFinancialDocument(db,"stock",Number(movement.lastInsertRowid),"movement",opts.user_id,opts.branch_id??location.branch_id??undefined);
  return {id:Number(movement.lastInsertRowid),cost:valuation?.amount??opts.extended_cost??multiplyRial(movementCost,Math.abs(opts.qty)),valued:valuation!=null};
  });
}

export function checkLowStock(partId: number, userId?: number) {
  const db = getDb();
  const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(partId) as any;
  if (!part) return;
  const qty = getTotalQty(partId);
  const threshold = part.reorder_point || part.min_stock;
  if (threshold > 0 && qty <= threshold) {
    // notify inventory managers & admins (deduped per day)
    const recent = db
      .prepare(
        `SELECT COUNT(*) c FROM notifications WHERE title = 'موجودی کم' AND link = ? AND created_at > datetime('now','-1 day')`
      )
      .get(`/parts/${partId}`) as any;
    if ((recent?.c ?? 0) === 0) {
      // This threshold and quantity are company-wide; branch employees must not receive consolidated stock.
      const users = db.prepare(`SELECT id FROM users WHERE role IN ('admin','owner') AND is_active = 1`).all() as any[];
      for (const u of users) {
        db.prepare("INSERT INTO notifications(user_id, title, body, priority, link) VALUES(?,?,?,?,?)").run(
          u.id,
          "موجودی کم",
          `${part.name}؛ موجودی ${faQty(qty)}، حد سفارش ${faQty(threshold)}.`,
          qty === 0 ? "high" : "normal",
          `/parts/${partId}`
        );
      }
    }
  }
}

export function consumePartForTicket(opts: {
  part_id: number;
  ticket_id: number;
  qty: number;
  user_id: number;
  branch_id?: number;
  location_id?: number;
  unit_cost?: number;
}) {
  const db = getDb();
  // moveStock owns the atomic quantity/reservation update at the same location.
  return atomic(db, () => {
  const ticket = db.prepare("SELECT branch_id FROM repair_tickets WHERE id=?").get(opts.ticket_id) as { branch_id: number } | undefined;
  if (!ticket || (opts.branch_id != null && opts.branch_id !== ticket.branch_id)) throw new InventoryError("پذیرش و شعبهٔ مصرف قطعه مطابقت ندارند.");
  return moveStock({
    part_id: opts.part_id,
    location_id: opts.location_id,
    qty: -opts.qty,
    type: "repair_consumption",
    ref_type: "ticket",
    ref_id: opts.ticket_id,
    unit_cost: opts.unit_cost,
    user_id: opts.user_id,
    branch_id: ticket.branch_id,
    note: `Consumed by repair ticket #${opts.ticket_id}`,
  });
  });
}

export function releaseReserved(partId: number, qty: number, locationId?: number) {
  if (!locationId || !Number.isFinite(qty) || qty <= 0) throw new InventoryError("انبار و تعداد آزادسازی رزرو باید مشخص باشد.");
  const db = getDb();
  return atomic(db, () => {
    const row = db.prepare("SELECT reserved FROM inventory_stock WHERE part_id=? AND location_id=?").get(partId, locationId) as { reserved: number } | undefined;
    if (!row || qty > row.reserved) throw new InventoryError("تعداد آزادسازی از رزرو این انبار بیشتر است.");
    db.prepare("UPDATE inventory_stock SET reserved=? WHERE part_id=? AND location_id=?").run(addQuantity(row.reserved, -qty), partId, locationId);
  });
}

export function inventoryValue(branchId:number|null=null): number {
  let total=0;
  for(const row of getDb().prepare(`SELECT s.qty,s.carrying_value,COALESCE(p.avg_cost,p.purchase_price,0) cost FROM inventory_stock s JOIN parts p ON p.id=s.part_id JOIN inventory_locations l ON l.id=s.location_id WHERE (? IS NULL OR l.branch_id=?)`).iterate(branchId,branchId)){
    total=sumRial([total,row.carrying_value==null?multiplyRial(Number(row.cost),Number(row.qty)):rial(row.carrying_value)]);
  }
  return total;
}
