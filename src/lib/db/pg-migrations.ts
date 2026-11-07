import {createHash} from 'node:crypto';
import {postgresDeviceCatalogGuardStatement,postgresDeviceCatalogGuardChecksum,verifyPostgresDeviceCatalogGuard} from './pg-device-catalog-guards';
import type {PostgresDatabase} from './postgres';
import {installPostgresLedgerGuards,verifyPostgresLedgerGuards} from './postgres-ledger';
import {installPostgresOperationGuards,verifyPostgresOperationGuards} from './postgres-operations';
import {POSTGRES_BASELINE,postgresBaselineStatements,postgresFoundationFenceStatements,productionNamespace,productionSchemaCoverage} from './pg-production-schema';
import {installPostgresFinancialEventGuards,verifyPostgresFinancialEventGuards,postgresFinancialEventGuardChecksum} from './postgres-accounting-guards';
import {installPostgresInventoryGuards,verifyPostgresInventoryGuards,postgresInventoryGuardChecksum} from './postgres-inventory';
import {installPostgresCustomerFinanceGuards,postgresCustomerFinanceGuardChecksum} from './postgres-customer-finance-guards';
import {installPostgresCustomerCreditGuards,postgresCustomerCreditGuardChecksum} from './postgres-customer-credit';
import {installPostgresBankGuards,postgresBankGuardChecksum} from './postgres-bank-schema';
import {installPostgresExpenseGuards,postgresExpenseGuardStatements} from './pg-expenses';
import {installPostgresCheckGuards,postgresCheckGuardStatements} from './pg-checks';
import {installPostgresPurchasingGuards,postgresPurchasingGuardStatements} from './pg-purchasing';
import {postgresOperationalProfileStatements,postgresOperationalProfileChecksum} from './pg-operational-profiles';
import {postgresNotificationStatements,postgresNotificationChecksum} from './pg-notifications';
import {postgresDeviceSupportStatements,postgresDeviceSupportChecksum} from './pg-device-support';
import {postgresCustomerMergeStatements,postgresCustomerMergeChecksum} from './pg-customer-merge';
import {postgresChatGuardStatements,postgresChatGuardChecksum,verifyPostgresChatGuards} from './pg-chat-guards';
import {postgresChatNotificationProducerStatements,postgresChatNotificationProducerChecksum,verifyChatNotificationProducerGuards} from './pg-chat-notifications';
import {postgresAppointmentStatements,postgresAppointmentChecksum,verifyPostgresAppointmentGuards} from './pg-appointments';
import {postgresComplaintStatements,postgresComplaintChecksum,verifyPostgresComplaintGuards} from './pg-complaints';
import {postgresRepairIntakeStatements,postgresRepairIntakeChecksum,verifyPostgresRepairIntakeGuards} from './pg-repair-intake';
import {postgresInvoiceSourceIdentityStatements,postgresInvoiceSourceIdentityChecksum,verifyPostgresInvoiceSourceIdentityGuards} from './pg-invoice-source-identity';
import {postgresRepairWorkflowStatements,postgresRepairWorkflowChecksum,verifyPostgresRepairWorkflowGuards} from './pg-repair-workflow-guards';
import {postgresRepairNotesStatements,postgresRepairNotesChecksum,verifyPostgresRepairNotesGuards} from './pg-repair-notes-guards';

import {postgresRepairWorkStatements,postgresRepairWorkChecksum,verifyPostgresRepairWorkGuards} from './pg-repair-work-guards';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const historyBody="BEGIN RAISE EXCEPTION 'Applied migration history is immutable' USING ERRCODE='23514'; END";
const names=['canonical_schema_baseline','native_guards_and_unported_write_fences','financial_source_policy_and_review_guards','financial_inventory_banking_purchasing_domains','operational_customer_device_supplier_profiles','operational_device_controls_customer_merge_internal_chat','operational_appointments_complaints_repair_intake'];
names.push('operational_repair_workflow_assignment_notes');
const checksums=[sha(postgresBaselineStatements('repaid').join('\n')+JSON.stringify(POSTGRES_BASELINE)),sha(postgresFoundationFenceStatements('repaid').join('\n')+'ledger-native-v1;operation-native-v1'),postgresFinancialEventGuardChecksum(),sha(JSON.stringify({nullable_purchase_customer_v1:true,inventory:postgresInventoryGuardChecksum(),finance:postgresCustomerFinanceGuardChecksum(),credit:postgresCustomerCreditGuardChecksum(),bank:postgresBankGuardChecksum(),expense:postgresExpenseGuardStatements('repaid'),cheque:postgresCheckGuardStatements('repaid'),purchasing:postgresPurchasingGuardStatements('repaid')}))];
checksums.push(sha(JSON.stringify({profiles:postgresOperationalProfileChecksum(),notifications:postgresNotificationChecksum()})));
checksums.push(sha(JSON.stringify({devices:postgresDeviceSupportChecksum(),merge:postgresCustomerMergeChecksum(),chat:postgresChatGuardChecksum(),chatNotifications:postgresChatNotificationProducerChecksum()})));
checksums.push(sha(JSON.stringify({appointments:postgresAppointmentChecksum(),complaints:postgresComplaintChecksum(),intake:postgresRepairIntakeChecksum(),invoiceSources:postgresInvoiceSourceIdentityChecksum()})));
checksums.push(sha(JSON.stringify({workflow:postgresRepairWorkflowChecksum(),notes:postgresRepairNotesChecksum()})));
names.push('operational_repair_technical_work_and_time');
checksums.push(postgresRepairWorkChecksum());
names.push('configurable_device_type_registry');
checksums.push(postgresDeviceCatalogGuardChecksum());
export const POSTGRES_SCHEMA_VERSION=10;
type Applied={version:number;name:string;checksum:string;schema_sha256:string};

