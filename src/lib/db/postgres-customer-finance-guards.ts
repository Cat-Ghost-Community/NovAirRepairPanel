import {createHash} from 'node:crypto';
import type {PostgresDatabase} from './postgres';
import {postgresRelation} from './postgres-auth';

export const CUSTOMER_FINANCE_TABLES=['invoices','invoice_items','payments','refunds','installments','installment_schedules','installment_schedule_terms','installment_allocations','installment_allocation_reversals'] as const;
function guardBody(schema:string){const t=(n:string)=>postgresRelation(schema,n);return `
DECLARE parent record; original record; n numeric; used numeric; held numeric; before_total numeric; expected numeric;
BEGIN
 IF TG_OP='DELETE' AND TG_TABLE_NAME='invoice_items' AND EXISTS(SELECT 1 FROM ${t('invoices')} WHERE id=((to_jsonb(OLD)->>'invoice_id')::bigint) AND status='draft') THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN ('payments','refunds','installment_allocations','installment_allocation_reversals') AND TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME IN ('payments','refunds') AND (to_jsonb(OLD)->>'invoice_id') IS NULL AND (to_jsonb(NEW)->>'invoice_id') IS NOT NULL
   AND (to_jsonb(NEW)-'invoice_id')=(to_jsonb(OLD)-'invoice_id') THEN
   SELECT * INTO parent FROM ${t('invoices')} WHERE id=NEW.invoice_id FOR UPDATE;
   IF parent.branch_id=NEW.branch_id AND parent.customer_id IS NOT DISTINCT FROM NEW.customer_id AND parent.sale_id IS NOT DISTINCT FROM NEW.sale_id
    AND ((TG_TABLE_NAME='payments' AND parent.ticket_id IS NOT DISTINCT FROM ((to_jsonb(NEW)->>'ticket_id')::bigint)) OR TG_TABLE_NAME='refunds') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Original monetary evidence is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='invoices' THEN
  IF NEW.type NOT IN ('sale','repair','purchase') OR NEW.branch_id IS NULL OR NEW.total<0 OR NEW.subtotal<0 OR NEW.discount<0 OR NEW.discount>NEW.subtotal OR NEW.tax<0
   OR NEW.total>9007199254740991 OR NEW.paid<0 OR NOT EXISTS(SELECT 1 FROM ${t('branches')} WHERE id=NEW.branch_id) THEN RAISE EXCEPTION 'Invalid exact invoice or branch' USING ERRCODE='23514'; END IF;
  IF (NEW.type='purchase' AND (NEW.supplier_id IS NULL OR NOT EXISTS(SELECT 1 FROM ${t('suppliers')} WHERE id=NEW.supplier_id))) OR
   (NEW.type!='purchase' AND (NEW.customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM ${t('customer_branch_access')} WHERE customer_id=NEW.customer_id AND branch_id=NEW.branch_id))) THEN RAISE EXCEPTION 'Invoice party is outside source branch' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status!='draft' AND (to_jsonb(NEW)-ARRAY['paid','status','cancelled_at','cancel_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['paid','status','cancelled_at','cancel_reason']) THEN RAISE EXCEPTION 'Final invoice source is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) AND
   (EXISTS(SELECT 1 FROM ${t('installment_schedules')} WHERE invoice_id=OLD.id) OR EXISTS(SELECT 1 FROM ${t('installments')} WHERE invoice_id=OLD.id)) THEN RAISE EXCEPTION 'Scheduled ownership is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='cancelled' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Cancelled invoice history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.status!='draft' THEN RAISE EXCEPTION 'Invoice starts as draft' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status NOT IN ('draft','cancelled') THEN
   SELECT COUNT(*),COALESCE(SUM(round(qty*unit_price)),0) INTO used,n FROM ${t('invoice_items')} WHERE invoice_id=NEW.id;
   IF used=0 OR n!=NEW.subtotal THEN RAISE EXCEPTION 'Invoice lines disagree with gross amount' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.status='cancelled' AND TG_OP='UPDATE' AND OLD.status!='cancelled' AND
   (EXISTS(SELECT 1 FROM ${t('installment_schedules')} WHERE invoice_id=NEW.id AND status='active') OR EXISTS(SELECT 1 FROM ${t('effective_invoices')} WHERE id=NEW.id AND paid>0) OR EXISTS(SELECT 1 FROM ${t('business_returns')} WHERE invoice_id=NEW.id AND state!='rejected')) THEN RAISE EXCEPTION 'Controlled correction required before cancellation' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='invoice_items' THEN
  SELECT * INTO parent FROM ${t('invoices')} WHERE id=NEW.invoice_id FOR UPDATE;
  IF parent.id IS NULL OR parent.status!='draft' OR NEW.qty<=0 OR NEW.qty>100000 OR NEW.qty*1000000!=trunc(NEW.qty*1000000) OR NEW.unit_price<0 OR NEW.cost<0 OR NEW.line_discount<0 OR NEW.line_discount>round(NEW.qty*NEW.unit_price) OR NEW.total!=round(NEW.qty*NEW.unit_price)-NEW.line_discount THEN RAISE EXCEPTION 'Invalid exact or immutable invoice line' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='payments' THEN
  IF NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.direction NOT IN ('in','out') OR NEW.method NOT IN ('cash','card','transfer','check','cheque','other') OR NEW.branch_id IS NULL THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='23514'; END IF;
  IF NEW.invoice_id IS NOT NULL THEN
   SELECT * INTO parent FROM ${t('invoices')} WHERE id=NEW.invoice_id FOR UPDATE;
   SELECT total,paid INTO original FROM ${t('effective_invoices')} WHERE id=NEW.invoice_id;
   SELECT COALESCE(SUM(p.amount),0) INTO held FROM ${t('payments')} p WHERE p.invoice_id=NEW.invoice_id AND p.direction=NEW.direction AND p.method IN ('check','cheque') AND EXISTS(SELECT 1 FROM ${t('checks')} c WHERE c.payment_id=p.id AND c.status IN ('in_hand','deposited','transferred_spend'));
   IF parent.id IS NULL OR parent.status IN ('draft','cancelled') OR parent.branch_id!=NEW.branch_id OR parent.customer_id IS DISTINCT FROM NEW.customer_id OR parent.supplier_id IS DISTINCT FROM NEW.supplier_id OR parent.sale_id IS DISTINCT FROM NEW.sale_id OR parent.ticket_id IS DISTINCT FROM NEW.ticket_id OR NEW.direction!=(CASE WHEN parent.type='purchase' THEN 'out' ELSE 'in' END) OR NEW.amount>original.total-original.paid-held THEN RAISE EXCEPTION 'Receipt exceeds exact matching invoice obligation' USING ERRCODE='23514'; END IF;
  ELSIF NEW.direction!='in' OR NEW.customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM ${t('customer_branch_access')} WHERE customer_id=NEW.customer_id AND branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'Advance requires existing branch customer' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='refunds' THEN
  PERFORM id FROM ${t('payments')} WHERE id=NEW.payment_id FOR UPDATE;
  SELECT * INTO parent FROM ${t('installment_receipt_funds')} WHERE id=NEW.payment_id;
  IF parent.id IS NULL OR NOT parent.settled OR NEW.amount<=0 OR NEW.amount>parent.amount-parent.refunded-parent.allocated-parent.credit_used OR NEW.branch_id IS DISTINCT FROM parent.branch_id OR NEW.customer_id IS DISTINCT FROM parent.customer_id OR NEW.invoice_id IS DISTINCT FROM parent.invoice_id OR NEW.sale_id IS DISTINCT FROM parent.sale_id THEN RAISE EXCEPTION 'Refund exceeds settled unallocated source or scope' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='installment_schedules' THEN
  SELECT * INTO parent FROM ${t('invoices')} WHERE id=NEW.invoice_id FOR UPDATE;
  IF parent.id IS NULL OR parent.type='purchase' OR parent.status IN ('draft','cancelled') OR parent.branch_id!=NEW.branch_id OR parent.customer_id!=NEW.customer_id THEN RAISE EXCEPTION 'Schedule source scope invalid' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NEW.status!='proposed' OR NEW.approved_by IS NOT NULL) THEN RAISE EXCEPTION 'Schedule begins as independent proposal' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at']) OR NOT
    ((OLD.status='proposed' AND NEW.status IN ('approved','active') AND NEW.approved_by IS NOT NULL AND NEW.approved_by!=NEW.proposed_by AND NEW.approved_at IS NOT NULL)
    OR (OLD.status='proposed' AND NEW.status IN ('cancelled','rejected') AND NEW.approved_by IS NULL AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at)
    OR (OLD.status='approved' AND NEW.status IN ('active','cancelled') AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at)
    OR (OLD.status='active' AND NEW.status='superseded' AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at)) THEN RAISE EXCEPTION 'Invalid immutable schedule transition' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='installment_schedule_terms' THEN
  SELECT * INTO parent FROM ${t('installment_schedules')} WHERE id=NEW.schedule_id FOR UPDATE;
  IF TG_OP!='INSERT' OR parent.status!='proposed' THEN RAISE EXCEPTION 'Accepted schedule terms immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='installments' THEN
  IF TG_OP!='INSERT' THEN RAISE EXCEPTION 'Installment history immutable' USING ERRCODE='23514'; END IF;
  IF NEW.schedule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${t('installment_schedule_terms')} term JOIN ${t('installment_schedules')} s ON s.id=term.schedule_id WHERE term.id=NEW.schedule_term_id AND s.id=NEW.schedule_id AND s.status='active' AND term.seq=NEW.seq AND term.amount=NEW.amount AND term.due_date=NEW.due_date AND s.invoice_id=NEW.invoice_id AND s.customer_id=NEW.customer_id AND COALESCE(NEW.paid_amount,0)=0) THEN RAISE EXCEPTION 'Installment must match accepted immutable terms' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='installment_allocations' THEN
  PERFORM id FROM ${t('installments')} WHERE id=NEW.installment_id FOR UPDATE;
  PERFORM id FROM ${t('payments')} WHERE id=NEW.payment_id FOR UPDATE;
  SELECT * INTO parent FROM ${t('effective_installments')} WHERE id=NEW.installment_id;
  SELECT * INTO original FROM ${t('installment_receipt_funds')} WHERE id=NEW.payment_id;
  IF parent.id IS NULL OR parent.schedule_state!='active' OR parent.legacy_review!=0 OR original.id IS NULL OR NOT original.settled OR original.direction!='in' OR original.method='other' OR parent.invoice_id!=original.invoice_id OR parent.customer_id!=original.customer_id OR NEW.branch_id!=parent.branch_id OR NEW.branch_id!=original.branch_id OR NEW.amount<=0 OR NEW.amount>parent.amount-parent.paid_amount OR NEW.amount>original.amount-original.refunded-original.allocated-original.credit_used THEN RAISE EXCEPTION 'Allocation exceeds verified invoice receipt or installment' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ${t('installment_schedules')} s CROSS JOIN LATERAL jsonb_array_elements(s.source_json::jsonb->'payments') p WHERE s.id=parent.schedule_id AND (p->>'id')::bigint=NEW.payment_id AND (p->>'settled')::boolean AND (p->>'amount')::numeric>(p->>'refunded')::numeric) THEN RAISE EXCEPTION 'Baseline-paid receipt cannot be reused' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='installment_allocation_reversals' THEN
  PERFORM id FROM ${t('installment_allocations')} WHERE id=NEW.allocation_id FOR UPDATE;
  SELECT remaining INTO n FROM ${t('installment_allocation_balances')} WHERE id=NEW.allocation_id;
  IF NEW.amount<=0 OR NEW.amount>COALESCE(n,0) THEN RAISE EXCEPTION 'Allocation reversal exceeds remaining source' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END`;
}
function sourceBody(schema:string){const t=(n:string)=>postgresRelation(schema,n);return `DECLARE kind text; action text; BEGIN
 IF TG_TABLE_NAME='invoices' THEN IF NEW.status='draft' THEN RETURN NULL; END IF; kind:='invoice';action:=CASE WHEN NEW.status='cancelled' THEN 'cancel' ELSE 'confirm' END;
 ELSIF TG_TABLE_NAME='payments' THEN kind:='payment';action:='receipt'; ELSE kind:='refund';action:='refund';END IF;
 IF NOT EXISTS(SELECT 1 FROM ${t('accounting_events')} WHERE source_type=kind AND source_id=NEW.id::text AND event_type=action AND branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'Authoritative financial source event is required in the same transaction' USING ERRCODE='23514'; END IF;RETURN NULL;END`;}
