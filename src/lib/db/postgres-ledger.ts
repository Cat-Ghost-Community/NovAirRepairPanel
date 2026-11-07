import {createHash,randomBytes} from 'node:crypto';
import type {PostgresDatabase} from './postgres';
import {postgresRelation} from './postgres-auth';

/** Native port of the EXISTING ledger's core guards in an explicitly identified namespace.
 * This is not a second ledger, posting policy, live engine switch or complete application migration. */
function definition(schema:string){
 postgresRelation(schema,'accounting_journals');
 const s='"'+schema+'"',q=(table:string)=>s+'."'+table+'"';
 const functions:Record<string,string>={
  repaid_ledger_lock:`BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('${schema}'),19204301); RETURN NULL; END`,
  repaid_iso_date:`BEGIN RETURN value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(value::date,'YYYY-MM-DD')=value; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END`,
  repaid_ledger_immutable:`BEGIN RAISE EXCEPTION 'Immutable accounting evidence cannot be changed' USING ERRCODE='23514'; END`,
  repaid_account_guard:`BEGIN IF (NEW.code,NEW.classification,NEW.normal_side) IS DISTINCT FROM (OLD.code,OLD.classification,OLD.normal_side)
   AND EXISTS(SELECT 1 FROM ${q('accounting_lines')} WHERE account_code=OLD.code) THEN RAISE EXCEPTION 'Referenced account classification is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  repaid_period_guard:`BEGIN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accounting periods cannot be deleted' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' THEN IF (NEW.start_date,NEW.end_date) IS DISTINCT FROM (OLD.start_date,OLD.end_date) THEN RAISE EXCEPTION 'Accounting period boundaries are immutable' USING ERRCODE='23514'; END IF;
   ELSIF EXISTS(SELECT 1 FROM ${q('accounting_periods')} WHERE start_date<=NEW.end_date AND end_date>=NEW.start_date) THEN RAISE EXCEPTION 'Overlapping accounting period' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  repaid_line_guard:`DECLARE parent bigint; BEGIN
   FOR parent IN SELECT DISTINCT value FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.journal_id] WHEN TG_OP='DELETE' THEN ARRAY[OLD.journal_id] ELSE ARRAY[OLD.journal_id,NEW.journal_id] END) value LOOP
    IF NOT EXISTS(SELECT 1 FROM ${q('accounting_journals')} WHERE id=parent AND state='draft') OR EXISTS(SELECT 1 FROM ${q('accounting_journal_voids')} WHERE journal_id=parent) THEN RAISE EXCEPTION 'Posted or voided journal lines are immutable' USING ERRCODE='23514'; END IF;
   END LOOP; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END`,
  repaid_void_guard:`BEGIN IF NOT EXISTS(SELECT 1 FROM ${q('accounting_journals')} WHERE id=NEW.journal_id AND state='draft' AND source_type='manual') THEN RAISE EXCEPTION 'Only manual drafts may be voided' USING ERRCODE='23514'; END IF; RETURN NEW; END`,
  repaid_journal_guard:`DECLARE count_lines bigint; total_debit numeric; total_credit numeric; last_sequence bigint; last_digest text; BEGIN
   IF TG_OP='INSERT' THEN IF NEW.state!='draft' THEN RAISE EXCEPTION 'Journal must start as draft' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;
   IF EXISTS(SELECT 1 FROM ${q('accounting_journal_voids')} WHERE journal_id=OLD.id) THEN RAISE EXCEPTION 'Voided journal is immutable' USING ERRCODE='23514'; END IF;
   IF TG_OP='DELETE' THEN IF OLD.state!='draft' THEN RAISE EXCEPTION 'Posted journal cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
   IF OLD.state IN ('posted','reversed') THEN
    IF NOT(OLD.state='posted' AND NEW.state='reversed' AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') AND EXISTS(SELECT 1 FROM ${q('accounting_journals')} WHERE reversal_of=OLD.id AND state='posted')) THEN RAISE EXCEPTION 'Posted journal is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
   END IF;
   IF NEW.state='reversed' THEN RAISE EXCEPTION 'Only posted journals may be reversed' USING ERRCODE='23514'; END IF;
   IF NEW.state='posted' THEN
    IF OLD.state!='draft' OR NEW.posted_by IS NULL OR NEW.posted_at IS NULL OR length(COALESCE(NEW.digest,''))!=64 THEN RAISE EXCEPTION 'Invalid posting transition' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM ${q('accounting_periods')} WHERE id=NEW.period_id AND status='open' AND NEW.posting_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'Accounting period is closed or outside posting date' USING ERRCODE='23514'; END IF;
    SELECT count(*),COALESCE(sum(debit),0),COALESCE(sum(credit),0) INTO count_lines,total_debit,total_credit FROM ${q('accounting_lines')} WHERE journal_id=NEW.id;
    IF count_lines<2 OR total_debit!=total_credit OR total_debit>9007199254740991 THEN RAISE EXCEPTION 'Journal is not balanced or exceeds exact application range' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ${q('accounting_lines')} l JOIN ${q('accounting_accounts')} a ON a.code=l.account_code WHERE l.journal_id=NEW.id AND a.active!=1) THEN RAISE EXCEPTION 'Inactive ledger account' USING ERRCODE='23514'; END IF;
    IF NEW.reversal_of IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM ${q('accounting_journals')} o WHERE o.id=NEW.reversal_of AND o.state='posted' AND o.reversal_of IS NULL AND o.branch_id=NEW.branch_id)
     OR (SELECT count(*) FROM ${q('accounting_lines')} WHERE journal_id=NEW.id)!=(SELECT count(*) FROM ${q('accounting_lines')} WHERE journal_id=NEW.reversal_of)
     OR EXISTS(SELECT 1 FROM ${q('accounting_lines')} l LEFT JOIN ${q('accounting_lines')} o ON o.journal_id=NEW.reversal_of AND o.position=l.position WHERE l.journal_id=NEW.id AND
      (o.id IS NULL OR (l.account_code,l.debit,l.credit,l.customer_id,l.supplier_id,l.employee_id,l.part_id,l.bank_account_id) IS DISTINCT FROM (o.account_code,o.credit,o.debit,o.customer_id,o.supplier_id,o.employee_id,o.part_id,o.bank_account_id)))) THEN RAISE EXCEPTION 'Invalid reversing journal' USING ERRCODE='23514'; END IF;
    SELECT posted_sequence,digest INTO last_sequence,last_digest FROM ${q('accounting_journals')} WHERE posted_sequence IS NOT NULL ORDER BY posted_sequence DESC LIMIT 1;
    IF NEW.posted_sequence IS DISTINCT FROM COALESCE(last_sequence,0)+1 OR NEW.previous_hash IS DISTINCT FROM COALESCE(last_digest,'') THEN RAISE EXCEPTION 'Invalid journal chain' USING ERRCODE='23514'; END IF;
   END IF; RETURN NEW; END`,
 };
 const checks:Record<string,Record<string,string>>={
  accounting_accounts:{repaid_account_class:"classification IN ('asset','liability','equity','revenue','expense','cogs')",repaid_account_side:"normal_side IN ('debit','credit')",repaid_account_active:'active IN (0,1)'},
  accounting_periods:{repaid_period_dates:`${s}.repaid_iso_date(start_date) AND ${s}.repaid_iso_date(end_date) AND start_date<=end_date`,repaid_period_state:"status IN ('open','closed')"},
  accounting_journals:{repaid_journal_state:"state IN ('draft','posted','reversed')",repaid_journal_date:`${s}.repaid_iso_date(posting_date)`},
  accounting_lines:{repaid_line_rial:'debit BETWEEN 0 AND 9007199254740991 AND credit BETWEEN 0 AND 9007199254740991 AND ((debit>0 AND credit=0) OR (credit>0 AND debit=0))'},
  accounting_journal_voids:{repaid_void_reason:'length(btrim(reason))>=5'},
 };
 const unique:Record<string,Record<string,string>>={accounting_journals:{repaid_journal_event:'event_key',repaid_journal_sequence:'posted_sequence',repaid_journal_reversal:'reversal_of'},accounting_lines:{repaid_journal_position:'journal_id,position'},accounting_events:{repaid_event_key:'event_key'},accounting_event_reviews:{repaid_review_journal:'journal_id'}};
 const triggers:Array<{table:string;name:string;event:string;fn:string;statement?:boolean}>=[];
 const mutable=['accounting_accounts','accounting_periods','accounting_journals','accounting_lines','accounting_journal_voids'];
 for(const table of mutable)triggers.push({table,name:'repaid_00_serialize',event:'INSERT OR UPDATE OR DELETE',fn:'repaid_ledger_lock',statement:true});
 for(const [table,fn,event] of [['accounting_accounts','repaid_account_guard','UPDATE'],['accounting_periods','repaid_period_guard','INSERT OR UPDATE OR DELETE'],['accounting_journals','repaid_journal_guard','INSERT OR UPDATE OR DELETE'],['accounting_lines','repaid_line_guard','INSERT OR UPDATE OR DELETE'],['accounting_journal_voids','repaid_void_guard','INSERT']])triggers.push({table,name:'repaid_10_validate',event,fn});
 const immutable=['accounting_cutover','accounting_events','accounting_event_reviews','accounting_journal_voids'];
 for(const table of immutable)triggers.push({table,name:'repaid_20_immutable',event:'UPDATE OR DELETE',fn:'repaid_ledger_immutable'});
 for(const table of [...new Set([...mutable,...immutable])])triggers.push({table,name:'repaid_no_truncate',event:'TRUNCATE',fn:'repaid_ledger_immutable',statement:true});
 return {s,q,functions,checks,unique,triggers,tables:[...new Set([...mutable,...immutable])]};
}
export async function installPostgresLedgerGuards(db:PostgresDatabase,schema:string){
 const model=definition(schema),{s,q,functions,checks,unique,triggers,tables}=model;
 return db.transaction(async()=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),19204301)',[schema]);
  const exists=await db.query('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',[schema,'repaid_ledger_lock']);
  if(exists.rowCount){await verifyPostgresLedgerGuards(db,schema);return {installed:true,replayed:true,application_ready:false};}
  // No mutation of imported journal/source rows; equivalent guards must validate existing evidence.
  await db.query(`LOCK TABLE ${tables.map(q).join(',')} IN ACCESS EXCLUSIVE MODE`);
  for(const [name,body] of Object.entries(functions))await db.query(`CREATE FUNCTION ${s}.${name}(${name==='repaid_iso_date'?'value text':''}) RETURNS ${name==='repaid_iso_date'?'boolean':'trigger'} LANGUAGE plpgsql SET search_path=pg_catalog AS $repaid$${body}$repaid$`);
  for(const [table,rules] of Object.entries(checks))for(const [name,expression] of Object.entries(rules))await db.query(`ALTER TABLE ${q(table)} ADD CONSTRAINT ${name} CHECK(${expression})`);
  for(const [table,rules] of Object.entries(unique))for(const [name,fields] of Object.entries(rules))await db.query(`ALTER TABLE ${q(table)} ADD CONSTRAINT ${name} UNIQUE(${fields})`);
  for(const trigger of triggers)await db.query(`CREATE TRIGGER ${trigger.name} BEFORE ${trigger.event} ON ${q(trigger.table)} FOR EACH ${trigger.statement?'STATEMENT':'ROW'} EXECUTE FUNCTION ${s}.${trigger.fn}()`);
  const definitions=await constraintDefinitions(db,schema),evidence=JSON.stringify({code_sha256:createHash('sha256').update(JSON.stringify({functions,checks,unique,triggers})).digest('hex'),constraints:definitions});
  await db.query(`COMMENT ON FUNCTION ${s}.repaid_ledger_lock() IS '${evidence.replaceAll("'","''")}'`);
  await verifyPostgresLedgerGuards(db,schema);return {installed:true,replayed:false,application_ready:false};
 });
}
async function constraintDefinitions(db:PostgresDatabase,schema:string){
 const {checks,unique}=definition(schema),names=[...new Set([checks,unique].flatMap(rules=>Object.values(rules).flatMap(entries=>Object.keys(entries))))];
 // Only this guard family's constraints belong to its frozen evidence. Later
 // domain migrations may add independently verified repaid_* constraints.
 return (await db.query<{table_name:string;name:string;definition:string;validated:boolean}>('SELECT c.relname table_name,k.conname name,pg_get_constraintdef(k.oid) definition,k.convalidated validated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND k.conname=ANY($2::text[]) ORDER BY c.relname,k.conname',[schema,names])).rows;
}
/** Verifies actual native definitions, not only a migration-number marker. */
export async function verifyPostgresLedgerGuards(db:PostgresDatabase,schema:string){
 const {functions,checks,unique,triggers}=definition(schema);
 const actual=await db.query<{proname:string;prosrc:string;prosecdef:boolean;proconfig:string[];language:string;volatility:string;return_type:string}>('SELECT p.proname,p.prosrc,p.prosecdef,p.proconfig,p.provolatile volatility,p.prorettype::regtype::text return_type,l.lanname language FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1',[schema]);
 for(const [name,body] of Object.entries(functions)){const rows=actual.rows.filter(row=>row.proname===name);if(rows.length!==1||rows[0].prosrc!==body||rows[0].prosecdef||rows[0].language!=='plpgsql'||rows[0].volatility!=='v'||rows[0].return_type!==(name==='repaid_iso_date'?'boolean':'trigger')||JSON.stringify(rows[0].proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw new Error('PostgreSQL ledger function definition mismatch: '+name);}
 const installed=await db.query<{table_name:string;trigger_name:string;function_name:string;function_schema:string;enabled:string;mask:number;conditional:boolean;arguments:number}>('SELECT c.relname table_name,t.tgname trigger_name,p.proname function_name,pn.nspname function_schema,t.tgenabled enabled,t.tgtype mask,t.tgqual IS NOT NULL conditional,t.tgnargs arguments FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname=$1 AND NOT t.tgisinternal',[schema]);
 for(const expected of triggers){const mask=2+(expected.statement?0:1)+expected.event.split(' OR ').reduce((sum,event)=>sum+({INSERT:4,DELETE:8,UPDATE:16,TRUNCATE:32}[event]??0),0),found=installed.rows.find(row=>row.table_name===expected.table&&row.trigger_name===expected.name);if(!found||found.function_name!==expected.fn||found.function_schema!==schema||!['O','A'].includes(found.enabled)||found.mask!==mask||found.conditional||found.arguments!==0)throw new Error('PostgreSQL ledger trigger missing or altered: '+expected.table+'.'+expected.name);}
 const constraints=await db.query<{table_name:string;name:string;validated:boolean}>('SELECT c.relname table_name,k.conname name,k.convalidated validated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1',[schema]);
 for(const rules of [checks,unique])for(const [table,entries] of Object.entries(rules))for(const name of Object.keys(entries))if(!constraints.rows.some(row=>row.table_name===table&&row.name===name&&row.validated))throw new Error('PostgreSQL ledger constraint missing: '+name);
 const definitionHash=createHash('sha256').update(JSON.stringify({functions,checks,unique,triggers})).digest('hex'),metadata=await db.query<{evidence:string}>("SELECT obj_description(p.oid,'pg_proc') evidence FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='repaid_ledger_lock'",[schema]);
 const evidence=JSON.parse(metadata.rows[0]?.evidence??'null');if(evidence?.code_sha256!==definitionHash||JSON.stringify(evidence.constraints)!==JSON.stringify(await constraintDefinitions(db,schema)))throw new Error('PostgreSQL ledger constraint definition drift');
 return {verified:true,functions:Object.keys(functions).length,triggers:triggers.length,definition_sha256:definitionHash,application_ready:false};
}

/** pg_dump deparses BETWEEN into comparisons; parsing that text may flatten
 * nested AND nodes. Only on our owned restored-copy databases, prove the two
 * expressions normalize identically in PostgreSQL before reinstalling the
 * exact original native check. No source rows or stored proof are rewritten. */
export async function normalizeRestoredPostgresLedgerConstraints(db:PostgresDatabase,schema:string){
 const database=String((await db.query('SELECT current_database() name')).rows[0].name);
 if(!/^repaid_opening_[a-f0-9]{24}$/.test(database))throw Error('Constraint round-trip normalization is restricted to owned opening restore copies');
 try{await verifyPostgresLedgerGuards(db,schema);return {normalized:0};}catch(error){if(!(error instanceof Error)||error.message!=='PostgreSQL ledger constraint definition drift')throw error;}
 const {functions,checks,unique,triggers}=definition(schema),expectedHash=createHash('sha256').update(JSON.stringify({functions,checks,unique,triggers})).digest('hex');
 const metadata=(await db.query(`SELECT obj_description(p.oid,'pg_proc') evidence FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='repaid_ledger_lock'`,[schema])).rows[0];
 const evidence=JSON.parse(String(metadata?.evidence??'null'));
 if(evidence?.code_sha256!==expectedHash||!Array.isArray(evidence.constraints))throw Error('Restore source guard proof is not the current immutable native definition');
 return db.transaction(async()=>{
  let normalized=0;const actual=await constraintDefinitions(db,schema);
  for(const [table,rules] of Object.entries(checks))for(const [name,expression] of Object.entries(rules)){
   const original=evidence.constraints.find((row:{table_name:string;name:string})=>row.table_name===table&&row.name===name),observed=actual.find(row=>row.table_name===table&&row.name===name);
   if(!original||!observed||!original.validated||!observed.validated)throw Error('Restored native constraint evidence is incomplete');
   if(original.definition===observed.definition)continue;
   const probe='repaid_restore_check_'+randomBytes(8).toString('hex');
   await db.query(`CREATE TEMPORARY TABLE "${probe}" (LIKE ${postgresRelation(schema,table)}) ON COMMIT DROP`);
   await db.query(`ALTER TABLE pg_temp."${probe}" ADD CONSTRAINT probe_expected ${original.definition}`);
   await db.query(`ALTER TABLE pg_temp."${probe}" ADD CONSTRAINT probe_observed ${observed.definition}`);
   const parsed=(await db.query(`SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname IN ('probe_expected','probe_observed') ORDER BY conname`,['pg_temp.'+probe])).rows;
   if(parsed.length!==2||parsed[0].definition!==parsed[1].definition)throw Error('Restored ledger check differs semantically; normalization refused');
   await db.query(`ALTER TABLE ${postgresRelation(schema,table)} DROP CONSTRAINT "${name}"`);
   await db.query(`ALTER TABLE ${postgresRelation(schema,table)} ADD CONSTRAINT "${name}" CHECK(${expression})`);normalized++;
  }
  await verifyPostgresLedgerGuards(db,schema);return {normalized};
 });
}
