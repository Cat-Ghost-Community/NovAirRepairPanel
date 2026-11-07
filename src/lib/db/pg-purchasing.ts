import {HttpError} from '../http-error';
import {rial,quantityValue,quantityMicro,multiplyRial,percentRial,sumRial,addQuantity} from '../money';
import {parseDate} from '../format';
import {validateId} from '../validate-id';
import {postgresRelation,authorizePostgresScope,type Scope} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {movePostgresStock} from './postgres-inventory';
import {postgresPurchaseInvoiceSource} from './pg-customer-finance';

function label(value:unknown,name:string,maximum=200){if(typeof value!=='string'||!value.trim()||value.includes('\0')||value.length>maximum)throw new HttpError(400,name+' معتبر نیست.');return value.trim();}
function money(value:unknown){try{return rial(value);}catch{throw new HttpError(400,'مبلغ باید عدد صحیح و نامنفی به ریال باشد.');}}
function quantity(value:unknown){try{return quantityValue(value);}catch{throw new HttpError(400,'تعداد باید دارای حداکثر شش رقم اعشار باشد.');}}
async function sequence(db:PostgresDatabase,schema:string,key:string,prefix:string){const table=postgresRelation(schema,'counters');const result=await db.query(`INSERT INTO ${table}(key,value) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET value=${table}.value+1 RETURNING value`,[key]);return prefix+String(safePostgresInteger(result.rows[0].value)).padStart(4,'0');}
async function audit(db:PostgresDatabase,schema:string,scope:Scope,id:number,branch:number,action:string,after:unknown){await db.query(`INSERT INTO ${postgresRelation(schema,'audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES($1,$2,'purchase_order',$3,$4,$5)`,[scope.session.user.id,action,id,JSON.stringify(after),branch]);}