export function postgresCustomerFinanceGuardChecksum(){return createHash('sha256').update(guardBody('repaid')+sourceBody('repaid')).digest('hex');}
export async function installPostgresCustomerFinanceGuards(db:PostgresDatabase,schema:string){const f=postgresRelation(schema,'repaid_customer_finance_guard'),source=postgresRelation(schema,'repaid_finance_source_required'),body=guardBody(schema),proof=createHash('sha256').update(body+sourceBody(schema)).digest('hex');return db.transaction(async()=>{
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204305)',[schema]);const existing=(await db.query(`SELECT prosrc,obj_description(p.oid,'pg_proc') evidence FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='repaid_customer_finance_guard'`,[schema])).rows[0];if(existing){if(existing.prosrc!==body||existing.evidence!==proof)throw Error('Customer finance native guard source differs');return {installed:true,replayed:true};}
 await db.query(`CREATE FUNCTION ${f}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$${body}$guard$`);await db.query(`COMMENT ON FUNCTION ${f}() IS '${proof}'`);
 const immutable=postgresRelation(schema,'repaid_finance_no_truncate');await db.query(`CREATE FUNCTION ${immutable}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$BEGIN RAISE EXCEPTION 'Financial history cannot be truncated' USING ERRCODE='23514';END$guard$`);
 for(const name of CUSTOMER_FINANCE_TABLES){const table=postgresRelation(schema,name);await db.query(`DROP TRIGGER IF EXISTS repaid_unported_write ON ${table}`);if(!['sales','sale_items'].includes(name))await db.query(`CREATE TRIGGER repaid_customer_finance_guard BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${f}()`);await db.query(`CREATE TRIGGER repaid_finance_no_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${immutable}()`);}
 await db.query(`CREATE FUNCTION ${source}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$${sourceBody(schema)}$guard$`);
 for(const name of ['invoices','payments','refunds'])await db.query(`CREATE CONSTRAINT TRIGGER repaid_financial_source_required AFTER INSERT OR UPDATE ON ${postgresRelation(schema,name)} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${source}()`);
 return {installed:true,replayed:false};
 });}