export async function postgresSchemaEvidence(db:PostgresDatabase,schema:string){
 productionNamespace(schema);
 const results=[];
 results.push((await db.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid) fallback
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,[schema])).rows);
 results.push((await db.query(`SELECT t.relname,k.conname,pg_get_constraintdef(k.oid) definition,k.convalidated FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 ORDER BY t.relname,k.conname`,[schema])).rows);
 results.push((await db.query(`SELECT c.relname,pg_get_indexdef(c.oid) definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='i' ORDER BY c.relname`,[schema])).rows);
 results.push((await db.query(`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,[schema])).rows);
 results.push((await db.query(`SELECT c.relname,pg_get_viewdef(c.oid,false) definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='v' ORDER BY c.relname`,[schema])).rows);
 results.push((await db.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname,arguments`,[schema])).rows);
 results.push((await db.query(`SELECT c.relname,s.seqtypid::regtype::text type,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname`,[schema])).rows);
 return {digest:sha(JSON.stringify(results)),components:results};
}
async function schemaFingerprint(db:PostgresDatabase,schema:string){return (await postgresSchemaEvidence(db,schema)).digest;}
async function history(db:PostgresDatabase,schema:string){
 const q=productionNamespace(schema);
 return (await db.query<Applied>(`SELECT version,name,checksum,schema_sha256 FROM ${q}._repaid_migrations ORDER BY version`)).rows;
}
function checkHistory(rows:Applied[]){
 for(let index=0;index<rows.length;index++)if(rows[index].version!==index+1||rows[index].version>POSTGRES_SCHEMA_VERSION||rows[index].name!==names[index]||rows[index].checksum!==checksums[index])throw Error('PostgreSQL migration history/version/checksum differs from this application');
}
export async function postgresCurrentSchemaCoverage(db:PostgresDatabase,schema:string){
 productionNamespace(schema);const baseline=productionSchemaCoverage(),names=POSTGRES_BASELINE.tables.map(table=>table.name);
 const fences=(await db.query(`SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname='repaid_unported_write' AND t.tgenabled IN ('O','A') AND c.relname=ANY($2::text[]) ORDER BY c.relname`,[schema,names])).rows.map(row=>String(row.relname));
 return {...baseline,foundation_fenced_tables:baseline.fenced_tables,fenced_tables:fences,unfenced_tables:names.filter(name=>!fences.includes(name)),application_wide_ready:false};
}
async function verifyHistoryGuard(db:PostgresDatabase,schema:string){
 const functions=await db.query(`SELECT p.prosrc,p.prosecdef,p.proconfig,p.prorettype::regtype::text result FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='repaid_migration_history_guard'`,[schema]);
 const trigger=await db.query(`SELECT t.tgenabled,t.tgtype,t.tgnargs,t.tgqual IS NOT NULL conditional FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace f ON f.oid=p.pronamespace WHERE n.nspname=$1 AND c.relname='_repaid_migrations' AND t.tgname='repaid_migration_immutable' AND p.proname='repaid_migration_history_guard' AND f.nspname=$1`,[schema]);
 const fn=functions.rows[0],tg=trigger.rows[0];
 if(functions.rowCount!==1||!fn||fn.prosrc!==historyBody||fn.prosecdef||fn.result!=='trigger'||JSON.stringify(fn.proconfig)!==JSON.stringify(['search_path=pg_catalog'])||trigger.rowCount!==1||!tg||tg.tgenabled!=='O'||tg.tgtype!==58||tg.tgnargs!==0||tg.conditional)throw Error('PostgreSQL migration history protection is missing or altered');
}
async function bootstrapHistory(db:PostgresDatabase,schema:string){
 const q=productionNamespace(schema);
 const exists=(await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount;
 if(!exists)await db.query(`CREATE SCHEMA ${q}`);
 const registry=(await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='_repaid_migrations'`,[schema])).rowCount;
 if(!registry){
  const objects=await db.query('SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 LIMIT 1',[schema]);
  if(objects.rowCount)throw Error('Unmanaged populated PostgreSQL schema requires an explicit reviewed adoption migration');
  await db.query(`CREATE TABLE ${q}._repaid_migrations(version integer PRIMARY KEY CHECK(version>0),name text NOT NULL,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),schema_sha256 text NOT NULL CHECK(schema_sha256~'^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),applied_by text NOT NULL DEFAULT current_user,execution_ms bigint NOT NULL CHECK(execution_ms>=0))`);
  await db.query(`CREATE FUNCTION ${q}.repaid_migration_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$${historyBody}$fn$`);
  await db.query(`CREATE TRIGGER repaid_migration_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON ${q}._repaid_migrations FOR EACH STATEMENT EXECUTE FUNCTION ${q}.repaid_migration_history_guard()`);
 }
 await verifyHistoryGuard(db,schema);
}
async function advanceIdentitySequences(db:PostgresDatabase,schema:string){
 const namespace=productionNamespace(schema);
 for(const table of POSTGRES_BASELINE.tables){
  const primary=table.columns.filter(c=>c.primary);
  if(primary.length!==1||primary[0].type!=='bigint')continue;
  const column=primary[0].name,relation=`${namespace}."${table.name}"`,sequence=`${namespace}."${table.name}_${column}_seq"`;
  const current=(await db.query(`SELECT last_value::text,is_called FROM ${sequence}`)).rows[0];
  const maximum=(await db.query(`SELECT MAX("${column}")::text maximum FROM ${relation}`)).rows[0]?.maximum as string|null;
  const last=BigInt(current.last_value),next=last+(current.is_called?BigInt(1):BigInt(0)),required=maximum==null?BigInt(1):BigInt(maximum)+BigInt(1);
  if(required>BigInt('9223372036854775807'))throw Error('Preserved identity exceeds PostgreSQL sequence capacity');
  // ALTER IDENTITY RESTART is transactional; setval() would survive rollback.
  if(required>next)await db.query(`ALTER TABLE ${relation} ALTER COLUMN "${column}" RESTART WITH ${required}`);
 }
}

/** Administrative operation only. No request handler invokes DDL. Advisory lock
 * and existing bounded PostgreSQL transaction own the complete upgrade. */
export async function applyPostgresMigrations(db:PostgresDatabase,schema:string,options:{targetVersion?:number}={}){
 const q=productionNamespace(schema),target=options.targetVersion??POSTGRES_SCHEMA_VERSION;
 if(!Number.isInteger(target)||target<1||target>POSTGRES_SCHEMA_VERSION)throw Error('Unsupported PostgreSQL schema target');
 return db.transaction(async()=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,19204320))',[schema]);
  await bootstrapHistory(db,schema);const rows=await history(db,schema);checkHistory(rows);
  if(rows.length>target)throw Error('Migration downgrade is unsupported; retain data and use reviewed forward/compensating changes');
  if(rows.length&&rows.at(-1)!.schema_sha256!==await schemaFingerprint(db,schema))throw Error('PostgreSQL schema drift detected before migration');
  const applied:number[]=[];
  for(let version=rows.length+1;version<=target;version++){
   const started=Date.now();
   if(version===1)for(const statement of postgresBaselineStatements(schema))await db.query(statement);
   if(version===2){
    await advanceIdentitySequences(db,schema);
    await installPostgresLedgerGuards(db,schema);await installPostgresOperationGuards(db,schema);
    for(const statement of postgresFoundationFenceStatements(schema))await db.query(statement);
   }
   if(version===3)await installPostgresFinancialEventGuards(db,schema);
   if(version===4){
    // Supplier invoices have a supplier, not a fabricated customer0. Existing
    // stored sentinels remain untouched; customer invoices retain native checks.
    await db.query(`ALTER TABLE ${q}.invoices ALTER COLUMN customer_id DROP NOT NULL`);
    await db.query(`ALTER TABLE ${q}.payments ALTER COLUMN customer_id DROP NOT NULL`);
    await installPostgresInventoryGuards(db,schema);await installPostgresCustomerFinanceGuards(db,schema);await installPostgresCustomerCreditGuards(db,schema);
    for(const name of ['parts','inventory_locations','inventory_stock','inventory_movements','inventory_transfers'])await db.query(`DROP TRIGGER repaid_unported_write ON ${q}."${name}"`);
    await db.query(`DROP TRIGGER repaid_unported_write ON ${q}.notifications`);
    await db.query(`CREATE TRIGGER repaid_unported_write BEFORE UPDATE OR DELETE OR TRUNCATE ON ${q}.notifications FOR EACH STATEMENT EXECUTE FUNCTION ${q}.repaid_unported_write_fence()`);
    for(const name of ['customer_credit_operations','customer_credit_refunds'])await db.query(`DROP TRIGGER repaid_unported_write ON ${q}."${name}"`);
    for(const name of ['bank_accounts','bank_transactions'])await db.query(`DROP TRIGGER repaid_unported_write ON ${q}."${name}"`);
    await installPostgresBankGuards(db,schema);await installPostgresExpenseGuards(db,schema);await installPostgresCheckGuards(db,schema);await installPostgresPurchasingGuards(db,schema);
   }
   if(version===5)for(const statement of [...postgresOperationalProfileStatements(schema),...postgresNotificationStatements(schema)])await db.query(statement);
   if(version===6)for(const statement of [...postgresDeviceSupportStatements(schema),...postgresCustomerMergeStatements(schema),...postgresChatGuardStatements(schema),...postgresChatNotificationProducerStatements(schema)])await db.query(statement);
   if(version===7)for(const statement of [...postgresRepairIntakeStatements(schema),...postgresAppointmentStatements(schema),...postgresComplaintStatements(schema),...postgresInvoiceSourceIdentityStatements(schema)])await db.query(statement);
   if(version===8)for(const statement of [...postgresRepairWorkflowStatements(schema),...postgresRepairNotesStatements(schema)])await db.query(statement);
   if(version===9)for(const statement of postgresRepairWorkStatements(schema))await db.query(statement);
   if(version===10)await db.query(postgresDeviceCatalogGuardStatement(schema));
   const digest=await schemaFingerprint(db,schema);
   await db.query(`INSERT INTO ${q}._repaid_migrations(version,name,checksum,schema_sha256,execution_ms) VALUES($1,$2,$3,$4,$5)`,[version,names[version-1],checksums[version-1],digest,Date.now()-started]);applied.push(version);
  }
  if(target>=2){await verifyPostgresLedgerGuards(db,schema);await verifyPostgresOperationGuards(db,schema);}
  if(target>=3)await verifyPostgresFinancialEventGuards(db,schema);
  if(target>=4)await verifyPostgresInventoryGuards(db,schema);
  if(target>=6){await verifyPostgresChatGuards(db,schema);await verifyChatNotificationProducerGuards(db,schema);}
  if(target>=7){await verifyPostgresComplaintGuards(db,schema);await verifyPostgresRepairIntakeGuards(db,schema);await verifyPostgresAppointmentGuards(db,schema);await verifyPostgresInvoiceSourceIdentityGuards(db,schema);}
  if(target>=8){await verifyPostgresRepairWorkflowGuards(db,schema);await verifyPostgresRepairNotesGuards(db,schema);}
  if(target>=9)await verifyPostgresRepairWorkGuards(db,schema);
  if(target>=10)await verifyPostgresDeviceCatalogGuard(db,schema);
  return {schema,version:target,applied,replayed:applied.length===0,application_wide_ready:false,coverage:await postgresCurrentSchemaCoverage(db,schema)};
 });
}

