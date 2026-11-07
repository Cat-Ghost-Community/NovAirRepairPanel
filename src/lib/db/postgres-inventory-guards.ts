import {createHash} from 'node:crypto';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';
import {verifyChatNotificationProducerGuards} from './pg-chat-notifications';

function definitions(schema:string){
 const q=(name:string)=>postgresRelation(schema,name),maximum='9007199254740991';
 return {
  pg_inventory_part_cost:`BEGIN
   IF NEW.quantity_precision IS NULL OR NEW.quantity_precision NOT BETWEEN 0 AND 6 OR (NEW.avg_cost IS NOT NULL AND (NEW.avg_cost<0 OR NEW.avg_cost>9007199254740991)) THEN RAISE EXCEPTION 'Invalid catalogue precision or exact unit cost' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM ${q('inventory_movements')} WHERE part_id=OLD.id) AND (NEW.quantity_precision IS DISTINCT FROM OLD.quantity_precision OR (NEW.avg_cost IS DISTINCT FROM OLD.avg_cost AND pg_trigger_depth()<2)) THEN RAISE EXCEPTION 'Historical quantity precision and inventory cost require a source movement or approved correction' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  pg_inventory_apply_average:`DECLARE quantity_micros numeric; total_value numeric; previous_average bigint; prior_micros numeric; numerator numeric; next_average numeric; BEGIN
   SELECT COALESCE(SUM(qty*1000000),0),COALESCE(SUM(carrying_value::numeric),0) INTO quantity_micros,total_value FROM ${q('inventory_stock')} WHERE part_id=NEW.part_id;
   IF NEW.valuation_json IS NOT NULL THEN
    IF quantity_micros>0 THEN next_average:=div(total_value*2000000+quantity_micros,quantity_micros*2); END IF;
   ELSIF NEW.type IN ('purchase','return') AND NEW.unit_cost IS NOT NULL THEN
    SELECT avg_cost INTO previous_average FROM ${q('parts')} WHERE id=NEW.part_id FOR UPDATE;
    prior_micros:=quantity_micros-NEW.qty*1000000;
    IF quantity_micros>0 THEN numerator:=COALESCE(previous_average,NEW.unit_cost)::numeric*prior_micros+NEW.unit_cost::numeric*NEW.qty*1000000;next_average:=div(numerator*2+quantity_micros,quantity_micros*2); ELSE next_average:=NEW.unit_cost; END IF;
   END IF;
   IF next_average IS NOT NULL THEN UPDATE ${q('parts')} SET avg_cost=next_average::bigint WHERE id=NEW.part_id; END IF; RETURN NEW; END`,
  pg_inventory_shape:`DECLARE precision integer; branch bigint; BEGIN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Stock position history cannot be deleted' USING ERRCODE='23514'; END IF;
   PERFORM pg_advisory_xact_lock(hashtext('${schema}'),hashtext('inventory-part:'||NEW.part_id::text));
   SELECT p.quantity_precision,l.branch_id INTO precision,branch FROM ${q('parts')} p CROSS JOIN ${q('inventory_locations')} l WHERE p.id=NEW.part_id AND l.id=NEW.location_id;
   IF precision IS NULL OR precision NOT BETWEEN 0 AND 6 OR branch IS NULL OR NEW.qty IS NULL OR NEW.reserved IS NULL OR NEW.qty<0 OR NEW.reserved<0 OR NEW.reserved>NEW.qty OR (NEW.qty::text)::numeric*1000000>${maximum} OR (NEW.qty::text)::numeric*power(10::numeric,precision)<>trunc((NEW.qty::text)::numeric*power(10::numeric,precision)) OR (NEW.reserved::text)::numeric*power(10::numeric,precision)<>trunc((NEW.reserved::text)::numeric*power(10::numeric,precision)) THEN RAISE EXCEPTION 'Invalid scoped stock quantity or reservation' USING ERRCODE='23514'; END IF;
   IF NEW.carrying_value IS NOT NULL AND (NEW.carrying_value<0 OR NEW.carrying_value>${maximum} OR NEW.valuation_json IS NULL OR NEW.valuation_json::jsonb->>'method' IS DISTINCT FROM 'location_carrying_v1' OR NOT(NEW.valuation_json::jsonb ?& ARRAY['qty_micro','used_micro','value','used_value','policy_id']) OR EXISTS(SELECT 1 FROM jsonb_each_text(NEW.valuation_json::jsonb) x WHERE x.key IN ('qty_micro','used_micro','value','used_value','policy_id') AND (x.value !~ '^[0-9]+$' OR length(x.value)>16 OR x.value::numeric>9007199254740991)) OR NOT EXISTS(SELECT 1 FROM ${q('accounting_recognition_policies')} p WHERE p.id=(NEW.valuation_json::jsonb->>'policy_id')::bigint AND p.branch_id=branch AND p.kind='inventory_carrying_v1' AND p.status='approved' AND p.effective_date<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD')) OR (NEW.valuation_json::jsonb->>'qty_micro')::numeric-(NEW.valuation_json::jsonb->>'used_micro')::numeric<>(NEW.qty::text)::numeric*1000000 OR (NEW.valuation_json::jsonb->>'value')::numeric-(NEW.valuation_json::jsonb->>'used_value')::numeric<>NEW.carrying_value) THEN RAISE EXCEPTION 'Carrying position disagrees with immutable depletion pool' USING ERRCODE='23514'; END IF;
   IF NEW.carrying_value IS NULL AND NEW.valuation_json IS NOT NULL THEN RAISE EXCEPTION 'Unclassified valuation state' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND (NEW.part_id,NEW.location_id) IS DISTINCT FROM (OLD.part_id,OLD.location_id) THEN RAISE EXCEPTION 'Stock position identity is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  pg_inventory_movement:`DECLARE precision integer; branch bigint; BEGIN
   IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Stock movement history is immutable' USING ERRCODE='23514'; END IF;
   PERFORM pg_advisory_xact_lock(hashtext('${schema}'),hashtext('inventory-part:'||NEW.part_id::text));
   SELECT p.quantity_precision,l.branch_id INTO precision,branch FROM ${q('parts')} p CROSS JOIN ${q('inventory_locations')} l WHERE p.id=NEW.part_id AND l.id=NEW.location_id;
   IF branch IS NULL OR NEW.branch_id IS DISTINCT FROM branch OR NEW.qty=0 OR NEW.qty IS NULL OR precision IS NULL OR precision NOT BETWEEN 0 AND 6 OR abs((NEW.qty::text)::numeric)*1000000>${maximum} OR abs((NEW.qty::text)::numeric)*power(10::numeric,precision)<>trunc(abs((NEW.qty::text)::numeric)*power(10::numeric,precision)) OR NEW.unit_cost IS NULL OR NEW.unit_cost<0 OR NEW.unit_cost>${maximum} OR (NEW.extended_cost IS NOT NULL AND (NEW.extended_cost<0 OR NEW.extended_cost>${maximum})) OR NEW.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM ${q('users')} WHERE id=NEW.user_id AND is_active=1 AND (role IN ('owner','admin') OR branch_id=branch)) THEN RAISE EXCEPTION 'Invalid exact movement, branch or actor' USING ERRCODE='23514'; END IF;
   IF NEW.type NOT IN ('purchase','sale','repair_consumption','return','adjustment','transfer_in','transfer_out','damage','loss','warranty_return','supplier_return') OR (NEW.type IN ('sale','repair_consumption','supplier_return','transfer_out','damage','loss') AND NEW.qty>=0) OR (NEW.type IN ('purchase','return','warranty_return','transfer_in') AND NEW.qty<=0) THEN RAISE EXCEPTION 'Invalid stock movement direction' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  pg_inventory_position_proof:`DECLARE part bigint; location bigint; actual numeric; expected numeric; BEGIN
   part:=NEW.part_id;location:=NEW.location_id;
   SELECT (qty::text)::numeric*1000000 INTO actual FROM ${q('inventory_stock')} WHERE part_id=part AND location_id=location;
   SELECT COALESCE(SUM((qty::text)::numeric*1000000),0) INTO expected FROM ${q('inventory_movements')} WHERE part_id=part AND location_id=location;
   IF actual IS NULL OR actual<>expected THEN RAISE EXCEPTION 'Stock position does not reconcile with immutable source movements' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='inventory_movements' THEN
    IF NOT EXISTS(SELECT 1 FROM ${q('accounting_events')} e WHERE e.source_type='stock' AND e.source_id=NEW.id::text AND e.event_type='movement' AND e.branch_id=NEW.branch_id AND (e.payload_json::jsonb#>>'{document,id}')=NEW.id::text) THEN RAISE EXCEPTION 'Stock source event is missing' USING ERRCODE='23514'; END IF;
   END IF; RETURN NULL; END`,
  pg_inventory_location_owner:`BEGIN IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND (EXISTS(SELECT 1 FROM ${q('inventory_movements')} WHERE location_id=OLD.id) OR EXISTS(SELECT 1 FROM ${q('inventory_stock')} WHERE location_id=OLD.id)) THEN RAISE EXCEPTION 'Warehouse historical branch ownership is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  pg_inventory_transfer_proof:`DECLARE outgoing bigint; incoming bigint; total integer; BEGIN
   SELECT COUNT(*),COUNT(*) FILTER(WHERE type='transfer_out' AND location_id=NEW.from_location AND qty=-NEW.qty),COUNT(*) FILTER(WHERE type='transfer_in' AND location_id=NEW.to_location AND qty=NEW.qty) INTO total,outgoing,incoming FROM ${q('inventory_movements')} WHERE ref_type='inventory_transfer' AND ref_id=NEW.id AND part_id=NEW.part_id;
   IF NEW.qty<=0 OR NEW.from_location=NEW.to_location OR total<>2 OR outgoing<>1 OR incoming<>1 OR (SELECT COALESCE(SUM(CASE WHEN type='transfer_out' THEN -COALESCE(extended_cost,round(unit_cost::numeric*abs((qty::text)::numeric))) ELSE COALESCE(extended_cost,round(unit_cost::numeric*abs((qty::text)::numeric))) END),0) FROM ${q('inventory_movements')} WHERE ref_type='inventory_transfer' AND ref_id=NEW.id)<>0 THEN RAISE EXCEPTION 'Transfer quantity and value must be conserved by exactly two legs' USING ERRCODE='23514'; END IF; RETURN NULL; END`,
  pg_inventory_transfer_immutable:`BEGIN RAISE EXCEPTION 'Physical transfer evidence is immutable' USING ERRCODE='23514'; END`,
  pg_inventory_notification:`BEGIN IF NEW.title IS NULL OR NEW.title<>'موجودی کم' OR NEW.link IS NULL OR NEW.link !~ '^/parts/[1-9][0-9]*$' OR NOT EXISTS(SELECT 1 FROM ${q('users')} WHERE id=NEW.user_id AND role IN ('owner','admin') AND is_active=1) THEN RAISE EXCEPTION 'Only manager-owned native stock alerts are enabled in this notification slice' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
 };
}
const triggerPlan=[
 ['parts','pg_stock_part_cost','pg_inventory_part_cost','BEFORE INSERT OR UPDATE','ROW'],
 ['inventory_movements','pg_stock_average','pg_inventory_apply_average','AFTER INSERT','ROW'],
 ['inventory_stock','pg_stock_shape','pg_inventory_shape','BEFORE INSERT OR UPDATE OR DELETE','ROW'],
 ['inventory_movements','pg_stock_movement_shape','pg_inventory_movement','BEFORE INSERT OR UPDATE OR DELETE','ROW'],
 ['inventory_movements','pg_stock_movement_truncate','pg_inventory_transfer_immutable','BEFORE TRUNCATE','STATEMENT'],
 ['inventory_stock','pg_stock_position_commit','pg_inventory_position_proof','AFTER INSERT OR UPDATE','DEFERRED'],
 ['inventory_movements','pg_stock_movement_commit','pg_inventory_position_proof','AFTER INSERT','DEFERRED'],
 ['inventory_locations','pg_stock_location_owner','pg_inventory_location_owner','BEFORE UPDATE','ROW'],
 ['inventory_transfers','pg_stock_transfer_immutable','pg_inventory_transfer_immutable','BEFORE UPDATE OR DELETE OR TRUNCATE','STATEMENT'],
 ['inventory_transfers','pg_stock_transfer_commit','pg_inventory_transfer_proof','AFTER INSERT','DEFERRED'],
 ['notifications','pg_stock_notification','pg_inventory_notification','BEFORE INSERT','ROW'],
] as const;
export function postgresInventoryGuardChecksum(){return createHash('sha256').update(JSON.stringify({functions:definitions('repaid'),triggerPlan,indexes:['position:part_id,location_id,id','unique:ref_type,ref_id,source_line_id,part_id,location_id,type;nulls_not_distinct;source_line_domains_v1']})).digest('hex');}
export async function installPostgresInventoryGuards(db:PostgresDatabase,schema:string){
 const q=(name:string)=>postgresRelation(schema,name),functions=definitions(schema);
 return db.transaction(async()=>{await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204341)',[schema]);const existing=await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'pg_inventory_shape']);if(existing.rowCount){await verifyPostgresInventoryGuards(db,schema);return {installed:true,replayed:true};}
  if((await db.query(`SELECT 1 FROM ${q('inventory_stock')} s LEFT JOIN (SELECT part_id,location_id,SUM((qty::text)::numeric*1000000) micros FROM ${q('inventory_movements')} GROUP BY part_id,location_id) m ON m.part_id=s.part_id AND m.location_id=s.location_id WHERE (s.qty::text)::numeric*1000000<>COALESCE(m.micros,0) LIMIT 1`)).rowCount)throw Error('Legacy stock positions require independently reviewed source reconciliation before native inventory enablement');
  for(const [name,body] of Object.entries(functions))await db.query(`CREATE FUNCTION ${q(name)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $inventory$${body}$inventory$`);
  for(const [table,trigger,fn,timing,kind] of triggerPlan)await db.query(kind==='DEFERRED'?`CREATE CONSTRAINT TRIGGER "${trigger}" ${timing} ON ${q(table)} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${q(fn)}()`:`CREATE TRIGGER "${trigger}" ${timing} ON ${q(table)} FOR EACH ${kind} EXECUTE FUNCTION ${q(fn)}()`);
  await db.query(`CREATE INDEX pg_inventory_position_history ON ${q('inventory_movements')}(part_id,location_id,id)`);
  await db.query(`CREATE UNIQUE INDEX pg_inventory_line_identity ON ${q('inventory_movements')}(ref_type,ref_id,source_line_id,part_id,location_id,type) NULLS NOT DISTINCT WHERE (ref_type IN ('invoice','goods_receipt') AND source_line_id IS NOT NULL) OR ref_type IN ('business_return','inventory_transfer','ticket_item')`);
  await verifyPostgresInventoryGuards(db,schema);return {installed:true,replayed:false};
 });
}
export async function verifyPostgresInventoryGuards(db:PostgresDatabase,schema:string){
 const expected=definitions(schema),rows=(await db.query(`SELECT p.proname,p.prosrc,p.prosecdef,p.proconfig,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.proname=ANY($2::text[])`,[schema,Object.keys(expected)])).rows;
 if(rows.length!==Object.keys(expected).length||rows.some(row=>row.prosrc!==expected[String(row.proname) as keyof typeof expected]||row.prosecdef||row.lanname!=='plpgsql'||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=pg_catalog'])))throw Error('Native inventory guard function missing or altered');
 const triggers=(await db.query(`SELECT t.tgname,t.tgenabled,t.tgtype,t.tgnargs,t.tgqual IS NOT NULL conditional,t.tgdeferrable,t.tginitdeferred,c.relname,p.proname,pn.nspname function_schema FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname=$1 AND t.tgname=ANY($2::text[])`,[schema,triggerPlan.map(entry=>entry[1])])).rows;
 const router=triggers.find(row=>row.tgname==='pg_stock_notification')?.proname;
 const routed=['repaid_chat_notification_router','pg_repair_assignment_notification_router'].includes(String(router));
 // Version6 may upgrade the producer only after its exact source/mapping/guards
 // verify. Original version4 functions and checksum remain unchanged.
 if(routed)await verifyChatNotificationProducerGuards(db,schema);
 if(triggers.length!==triggerPlan.length||triggerPlan.some(([table,name,fn,timing,kind])=>{
  const mask=(kind==='STATEMENT'?0:1)+(timing.startsWith('BEFORE')?2:0)+(timing.includes('INSERT')?4:0)+(timing.includes('DELETE')?8:0)+(timing.includes('UPDATE')?16:0)+(timing.includes('TRUNCATE')?32:0);
  const actualFunction=routed&&name==='pg_stock_notification'?router:fn;
  return !triggers.some(row=>row.relname===table&&row.tgname===name&&row.proname===actualFunction&&row.function_schema===schema&&row.tgenabled==='O'&&row.tgtype===mask&&row.tgnargs===0&&!row.conditional&&row.tgdeferrable===(kind==='DEFERRED')&&row.tginitdeferred===(kind==='DEFERRED'));
 }))throw Error('Native inventory trigger missing, disabled or altered');
 const indexes=(await db.query('SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=ANY($2::text[])',[schema,['pg_inventory_position_history','pg_inventory_line_identity']])).rows;if(indexes.length!==2||!indexes.some(row=>row.indexname==='pg_inventory_line_identity'&&String(row.indexdef).includes('UNIQUE INDEX')&&String(row.indexdef).includes('NULLS NOT DISTINCT')))throw Error('Native inventory identity indexes missing or altered');
 return {verified:true,functions:rows.length,triggers:triggers.length,definition_sha256:createHash('sha256').update(JSON.stringify(expected)).digest('hex')};
}
