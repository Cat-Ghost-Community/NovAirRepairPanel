import {createHash} from 'node:crypto';
import {recognitionTemplates} from '../recognition-templates';
import {DEFAULT_ACCOUNTING_CHART} from '../accounting-chart';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';

export const POSTGRES_ACCOUNTING_TABLES=['accounting_recognition_policies','accounting_automatic_postings'] as const;
function definition(schema:string){
 const q=(name:string)=>postgresRelation(schema,name),policies=JSON.stringify(Object.fromEntries(Object.entries(recognitionTemplates).map(([kind,value])=>[kind,{debit:value.debit,credit:value.credit}]))).replaceAll("'","''"),classes=JSON.stringify(Object.fromEntries(DEFAULT_ACCOUNTING_CHART.map(r=>[r[0],r[2]]))).replaceAll("'","''");
 const functions={
  pg_financial_event_insert:`DECLARE data jsonb; amount numeric; BEGIN
   data:=NEW.payload_json::jsonb;amount:=(data->>'control_amount')::numeric;
   IF NEW.payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.payload_json,'UTF8')),'hex') OR NEW.event_key IS DISTINCT FROM NEW.source_type||':'||NEW.source_id||':'||NEW.event_type
    OR data->>'currency' IS DISTINCT FROM 'IRR' OR jsonb_typeof(data->'document') IS DISTINCT FROM 'object' OR (data->'document'->>'id') IS DISTINCT FROM NEW.source_id
    OR amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) THEN RAISE EXCEPTION 'Invalid immutable source event evidence' USING ERRCODE='23514'; END IF;
   RETURN NEW;END`,
  pg_financial_review_insert:`DECLARE event record; journal record; BEGIN
   SELECT * INTO event FROM ${q('accounting_events')} WHERE id=NEW.event_id;
   SELECT * INTO journal FROM ${q('accounting_journals')} WHERE id=NEW.journal_id;
   IF event.id IS NULL OR journal.id IS NULL OR event.branch_id IS DISTINCT FROM journal.branch_id OR length(btrim(NEW.reason))<5
    OR NOT ((journal.source_type='financial_event' AND journal.source_id=event.id::text) OR (journal.source_type=event.source_type AND journal.source_id=event.source_id))
    THEN RAISE EXCEPTION 'Financial source review does not match journal identity' USING ERRCODE='23514'; END IF;
   RETURN NEW;END`,
  pg_operational_journal_post:`DECLARE control numeric; amount numeric; BEGIN
   IF NEW.state='posted' AND OLD.state='draft' AND NEW.source_type NOT IN ('manual','journal_reversal','opening') THEN
    SELECT (e.payload_json::jsonb->>'control_amount')::numeric INTO control FROM ${q('accounting_event_reviews')} r JOIN ${q('accounting_events')} e ON e.id=r.event_id
     WHERE r.journal_id=NEW.id AND e.branch_id=NEW.branch_id AND ((NEW.source_type='financial_event' AND NEW.source_id=e.id::text) OR (NEW.source_type=e.source_type AND NEW.source_id=e.source_id));
    SELECT SUM(debit) INTO amount FROM ${q('accounting_lines')} WHERE journal_id=NEW.id;
    IF control IS NULL OR control<=0 OR amount IS DISTINCT FROM control THEN RAISE EXCEPTION 'Operational posting requires its exact reviewed source amount' USING ERRCODE='23514'; END IF;
   END IF;RETURN NEW;END`,
  pg_recognition_policy_guard:`DECLARE debit_code text;credit_code text;BEGIN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recognition policies cannot be deleted' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' THEN
    IF NEW.status<>'proposed' OR NEW.approved_by IS NOT NULL OR NEW.min_event_id IS NOT NULL OR NEW.approved_at IS NOT NULL
     OR NOT ('${policies}'::jsonb ? NEW.kind) OR NOT ${q('repaid_iso_date')}(NEW.effective_date) OR length(btrim(NEW.reason))<10
     THEN RAISE EXCEPTION 'Recognition policy must start as a valid unapproved proposal' USING ERRCODE='23514'; END IF;
   ELSE
    IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','min_event_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','min_event_id']) THEN RAISE EXCEPTION 'Policy evidence is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='proposed' AND NEW.status='approved' THEN
     IF NEW.approved_by IS NULL OR NEW.approved_by=OLD.proposed_by OR NEW.approved_at IS NULL OR NEW.min_event_id IS DISTINCT FROM (SELECT COALESCE(MAX(id),0) FROM ${q('accounting_events')})
      OR NOT EXISTS(SELECT 1 FROM ${q('accounting_opening_documents')} WHERE branch_id=NEW.branch_id AND status='posted')
      THEN RAISE EXCEPTION 'Policy requires independent approval and a posted opening' USING ERRCODE='23514'; END IF;
     debit_code:='${policies}'::jsonb->NEW.kind->>'debit';credit_code:='${policies}'::jsonb->NEW.kind->>'credit';
     IF NOT EXISTS(SELECT 1 FROM ${q('accounting_accounts')} WHERE code=debit_code AND active=1 AND classification='${classes}'::jsonb->>debit_code)
      OR NOT EXISTS(SELECT 1 FROM ${q('accounting_accounts')} WHERE code=credit_code AND active=1 AND classification='${classes}'::jsonb->>credit_code)
      THEN RAISE EXCEPTION 'Policy account mapping is invalid' USING ERRCODE='23514'; END IF;
    ELSIF NOT (OLD.status='approved' AND NEW.status='disabled' AND (NEW.approved_by,NEW.approved_at,NEW.min_event_id) IS NOT DISTINCT FROM (OLD.approved_by,OLD.approved_at,OLD.min_event_id)) THEN RAISE EXCEPTION 'Invalid recognition policy transition' USING ERRCODE='23514'; END IF;
   END IF;RETURN NEW;END`,
  pg_automatic_posting_guard:`BEGIN
   IF NOT EXISTS(SELECT 1 FROM ${q('accounting_events')} e JOIN ${q('accounting_recognition_policies')} p ON p.id=NEW.policy_id JOIN ${q('accounting_journals')} j ON j.id=NEW.journal_id
    JOIN ${q('accounting_event_reviews')} r ON r.event_id=e.id AND r.journal_id=j.id
    WHERE e.id=NEW.event_id AND p.status='approved' AND p.branch_id=e.branch_id AND e.id>p.min_event_id AND substr(e.created_at,1,10)>=p.effective_date AND e.actor_id=NEW.executed_by
     AND r.approved_by=p.approved_by AND j.state='posted' AND j.branch_id=e.branch_id AND j.source_type='financial_event' AND j.source_id=e.id::text)
   THEN RAISE EXCEPTION 'Automatic posting provenance is invalid' USING ERRCODE='23514'; END IF;RETURN NEW;END`,
  pg_period_close_guard:`BEGIN
   IF NEW.status='closed' AND OLD.status<>'closed' AND (
    EXISTS(SELECT 1 FROM ${q('accounting_journals')} j WHERE period_id=NEW.id AND state='draft' AND NOT EXISTS(SELECT 1 FROM ${q('accounting_journal_voids')} v WHERE v.journal_id=j.id)) OR
    EXISTS(SELECT 1 FROM ${q('accounting_events')} e LEFT JOIN ${q('accounting_event_reviews')} r ON r.event_id=e.id LEFT JOIN ${q('accounting_journals')} j ON j.id=r.journal_id WHERE substr(e.created_at,1,10) BETWEEN NEW.start_date AND NEW.end_date
     AND NOT EXISTS(SELECT 1 FROM ${q('accounting_opening_event_links')} o WHERE o.event_id=e.id) AND (e.payload_json::jsonb->>'control_amount')::numeric>0 AND (j.id IS NULL OR j.state NOT IN ('posted','reversed')))
   ) THEN RAISE EXCEPTION 'Pending sources or drafts prevent period closure' USING ERRCODE='23514'; END IF;RETURN NEW;END`,
 };
 const triggers=[
  ['accounting_events','pg_financial_source','INSERT','pg_financial_event_insert'],['accounting_event_reviews','pg_financial_review','INSERT','pg_financial_review_insert'],
  ['accounting_journals','pg_operational_post','UPDATE','pg_operational_journal_post'],['accounting_recognition_policies','pg_policy_guard','INSERT OR UPDATE OR DELETE','pg_recognition_policy_guard'],
  ['accounting_automatic_postings','pg_automatic_guard','INSERT','pg_automatic_posting_guard'],['accounting_periods','pg_period_close','UPDATE','pg_period_close_guard'],
 ] as const;
 return {q,functions,triggers,hash:createHash('sha256').update(JSON.stringify({functions,triggers})).digest('hex')};
}
export async function installPostgresFinancialEventGuards(db:PostgresDatabase,schema:string){
 const d=definition(schema);
 return db.transaction(async()=>{
  for(const [name,body] of Object.entries(d.functions))await db.query(`CREATE FUNCTION ${d.q(name)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $financial$${body}$financial$`);
  for(const [table,name,event,fn] of d.triggers)await db.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${d.q(table)} FOR EACH ROW EXECUTE FUNCTION ${d.q(fn)}()`);
  for(const table of POSTGRES_ACCOUNTING_TABLES){await db.query(`CREATE TRIGGER pg_accounting_no_truncate BEFORE TRUNCATE ON ${d.q(table)} FOR EACH STATEMENT EXECUTE FUNCTION ${d.q('repaid_ledger_immutable')}()`);await db.query(`DROP TRIGGER repaid_unported_write ON ${d.q(table)}`);}
  await db.query(`CREATE TRIGGER pg_automatic_immutable BEFORE UPDATE OR DELETE ON ${d.q('accounting_automatic_postings')} FOR EACH ROW EXECUTE FUNCTION ${d.q('repaid_ledger_immutable')}()`);
  await verifyPostgresFinancialEventGuards(db,schema);return {installed:true,definition_sha256:d.hash};
 });
}
export async function verifyPostgresFinancialEventGuards(db:PostgresDatabase,schema:string){
 const d=definition(schema),rows=(await db.query(`SELECT p.proname,p.prosrc,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=ANY($2::text[])`,[schema,Object.keys(d.functions)])).rows;
 for(const [name,body] of Object.entries(d.functions)){const row=rows.find(r=>r.proname===name);if(!row||row.prosrc!==body||row.prosecdef||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw Error('PostgreSQL financial source guard missing or changed');}
 return {verified:true,definition_sha256:d.hash};
}
export function postgresFinancialEventGuardChecksum(){return definition('repaid').hash;}