export async function postgresCreatePurchaseOrder(db:PostgresDatabase,schema:string,token:string,branch:number,key:unknown,body:Record<string,unknown>){
 const supplier=validateId(body.supplier_id);
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>200)throw new HttpError(400,'تأمین‌کننده و یک تا دویست قلم خرید لازم است.');
 const items=body.items.map((raw:unknown)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'قلم خرید معتبر نیست.');const row=raw as Record<string,unknown>;
  const qty=quantity(row.qty);if(qty<=0||qty>1000000)throw new HttpError(400,'تعداد خرید معتبر نیست.');
  const cost=money(row.unit_cost),part=row.part_id==null?null:validateId(row.part_id);
  return {part,name:label(row.name,'نام کالا'),qty,cost,total:multiplyRial(cost,qty)};
 });
 const discount=money(body.discount??0),shipping=money(body.shipping??0),gross=sumRial(items.map(item=>item.total));
 if(discount>gross)throw new HttpError(400,'تخفیف از مبلغ خرید بیشتر است.');
 const expected=body.expected_date??null;if(expected!=null&&(typeof expected!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(expected)||!parseDate(expected)))throw new HttpError(400,'تاریخ تحویل معتبر نیست.');
 const notes=body.notes==null?null:label(body.notes,'یادداشت',2000),table=(name:string)=>postgresRelation(schema,name);
 return postgresDurableOperation(db,schema,token,{permission:'purchasing.manage',branchId:branch,operation:'purchase_order_create',key,payload:body,legacyJsonResponse:true},async scope=>{
  if(!(await db.query(`SELECT id FROM ${table('suppliers')} WHERE id=$1`,[supplier])).rowCount)throw new HttpError(400,'تأمین‌کننده یافت نشد.');
  const partIds=[...new Set(items.map(item=>item.part).filter((id):id is number=>id!=null))];
  const parts=(await db.query(`SELECT id,quantity_precision FROM ${table('parts')} WHERE id=ANY($1::bigint[]) AND is_active=1 ORDER BY id FOR SHARE`,[partIds])).rows;
  if(parts.length!==partIds.length)throw new HttpError(400,'کالای فعال سفارش یافت نشد.');
  for(const item of items)if(item.part!=null){const part=parts.find(row=>safePostgresInteger(row.id)===item.part)!;try{quantityMicro(item.qty,safePostgresInteger(part.quantity_precision));}catch{throw new HttpError(400,'دقت تعداد با واحد کالا مطابقت ندارد.');}}
  const settings=(await db.query(`SELECT key,value FROM ${table('settings')} WHERE key=ANY($1::text[])`,[['vat_enabled','tax_rate']])).rows;
  const vat=settings.find(row=>row.key==='vat_enabled')?.value,rate=vat==='0'?0:settings.find(row=>row.key==='tax_rate')?.value??'0';
  let tax:number;try{tax=percentRial(gross-discount,typeof rate==='string'?rate:Number(rate));}catch{throw new HttpError(409,'تنظیم نرخ مالیات معتبر نیست؛ مدیر باید بررسی کند.');}
  const total=sumRial([gross-discount,tax,shipping]);if(body.expected_total!=null&&money(body.expected_total)!==total)throw new HttpError(409,'جمع سفارش تغییر کرده است؛ مبلغ‌ها را تازه‌سازی کنید.');
  const number=await sequence(db,schema,'po','PO-'),row=(await db.query(`INSERT INTO ${table('purchase_orders')}(number,supplier_id,branch_id,date,expected_date,status,items_total,discount,tax,shipping,total,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[number,supplier,branch,new Date().toISOString().slice(0,10),expected,body.send?'sent':'draft',gross,discount,tax,shipping,total,notes,scope.session.user.id])).rows[0];
  const id=safePostgresInteger(row.id),values:unknown[]=[];
  const groups=items.map(item=>'('+[id,item.part,item.name,String(item.qty),item.cost,item.total].map(value=>{values.push(value);return '$'+values.length;}).join(',')+')');
  await db.query(`INSERT INTO ${table('purchase_order_items')}(po_id,part_id,name,qty,unit_cost,total) VALUES ${groups.join(',')}`,values);
  await audit(db,schema,scope,id,branch,'create',{number,total});return {id,number};
 });
}

export async function postgresPurchaseOrders(db:PostgresDatabase,schema:string,token:string,branch:number|null,page=1,size=50){
 if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(size)||size<1||size>100)throw new HttpError(400,'صفحه‌بندی معتبر نیست.');
 return db.transaction(async()=>{
  const scope=await authorizePostgresScope(db,schema,token,'purchasing.view',branch),table=(name:string)=>postgresRelation(schema,name);
  const rows=(await db.query(`SELECT po.*,s.name supplier_name,(SELECT COUNT(*) FROM ${table('purchase_order_items')} i WHERE i.po_id=po.id) item_count FROM ${table('purchase_orders')} po JOIN ${table('suppliers')} s ON s.id=po.supplier_id WHERE ($1::bigint IS NULL OR po.branch_id=$1) ORDER BY po.created_at DESC,po.id DESC LIMIT $2 OFFSET $3`,[scope.branchId,size+1,(page-1)*size])).rows;
  return {purchase_orders:rows.slice(0,size).map(row=>{const result={...row};for(const field of ['id','supplier_id','branch_id','created_by','items_total','discount','tax','shipping','total','item_count'])if(result[field]!=null)result[field]=safePostgresInteger(result[field]);return result;}),page,has_more:rows.length>size};
 },{isolation:'repeatable read',readOnly:true});
}

export async function postgresPurchasePreview(db:PostgresDatabase,schema:string,token:string,branch:number|null,id:number){
 id=validateId(id);return db.transaction(async()=>{
  const actor=await authorizePostgresScope(db,schema,token,'purchasing.manage',branch),table=(name:string)=>postgresRelation(schema,name);
  const po=(await db.query(`SELECT p.*,s.name supplier_name,b.name branch_name FROM ${table('purchase_orders')} p LEFT JOIN ${table('suppliers')} s ON s.id=p.supplier_id LEFT JOIN ${table('branches')} b ON b.id=p.branch_id WHERE p.id=$1 AND ($2::bigint IS NULL OR p.branch_id=$2)`,[id,actor.branchId])).rows[0];if(!po)throw new HttpError(404,'سفارش خرید یافت نشد.');
  const previous=(await db.query(`SELECT id,number,status,subtotal,discount,tax,total FROM ${table('invoices')} WHERE purchase_order_id=$1 AND status<>'cancelled' ORDER BY id LIMIT 2`,[id])).rows;
  if(previous.length>1)throw new HttpError(409,'بیش از یک تعهد فعال برای سفارش وجود دارد؛ بررسی مالی لازم است.');
  const existing=previous[0],ready=['received','partially_received'].includes(String(po.status)),source=ready&&!existing?await postgresPurchaseInvoiceSource(db,schema,po):null;
  return {po:{id,number:String(po.number),supplier_id:safePostgresInteger(po.supplier_id),supplier_name:po.supplier_name??null,branch_name:po.branch_name??null,status:String(po.status),total:safePostgresInteger(po.total),discount:source?.totals.discount??0},ready_to_invoice:ready,source_totals:source?.totals??(existing?{gross:safePostgresInteger(existing.subtotal),discount:safePostgresInteger(existing.discount),tax:safePostgresInteger(existing.tax),duty:0,total:safePostgresInteger(existing.total)}:null),existing_invoice:existing?{id:safePostgresInteger(existing.id),number:String(existing.number),status:String(existing.status),total:safePostgresInteger(existing.total)}:null,items:source?.items.map(item=>({...item,qty:quantity(item.qty)}))??[]};
 },{isolation:'repeatable read',readOnly:true});
}

export async function postgresPurchaseAction(db:PostgresDatabase,schema:string,token:string,branch:number|null,id:number,key:unknown,body:Record<string,unknown>){
 id=validateId(id);const table=(name:string)=>postgresRelation(schema,name);
 return db.transaction(async()=>{
  const actor=await authorizePostgresScope(db,schema,token,'purchasing.manage',branch,true);
  const source=(await db.query(`SELECT branch_id FROM ${table('purchase_orders')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[id,actor.branchId])).rows[0];if(!source)throw new HttpError(404,'سفارش خرید یافت نشد.');
  const owner=safePostgresInteger(source.branch_id);
  return postgresDurableOperation(db,schema,token,{permission:'purchasing.manage',branchId:owner,operation:'purchase_order_action',key,payload:{po_id:id,...body},legacyJsonResponse:true},async scope=>{
   const po=(await db.query(`SELECT * FROM ${table('purchase_orders')} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
   if(body.action==='send'){
    if(po.status==='sent')return {ok:true,already:true};if(po.status!=='draft')throw new HttpError(409,'فقط پیش‌نویس سفارش قابل ارسال است.');
    await db.query(`UPDATE ${table('purchase_orders')} SET status='sent' WHERE id=$1`,[id]);await audit(db,schema,scope,id,owner,'send',{status:'sent'});return {ok:true};
   }
   if(body.action==='cancel'){
    if(['partially_received','received'].includes(po.status))throw new HttpError(409,'سفارش دارای رسید کالا نیازمند برگشت به تأمین‌کننده است.');
    await db.query(`UPDATE ${table('purchase_orders')} SET status='cancelled' WHERE id=$1`,[id]);await audit(db,schema,scope,id,owner,'cancel',{status:'cancelled'});return {ok:true};
   }
   if(body.action!=='receive')throw new HttpError(400,'عملیات سفارش معتبر نیست.');
   if(!['draft','sent','partially_received'].includes(po.status))throw new HttpError(409,'امکان دریافت کالا برای وضعیت فعلی وجود ندارد.');
   if(!Array.isArray(body.items)||!body.items.length||body.items.length>200)throw new HttpError(400,'اقلام دریافتی معتبر نیستند.');
   const entries=body.items.map((raw:unknown)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'قلم رسید معتبر نیست.');const row=raw as Record<string,unknown>;return {id:validateId(row.item_id),qty:quantity(row.qty)};});
   const seen=new Set<number>();for(const entry of entries){if(seen.has(entry.id))throw new HttpError(400,'قلم دریافت تکراری است.');seen.add(entry.id);}
   const rows=(await db.query(`SELECT * FROM ${table('purchase_order_items')} WHERE po_id=$1 ORDER BY id FOR UPDATE`,[id])).rows;
   for(const entry of entries){const line=rows.find(row=>safePostgresInteger(row.id)===entry.id);if(!line||quantityMicro(entry.qty)>quantityMicro(quantity(line.qty))-quantityMicro(quantity(line.received_qty)))throw new HttpError(409,'تعداد دریافتی از مانده سفارش بیشتر است.');}
   if(!entries.some(entry=>entry.qty>0))throw new HttpError(400,'حداقل یک قلم باید دریافت شود.');
   const number=await sequence(db,schema,'goods_receipt','GR-'),receipt=(await db.query(`INSERT INTO ${table('goods_receipts')}(po_id,number,received_by,notes) VALUES($1,$2,$3,$4) RETURNING id`,[id,number,scope.session.user.id,body.notes==null?null:label(body.notes,'یادداشت',2000)])).rows[0],receiptId=safePostgresInteger(receipt.id);
   for(const entry of entries){
    if(entry.qty===0)continue;const line=rows.find(row=>safePostgresInteger(row.id)===entry.id)!;
    await db.query(`UPDATE ${table('purchase_order_items')} SET received_qty=$1 WHERE id=$2`,[String(addQuantity(quantity(line.received_qty),entry.qty)),entry.id]);
    let movement:number|null=null;
    if(line.part_id!=null){const result=await movePostgresStock(db,schema,{part_id:safePostgresInteger(line.part_id),qty:entry.qty,type:'purchase',ref_type:'goods_receipt',ref_id:receiptId,source_line_id:entry.id,unit_cost:safePostgresInteger(line.unit_cost),user_id:scope.session.user.id,branch_id:owner,note:'دریافت روی '+po.number+' ('+number+')'},scope);movement=result.id;}
    await db.query(`INSERT INTO ${table('pg_purchase_receipt_lines')}(receipt_id,item_id,qty_micro,movement_id) VALUES($1,$2,$3,$4)`,[receiptId,entry.id,quantityMicro(entry.qty).toString(),movement]);
   }
   const remaining=(await db.query(`SELECT SUM(qty-received_qty)::text value FROM ${table('purchase_order_items')} WHERE po_id=$1`,[id])).rows[0].value;
   await db.query(`UPDATE ${table('purchase_orders')} SET status=$1 WHERE id=$2`,[Number(remaining)===0?'received':'partially_received',id]);await audit(db,schema,scope,id,owner,'receive',{receipt:number});
   return {ok:true,received:number};
  });
 });
}

export function postgresPurchasingGuardStatements(schema:string){
 const table=(name:string)=>postgresRelation(schema,name);
 return [
  `CREATE TABLE ${table('pg_purchase_receipt_lines')}(receipt_id bigint NOT NULL REFERENCES ${table('goods_receipts')}(id),item_id bigint NOT NULL REFERENCES ${table('purchase_order_items')}(id),qty_micro bigint NOT NULL CHECK(qty_micro>0 AND qty_micro<=1000000000000),movement_id bigint UNIQUE REFERENCES ${table('inventory_movements')}(id),PRIMARY KEY(receipt_id,item_id))`,
  `CREATE FUNCTION ${table('po_port_immutable')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN RAISE EXCEPTION 'Purchase receipt evidence is immutable' USING ERRCODE='23514'; END $fn$`,
  `CREATE FUNCTION ${table('po_port_document')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN
   IF NEW.total IS NULL OR NEW.items_total IS NULL OR NEW.discount IS NULL OR NEW.tax IS NULL OR NEW.shipping IS NULL OR NEW.status IS NULL OR NEW.items_total<0 OR NEW.discount<0 OR NEW.discount>NEW.items_total OR NEW.tax<0 OR NEW.shipping<0 OR NEW.total<>NEW.items_total-NEW.discount+NEW.tax+NEW.shipping OR NEW.total>9007199254740991 OR NEW.branch_id IS NULL OR NEW.created_by IS NULL THEN RAISE EXCEPTION 'Invalid exact purchase obligation' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' AND NEW.status NOT IN ('draft','sent') THEN RAISE EXCEPTION 'Purchase must start as draft or sent' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR NOT(NEW.status=OLD.status OR OLD.status='draft' AND NEW.status IN ('sent','cancelled','partially_received','received') OR OLD.status='sent' AND NEW.status IN ('cancelled','partially_received','received') OR OLD.status='partially_received' AND NEW.status IN ('partially_received','received'))) THEN RAISE EXCEPTION 'Purchase source history or state cannot be rewritten' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
  `CREATE FUNCTION ${table('po_port_item')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN
   IF NEW.qty IS NULL OR NEW.qty<=0 OR NEW.qty>1000000 OR NEW.qty*1000000<>trunc(NEW.qty*1000000) OR NEW.received_qty IS NULL OR NEW.received_qty<0 OR NEW.received_qty>NEW.qty OR NEW.received_qty*1000000<>trunc(NEW.received_qty*1000000) OR NEW.unit_cost IS NULL OR NEW.unit_cost<0 OR NEW.unit_cost>9007199254740991 OR NEW.total IS NULL OR NEW.total<>floor(NEW.unit_cost::numeric*NEW.qty+0.5) OR NEW.total>9007199254740991 THEN RAISE EXCEPTION 'Purchase item precision or amount is invalid' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' AND NEW.received_qty<>0 THEN RAISE EXCEPTION 'New purchase item cannot claim historical receipts' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'received_qty') IS DISTINCT FROM (to_jsonb(OLD)-'received_qty') OR NEW.received_qty<OLD.received_qty) THEN RAISE EXCEPTION 'Purchase item changes require a return or correction document' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
  `CREATE FUNCTION ${table('po_port_proof')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ DECLARE order_id bigint; order_row record; BEGIN
   IF TG_TABLE_NAME='purchase_orders' THEN order_id:=NEW.id; ELSE order_id:=NEW.po_id; END IF;
   SELECT * INTO order_row FROM ${table('purchase_orders')} WHERE id=order_id;
   IF order_row.items_total IS DISTINCT FROM (SELECT SUM(total)::bigint FROM ${table('purchase_order_items')} WHERE po_id=order_id) OR (SELECT COUNT(*) FROM ${table('purchase_order_items')} WHERE po_id=order_id) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Purchase header and item totals differ' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM ${table('purchase_order_items')} i WHERE i.po_id=order_id AND i.received_qty*1000000<>COALESCE((SELECT SUM(l.qty_micro)::numeric FROM ${table('pg_purchase_receipt_lines')} l WHERE l.item_id=i.id),0)) THEN RAISE EXCEPTION 'Received quantity requires exact immutable receipt lines; legacy receipts require review' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM ${table('operation_receipts')} r WHERE r.actor_id=order_row.created_by AND r.branch_id=order_row.branch_id AND r.operation='purchase_order_create' AND r.result_json::jsonb->>'id'=order_id::text) OR NOT EXISTS(SELECT 1 FROM ${table('audit_logs')} a WHERE a.entity='purchase_order' AND a.entity_id=order_id AND a.action='create' AND a.user_id=order_row.created_by AND a.branch_id=order_row.branch_id) THEN RAISE EXCEPTION 'Purchase source requires durable creation and audit evidence' USING ERRCODE='23514'; END IF;
   IF order_row.status IN ('partially_received','received') AND (order_row.status='received') IS DISTINCT FROM (NOT EXISTS(SELECT 1 FROM ${table('purchase_order_items')} WHERE po_id=order_id AND received_qty<>qty)) THEN RAISE EXCEPTION 'Purchase receipt state differs from quantities' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
  `CREATE FUNCTION ${table('po_port_receipt')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ DECLARE source record; owner record; BEGIN
   SELECT * INTO source FROM ${table('purchase_order_items')} WHERE id=NEW.item_id;
   SELECT g.*,p.branch_id INTO owner FROM ${table('goods_receipts')} g JOIN ${table('purchase_orders')} p ON p.id=g.po_id WHERE g.id=NEW.receipt_id;
   IF source.id IS NULL OR owner.id IS NULL OR source.po_id<>owner.po_id OR (source.part_id IS NULL) IS DISTINCT FROM (NEW.movement_id IS NULL) THEN RAISE EXCEPTION 'Receipt line does not belong to its source purchase' USING ERRCODE='23514'; END IF;
   IF source.part_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${table('inventory_movements')} m WHERE m.id=NEW.movement_id AND m.part_id=source.part_id AND m.type='purchase' AND m.ref_type='goods_receipt' AND m.ref_id=NEW.receipt_id AND m.source_line_id=NEW.item_id AND m.branch_id=owner.branch_id AND m.qty*1000000=NEW.qty_micro AND m.unit_cost=source.unit_cost) THEN RAISE EXCEPTION 'Physical goods receipt requires its exact source inventory movement' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM ${table('operation_receipts')} r WHERE r.actor_id=owner.received_by AND r.branch_id=owner.branch_id AND r.operation='purchase_order_action' AND r.result_json::jsonb->>'received'=owner.number) OR NOT EXISTS(SELECT 1 FROM ${table('audit_logs')} a WHERE a.entity='purchase_order' AND a.entity_id=owner.po_id AND a.action='receive' AND a.user_id=owner.received_by AND a.branch_id=owner.branch_id AND a."after"::jsonb->>'receipt'=owner.number) THEN RAISE EXCEPTION 'Purchase receipt requires durable operation and audit' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
  `CREATE TRIGGER po_port_document BEFORE INSERT OR UPDATE ON ${table('purchase_orders')} FOR EACH ROW EXECUTE FUNCTION ${table('po_port_document')}()`,
  `CREATE TRIGGER po_port_item BEFORE INSERT OR UPDATE ON ${table('purchase_order_items')} FOR EACH ROW EXECUTE FUNCTION ${table('po_port_item')}()`,
  `CREATE CONSTRAINT TRIGGER po_port_proof AFTER INSERT OR UPDATE ON ${table('purchase_orders')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${table('po_port_proof')}()`,
  `CREATE CONSTRAINT TRIGGER po_port_item_proof AFTER INSERT OR UPDATE ON ${table('purchase_order_items')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${table('po_port_proof')}()`,
  `CREATE CONSTRAINT TRIGGER po_port_receipt AFTER INSERT ON ${table('pg_purchase_receipt_lines')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${table('po_port_receipt')}()`,
  ...['purchase_orders','purchase_order_items'].map(name=>`CREATE TRIGGER po_port_delete BEFORE DELETE OR TRUNCATE ON ${table(name)} FOR EACH STATEMENT EXECUTE FUNCTION ${table('po_port_immutable')}()`),
  ...['goods_receipts','pg_purchase_receipt_lines'].map(name=>`CREATE TRIGGER po_port_history BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table(name)} FOR EACH STATEMENT EXECUTE FUNCTION ${table('po_port_immutable')}()`),
  ...['purchase_orders','purchase_order_items','goods_receipts'].map(name=>`DROP TRIGGER repaid_unported_write ON ${table(name)}`),
 ];
}
export async function installPostgresPurchasingGuards(db:PostgresDatabase,schema:string){for(const statement of postgresPurchasingGuardStatements(schema))await db.query(statement);}