/** No DDL, no fallback and no guessed migration status. A site integration may
 * start only after independently applied current migrations verify. */
export async function verifyPostgresMigrations(db:PostgresDatabase,schema:string){
 productionNamespace(schema);const rows=await history(db,schema);checkHistory(rows);
 if(rows.length!==POSTGRES_SCHEMA_VERSION)throw Error('Current PostgreSQL schema migrations must be applied before startup');
 await verifyHistoryGuard(db,schema);
 if(rows.at(-1)!.schema_sha256!==await schemaFingerprint(db,schema))throw Error('PostgreSQL schema drift detected');
 await verifyPostgresLedgerGuards(db,schema);await verifyPostgresOperationGuards(db,schema);
 await verifyPostgresFinancialEventGuards(db,schema);
 await verifyPostgresInventoryGuards(db,schema);
 await verifyPostgresChatGuards(db,schema);await verifyChatNotificationProducerGuards(db,schema);
 await verifyPostgresComplaintGuards(db,schema);await verifyPostgresRepairIntakeGuards(db,schema);await verifyPostgresAppointmentGuards(db,schema);await verifyPostgresInvoiceSourceIdentityGuards(db,schema);
 await verifyPostgresRepairWorkflowGuards(db,schema);await verifyPostgresRepairNotesGuards(db,schema);
 await verifyPostgresRepairWorkGuards(db,schema);
 await verifyPostgresDeviceCatalogGuard(db,schema);
 return {verified:true,schema,version:POSTGRES_SCHEMA_VERSION,application_wide_ready:false};
}
