import {createHash} from 'node:crypto';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';
import {verifyPostgresLedgerGuards} from './postgres-ledger';
import {verifyPostgresOperationGuards} from './postgres-operations';

function definition(schema:string){
  const q=(name:string)=>postgresRelation(schema,name);
  const functions={
    bank_port_immutable:"BEGIN RAISE EXCEPTION 'Bank register history is immutable' USING ERRCODE='23514'; END",
    bank_port_account_guard:`BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.current_balance IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'A new bank account requires an explicit zero or reviewed opening' USING ERRCODE='23514'; END IF;
        NEW.register_base_value:=0;NEW.register_base_after_id:=(SELECT COALESCE(MAX(id),0) FROM ${q('bank_transactions')});NEW.register_base_kind:='explicit_new_zero';
      ELSE
        IF (NEW.register_base_value,NEW.register_base_after_id,NEW.register_base_kind) IS DISTINCT FROM (OLD.register_base_value,OLD.register_base_after_id,OLD.register_base_kind)
          OR (NEW.current_balance IS DISTINCT FROM OLD.current_balance AND pg_trigger_depth()<2)
        THEN RAISE EXCEPTION 'Bank balance requires a documented movement; baseline evidence is immutable' USING ERRCODE='23514'; END IF;
      END IF;RETURN NEW;END`,
    bank_port_insert_guard:`BEGIN
      IF NEW.amount IS NULL OR NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.type NOT IN ('deposit','withdraw','transfer_in','transfer_out','pos_settlement')
        OR NEW.operation_group IS NULL OR NEW.operation_group !~ '^[a-f0-9]{32}$' OR NEW.date IS NULL OR NOT ${q('repaid_iso_date')}(NEW.date)
      THEN RAISE EXCEPTION 'Invalid or unsupported bank register movement' USING ERRCODE='23514';END IF;
      IF NEW.check_id IS NULL AND NOT EXISTS(SELECT 1 FROM ${q('users')} u JOIN ${q('branches')} b ON b.id=u.branch_id WHERE u.id=NEW.user_id AND u.is_active=1 AND u.role IN ('owner','admin') AND b.is_active=1)
      THEN RAISE EXCEPTION 'Current centralized banking authority required' USING ERRCODE='23514';END IF;
      IF NEW.check_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${q('checks')} c JOIN ${q('users')} u ON u.id=NEW.user_id JOIN ${q('branches')} b ON b.id=c.branch_id WHERE c.id=NEW.check_id AND c.status='passed' AND c.bank_account_id=NEW.account_id AND c.amount=NEW.amount AND NEW.type=CASE WHEN c.kind='issued' THEN 'withdraw' ELSE 'deposit' END AND u.is_active=1 AND b.is_active=1 AND (u.role IN ('owner','admin') OR u.branch_id=c.branch_id) AND c.settled_at IS NOT NULL AND NEW.date=left(c.settled_at,10)) THEN RAISE EXCEPTION 'Bank cheque movement requires its exact cleared branch-owned cheque' USING ERRCODE='23514';END IF;
      IF NOT EXISTS(SELECT 1 FROM ${q('bank_accounts')} a WHERE a.id=NEW.account_id AND a.is_active=1 AND NEW.id>a.register_base_after_id)
      THEN RAISE EXCEPTION 'Active bank account and prospective movement identity required' USING ERRCODE='23514';END IF;
      IF (NEW.type IN ('transfer_in','transfer_out')) IS DISTINCT FROM (NEW.to_account_id IS NOT NULL)
        OR NEW.to_account_id=NEW.account_id THEN RAISE EXCEPTION 'Invalid bank transfer identity' USING ERRCODE='23514';END IF;
      RETURN NEW;END`,
    bank_port_apply:`DECLARE before_value bigint;after_value numeric;BEGIN
      SELECT current_balance INTO before_value FROM ${q('bank_accounts')} WHERE id=NEW.account_id AND is_active=1 FOR UPDATE;
      IF NOT FOUND OR before_value IS NULL THEN RAISE EXCEPTION 'Bank register balance requires review' USING ERRCODE='23514';END IF;
      after_value:=before_value::numeric+CASE WHEN NEW.type IN ('withdraw','transfer_out') THEN -NEW.amount::numeric ELSE NEW.amount::numeric END;
      IF after_value NOT BETWEEN -9007199254740991 AND 9007199254740991 THEN RAISE EXCEPTION 'Bank register safe integer range exceeded' USING ERRCODE='23514';END IF;
      UPDATE ${q('bank_accounts')} SET current_balance=after_value::bigint WHERE id=NEW.account_id;RETURN NEW;END`,
    bank_port_proof:`DECLARE primary_id bigint;event_branch bigint;BEGIN
      primary_id:=NEW.id;
      IF NEW.type IN ('transfer_in','transfer_out') THEN
        IF (SELECT COUNT(*) FROM ${q('bank_transactions')} WHERE operation_group=NEW.operation_group)!=2
          OR NOT EXISTS(SELECT 1 FROM ${q('bank_transactions')} p WHERE p.operation_group=NEW.operation_group AND p.type=CASE WHEN NEW.type='transfer_out' THEN 'transfer_in' ELSE 'transfer_out' END
            AND p.account_id=NEW.to_account_id AND p.to_account_id=NEW.account_id AND p.amount=NEW.amount AND p.date=NEW.date AND p.user_id=NEW.user_id)
        THEN RAISE EXCEPTION 'Bank transfer must commit one exact reciprocal pair' USING ERRCODE='23514';END IF;
        IF NEW.type='transfer_in' THEN SELECT id INTO primary_id FROM ${q('bank_transactions')} WHERE operation_group=NEW.operation_group AND type='transfer_out';END IF;
      ELSIF (SELECT COUNT(*) FROM ${q('bank_transactions')} WHERE operation_group=NEW.operation_group)!=1
        THEN RAISE EXCEPTION 'Bank movement group cannot be reused' USING ERRCODE='23514';
      END IF;
      SELECT e.branch_id INTO event_branch FROM ${q('accounting_events')} e JOIN ${q('users')} u ON u.id=NEW.user_id
        WHERE e.event_key='bank:'||NEW.id::text||':'||CASE WHEN NEW.type IN ('transfer_out','transfer_in') THEN NEW.type ELSE 'movement' END
        AND e.source_type='bank' AND e.source_id=NEW.id::text AND e.actor_id=NEW.user_id AND e.branch_id=CASE WHEN NEW.check_id IS NULL THEN u.branch_id ELSE (SELECT branch_id FROM ${q('checks')} WHERE id=NEW.check_id) END
        AND e.event_type=CASE WHEN NEW.type IN ('transfer_out','transfer_in') THEN NEW.type ELSE 'movement' END
        AND e.payload_hash=encode(sha256(convert_to(e.payload_json,'UTF8')),'hex')
        AND e.payload_json::jsonb=jsonb_build_object('document',jsonb_build_object('id',NEW.id,'account_id',NEW.account_id,'type',NEW.type,'amount',NEW.amount,'to_account_id',NEW.to_account_id,'date',NEW.date,'check_id',NEW.check_id),
          'lines','[]'::jsonb,'bank_evidence','[]'::jsonb,'repair_cost_lines','[]'::jsonb,'control_amount',CASE WHEN NEW.check_id IS NULL THEN NEW.amount ELSE 0 END,'currency','IRR','policy','review_required','branch_basis',CASE WHEN NEW.check_id IS NULL THEN 'actor_branch_requires_accounting_review' ELSE 'cheque_branch_verified' END);
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact immutable bank source event required' USING ERRCODE='23514';END IF;
      IF NEW.check_id IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM ${q('bank_transactions')} WHERE check_id=NEW.check_id)<>1 OR NOT EXISTS(SELECT 1 FROM ${q('operation_receipts')} r WHERE r.actor_id=NEW.user_id AND r.branch_id=event_branch AND r.operation='check_mutation' AND r.result_json::jsonb->>'id'=NEW.check_id::text AND r.result_json::jsonb->>'ok'='true') OR NOT EXISTS(SELECT 1 FROM ${q('audit_logs')} a WHERE a.user_id=NEW.user_id AND a.branch_id=event_branch AND a.entity='check' AND a.entity_id=NEW.check_id AND a.action='check_pass') THEN RAISE EXCEPTION 'Cheque bank settlement requires one durable cleared cheque and audit' USING ERRCODE='23514'; END IF;
      ELSIF NOT EXISTS(SELECT 1 FROM ${q('operation_receipts')} r WHERE r.actor_id=NEW.user_id AND r.branch_id=event_branch AND r.operation='bank_mutation' AND r.scope='business'
        AND r.result_json::jsonb->>'id'=primary_id::text AND r.result_json::jsonb->>'ok'='true')
        OR NOT EXISTS(SELECT 1 FROM ${q('audit_logs')} a WHERE a.user_id=NEW.user_id AND a.branch_id=event_branch AND a.entity='bank_transaction' AND a.entity_id=primary_id
          AND a.action=CASE WHEN NEW.type IN ('transfer_in','transfer_out') THEN 'bank_transfer' ELSE 'bank_txn' END)
      THEN RAISE EXCEPTION 'Bank mutation requires its durable operation and audit' USING ERRCODE='23514';END IF;RETURN NEW;END`,
  };
  const triggers=[
    {table:'bank_accounts',name:'bank_port_account',event:'INSERT OR UPDATE',fn:'bank_port_account_guard',timing:'BEFORE',row:true,deferred:false},
    {table:'bank_accounts',name:'bank_port_account_delete',event:'DELETE',fn:'bank_port_immutable',timing:'BEFORE',row:true,deferred:false},
    {table:'bank_accounts',name:'bank_port_account_truncate',event:'TRUNCATE',fn:'bank_port_immutable',timing:'BEFORE',row:false,deferred:false},
    {table:'bank_transactions',name:'bank_port_insert',event:'INSERT',fn:'bank_port_insert_guard',timing:'BEFORE',row:true,deferred:false},
    {table:'bank_transactions',name:'bank_port_apply',event:'INSERT',fn:'bank_port_apply',timing:'AFTER',row:true,deferred:false},
    {table:'bank_transactions',name:'bank_port_proof',event:'INSERT',fn:'bank_port_proof',timing:'AFTER',row:true,deferred:true},
    {table:'bank_transactions',name:'bank_port_history',event:'UPDATE OR DELETE',fn:'bank_port_immutable',timing:'BEFORE',row:true,deferred:false},
    {table:'bank_transactions',name:'bank_port_truncate',event:'TRUNCATE',fn:'bank_port_immutable',timing:'BEFORE',row:false,deferred:false},
  ];
  return {q,functions,triggers,hash:createHash('sha256').update(JSON.stringify({functions,triggers,version:1})).digest('hex')};
}
export function postgresBankGuardChecksum(){return definition('repaid').hash;}
async function importedBaselineHash(db:PostgresDatabase,schema:string){
  const hash=createHash('sha256');let last:string|null=null;
  for(;;){const rows:Record<string,string>[]=(await db.query(`SELECT id,register_base_value,register_base_after_id,register_base_kind FROM ${postgresRelation(schema,'bank_accounts')} WHERE register_base_kind='imported_register_v1' AND ($1::bigint IS NULL OR id>$1) ORDER BY id LIMIT 500`,[last])).rows;if(!rows.length)break;for(const row of rows)hash.update(JSON.stringify(row)+'\n');last=String(rows[rows.length-1].id);}
  return hash.digest('hex');
}
async function baselineProvenance(db:PostgresDatabase,schema:string){
  if(schema.startsWith('repaid_snapshot_')){
    const source=(await db.query(`SELECT source_sha256 FROM ${postgresRelation(schema,'_repaid_snapshot_manifest')} WHERE id=1`)).rows[0];
    if(!source?.source_sha256)throw new Error('Imported bank baseline requires retained snapshot provenance');
    return String(source.source_sha256);
  }
  // A canonical empty deployment is not an imported historical register. Never
  // manufacture snapshot metadata or call its zero a reviewed financial opening.
  if((await db.query(`SELECT 1 FROM ${postgresRelation(schema,'bank_accounts')} WHERE register_base_kind='imported_register_v1' LIMIT 1`)).rowCount)throw new Error('Canonical bank register contains an unapproved imported baseline');
  return 'canonical_empty_register_v1';
}
async function structure(db:PostgresDatabase,schema:string){
  const triggers=(await db.query(`SELECT t.tgname,pg_get_triggerdef(t.oid) definition,t.tgenabled,t.tgfoid::regprocedure::text function_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname LIKE 'bank_port_%' ORDER BY t.tgname`,[schema])).rows;
  const indexes=(await db.query(`SELECT c.relname,pg_get_indexdef(c.oid) definition,i.indisvalid,i.indisunique FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index i ON i.indexrelid=c.oid WHERE n.nspname=$1 AND c.relname IN ('bank_port_group_type','bank_port_account_history','bank_port_ledger_account') ORDER BY c.relname`,[schema])).rows;
  const columns=(await db.query(`SELECT table_name,column_name,data_type,collation_name FROM information_schema.columns WHERE table_schema=$1 AND ((table_name='bank_accounts' AND column_name LIKE 'register_base_%') OR (table_name='bank_transactions' AND column_name='operation_group')) ORDER BY table_name,column_name`,[schema])).rows;
  return {triggers,indexes,columns};
}
/** Only identified rehearsal schemas. Captures existing register evidence, not
 * an approved accounting opening or a guessed reconstruction of old movements. */
