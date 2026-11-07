import {createHash} from 'node:crypto';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';

/** Additive migration7 proof. Current domain writes use READ COMMITTED; parent
 * locks serialize different actors/nonces there. Source-linked writes under a
 * fixed snapshot fail closed, without claiming stronger-isolation parity.
 * Existing disputed duplicates are retained for reviewed reconciliation. */
export function postgresInvoiceSourceIdentityStatements(schema:string){
 const t=(name:string)=>postgresRelation(schema,name);
 return [
  `CREATE FUNCTION ${t('pg_invoice_source_identity')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $source$
   DECLARE parent record;
   BEGIN
    IF (NEW.ticket_id IS NOT NULL OR NEW.sale_id IS NOT NULL) AND current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Source-linked invoice writes require the authoritative READ COMMITTED command boundary' USING ERRCODE='55000'; END IF;
    IF NEW.ticket_id IS NOT NULL THEN
     SELECT ticket.id,ticket.customer_id,ticket.branch_id,status.name source_status INTO parent FROM ${t('repair_tickets')} ticket LEFT JOIN ${t('repair_statuses')} status ON status.id=ticket.status_id WHERE ticket.id=NEW.ticket_id FOR UPDATE OF ticket;
     IF parent.id IS NULL OR parent.branch_id IS NULL OR parent.source_status='Cancelled' OR NEW.type IS DISTINCT FROM 'repair' OR NEW.customer_id IS DISTINCT FROM parent.customer_id OR NEW.branch_id IS DISTINCT FROM parent.branch_id OR NEW.sale_id IS NOT NULL OR NEW.purchase_order_id IS NOT NULL OR NEW.supplier_id IS NOT NULL THEN RAISE EXCEPTION 'Invoice must preserve eligible original repair identity and branch' USING ERRCODE='23514'; END IF;
     IF EXISTS(SELECT 1 FROM ${t('invoices')} WHERE ticket_id=NEW.ticket_id AND status IS DISTINCT FROM 'cancelled') THEN RAISE EXCEPTION 'Repair already has an active invoice; use authoritative existing obligation' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.sale_id IS NOT NULL THEN
     SELECT id,customer_id,branch_id,status INTO parent FROM ${t('sales')} WHERE id=NEW.sale_id FOR UPDATE;
     IF parent.id IS NULL OR parent.branch_id IS NULL OR parent.status='cancelled' OR NEW.type IS DISTINCT FROM 'sale' OR NEW.customer_id IS DISTINCT FROM parent.customer_id OR NEW.branch_id IS DISTINCT FROM parent.branch_id OR NEW.ticket_id IS NOT NULL OR NEW.purchase_order_id IS NOT NULL OR NEW.supplier_id IS NOT NULL THEN RAISE EXCEPTION 'Invoice must preserve original sale identity and branch' USING ERRCODE='23514'; END IF;
     IF EXISTS(SELECT 1 FROM ${t('invoices')} WHERE sale_id=NEW.sale_id AND status IS DISTINCT FROM 'cancelled') THEN RAISE EXCEPTION 'Sale already has an active invoice; use authoritative existing obligation' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
   END$source$`,
  `CREATE TRIGGER pg_invoice_source_identity BEFORE INSERT ON ${t('invoices')} FOR EACH ROW EXECUTE FUNCTION ${t('pg_invoice_source_identity')}()`,
 ];
}
export const postgresInvoiceSourceIdentityChecksum=()=>createHash('sha256').update(JSON.stringify(postgresInvoiceSourceIdentityStatements('repaid'))).digest('hex');
export async function verifyPostgresInvoiceSourceIdentityGuards(db:PostgresDatabase,schema:string){
 postgresRelation(schema,'invoices');
 const expected=postgresInvoiceSourceIdentityStatements(schema)[0].split('$source$')[1];
 const functions=(await db.query(`SELECT p.prosrc,p.prosecdef,p.pronargs,p.provolatile,p.prorettype::regtype::text return_type,p.proconfig,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.proname='pg_invoice_source_identity'`,[schema])).rows;
 const f=functions[0];if(functions.length!==1||f.prosrc!==expected||f.prosecdef||f.pronargs!==0||f.provolatile!=='v'||f.return_type!=='trigger'||f.lanname!=='plpgsql'||JSON.stringify(f.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw Error('Native invoice source identity function missing or changed');
 const triggers=(await db.query(`SELECT t.tgtype,t.tgenabled,t.tgnargs,t.tgattr::text attributes,t.tgqual IS NOT NULL conditional,t.tgdeferrable,t.tginitdeferred,p.proname,pn.nspname function_schema FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname=$1 AND c.relname='invoices' AND t.tgname='pg_invoice_source_identity' AND NOT t.tgisinternal`,[schema])).rows;
 const trigger=triggers[0];if(triggers.length!==1||trigger.tgtype!==7||trigger.tgenabled!=='O'||trigger.tgnargs!==0||trigger.attributes!==''||trigger.conditional||trigger.tgdeferrable||trigger.tginitdeferred||trigger.proname!=='pg_invoice_source_identity'||trigger.function_schema!==schema)throw Error('Native invoice source identity trigger missing, disabled or changed');
 return {verified:true,functions:1,triggers:1};
}