export async function installPostgresBankGuards(db:PostgresDatabase,schema:string){
  const d=definition(schema);await verifyPostgresLedgerGuards(db,schema);await verifyPostgresOperationGuards(db,schema);
  return db.transaction(async()=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204303)',[schema]);
    if((await db.query("SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='bank_port_proof'",[schema])).rowCount){await verifyPostgresBankGuards(db,schema);return {installed:true,replayed:true,application_ready:false};}
    await db.query(`LOCK TABLE ${d.q('bank_accounts')},${d.q('bank_transactions')} IN SHARE ROW EXCLUSIVE MODE`);
    const snapshot=schema.startsWith('repaid_snapshot_');
    if(!snapshot&&(await db.query(`SELECT 1 FROM ${d.q('bank_accounts')} UNION ALL SELECT 1 FROM ${d.q('bank_transactions')} LIMIT 1`)).rowCount)throw new Error('Populated canonical bank registers require a separately reviewed evidence migration');
    if((await db.query(`SELECT 1 FROM ${d.q('bank_accounts')} WHERE current_balance IS NULL OR current_balance<>trunc(current_balance) OR current_balance NOT BETWEEN -9007199254740991 AND 9007199254740991 LIMIT 1`)).rowCount)throw new Error('Existing bank balance requires evidence-based review; no baseline was invented');
    await db.query(`ALTER TABLE ${d.q('bank_accounts')} ADD COLUMN register_base_value bigint,ADD COLUMN register_base_after_id bigint,ADD COLUMN register_base_kind text COLLATE "C"`);
    await db.query(`ALTER TABLE ${d.q('bank_transactions')} ADD COLUMN operation_group text COLLATE "C"`);
    if(snapshot)await db.query(`UPDATE ${d.q('bank_accounts')} SET register_base_value=current_balance,register_base_after_id=(SELECT COALESCE(MAX(id),0) FROM ${d.q('bank_transactions')}),register_base_kind='imported_register_v1'`);
    await db.query(`CREATE UNIQUE INDEX bank_port_group_type ON ${d.q('bank_transactions')}(operation_group,type) WHERE operation_group IS NOT NULL`);
    await db.query(`CREATE INDEX bank_port_account_history ON ${d.q('bank_transactions')}(account_id,id DESC)`);
    await db.query(`CREATE INDEX bank_port_ledger_account ON ${d.q('accounting_lines')}(bank_account_id,journal_id)`);
    for(const [name,body] of Object.entries(d.functions))await db.query(`CREATE FUNCTION ${d.q(name)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $bank$${body}$bank$`);
    for(const t of d.triggers)await db.query(`CREATE ${t.deferred?'CONSTRAINT ':''}TRIGGER ${t.name} ${t.timing} ${t.event} ON ${d.q(t.table)} ${t.deferred?'DEFERRABLE INITIALLY DEFERRED ':''}FOR EACH ${t.row?'ROW':'STATEMENT'} EXECUTE FUNCTION ${d.q(t.fn)}()`);
    const evidence=JSON.stringify({code:d.hash,source:await baselineProvenance(db,schema),baseline:await importedBaselineHash(db,schema),structure:await structure(db,schema)});
    await db.query(`COMMENT ON FUNCTION ${d.q('bank_port_proof')}() IS '${evidence.replaceAll("'","''")}'`);
    await verifyPostgresBankGuards(db,schema);return {installed:true,replayed:false,application_ready:false};
  });
}
export async function verifyPostgresBankGuards(db:PostgresDatabase,schema:string){
  const d=definition(schema),rows=(await db.query(`SELECT p.proname,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.prorettype::regtype::text result,l.lanname,obj_description(p.oid,'pg_proc') evidence FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.proname LIKE 'bank_port_%'`,[schema])).rows;
  for(const [name,body] of Object.entries(d.functions)){const found=rows.filter(row=>row.proname===name);if(found.length!==1||found[0].prosrc!==body||found[0].prosecdef||found[0].provolatile!=='v'||found[0].result!=='trigger'||found[0].lanname!=='plpgsql'||JSON.stringify(found[0].proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw new Error('PostgreSQL bank function missing or altered: '+name);}
  const current=await structure(db,schema),proof=JSON.parse(String(rows.find(row=>row.proname==='bank_port_proof')?.evidence??'null'));
  if(!proof||proof.code!==d.hash||proof.source!==await baselineProvenance(db,schema)||proof.baseline!==await importedBaselineHash(db,schema)||JSON.stringify(proof.structure)!==JSON.stringify(current)||current.triggers.length!==d.triggers.length||current.indexes.length!==3||current.columns.length!==4||current.triggers.some(row=>!['O','A'].includes(String(row.tgenabled)))||current.indexes.some(row=>row.indisvalid!==true))throw new Error('PostgreSQL bank guard or baseline provenance drift');
  return {verified:true,functions:Object.keys(d.functions).length,triggers:d.triggers.length,legacy_baselines_accounting_approved:false,application_ready:false};
}
