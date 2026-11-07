import {HttpError} from '../http-error';
import {rial} from '../money';
import {parseDate} from '../format';
import {postgresRelation,authorizePostgresScope} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {capturePostgresFinancialDocument} from './postgres-financial-events';

function text(value:unknown,label:string,max:number,required=false){
 if(value==null&&!required)return null;
 if(typeof value!=='string'||value.includes('\0')||value.length>max||required&&!value.trim())throw new HttpError(400,label+' معتبر نیست.');
 return value.trim();
}
export async function postgresCreateExpense(db:PostgresDatabase,schema:string,token:string,branchId:number,key:unknown,body:Record<string,unknown>){
 let amount:number;try{amount=rial(body.amount??0);}catch{throw new HttpError(400,'مبلغ باید عدد صحیح ریال باشد.');}
 if(amount<=0)throw new HttpError(400,'مبلغ باید بیشتر از صفر باشد.');
 const category=text(body.category??'سایر','دسته‌بندی',100,true),vendor=text(body.vendor,'فروشنده',300),description=text(body.description,'شرح',2000);
 const date=body.date??new Date().toISOString().slice(0,10),method=body.method??'cash';
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!parseDate(date))throw new HttpError(400,'تاریخ هزینه معتبر نیست.');
 if(typeof method!=='string'||!['cash','card','transfer','bank_transfer','other'].includes(method))throw new HttpError(400,'روش پرداخت هزینه معتبر نیست.');
 const table=(name:string)=>postgresRelation(schema,name);
 return postgresDurableOperation(db,schema,token,{permission:'expenses.manage',branchId,operation:'expense_create',key,payload:body},async scope=>{
  const result=await db.query(`INSERT INTO ${table('expenses')}(category,amount,date,vendor,method,branch_id,description,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[category,amount,date,vendor,method,branchId,description,scope.session.user.id]);
  const id=safePostgresInteger(result.rows[0].id);
  await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES($1,'create','expense',$2,$3,$4)`,[scope.session.user.id,id,JSON.stringify({category,amount,branch_id:branchId}),branchId]);
  await capturePostgresFinancialDocument(db,schema,'expense',id,'record',scope.session.user.id,branchId);
  return {id};
 });
}
export async function postgresExpenses(db:PostgresDatabase,schema:string,token:string,branchId:number|null,options:{page?:number;size?:number}={}){
 const page=options.page??1,size=options.size??50;
 if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(size)||size<1||size>100)throw new HttpError(400,'صفحه‌بندی معتبر نیست.');
 return db.transaction(async()=>{
  const scope=await authorizePostgresScope(db,schema,token,'expenses.view',branchId);
  const results=await db.query(`SELECT * FROM ${postgresRelation(schema,'expenses')} WHERE ($1::bigint IS NULL OR branch_id=$1) ORDER BY date DESC,id DESC LIMIT $2 OFFSET $3`,[scope.branchId,size+1,(page-1)*size]);
  const expenses=results.rows.slice(0,size).map(row=>({...row,id:safePostgresInteger(row.id),amount:safePostgresInteger(row.amount),branch_id:row.branch_id==null?null:safePostgresInteger(row.branch_id),user_id:row.user_id==null?null:safePostgresInteger(row.user_id)}));
  return {expenses,page,per_page:size,has_more:results.rows.length>size,currency:'IRR'};
 },{isolation:'repeatable read',readOnly:true});
}

/** Source documents, their immutable event, operation receipt and audit must
 * commit together. This is the existing single recorded-expense model; no
 * unimplemented approval or external disbursement is claimed. */
export function postgresExpenseGuardStatements(schema:string){
 const table=(name:string)=>postgresRelation(schema,name);
 return [
 `CREATE OR REPLACE FUNCTION ${table('expense_port_history')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN RAISE EXCEPTION 'Recorded expense history is immutable; use an approved correction' USING ERRCODE='23514'; END $fn$`,
 `CREATE OR REPLACE FUNCTION ${table('expense_port_insert')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN
 IF NEW.amount IS NULL OR NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.branch_id IS NULL OR NEW.user_id IS NULL OR NEW.category IS NULL OR length(trim(NEW.category)) NOT BETWEEN 1 AND 100 OR NEW.date IS NULL OR NOT ${table('repaid_iso_date')}(NEW.date) OR NEW.method IS NULL OR NEW.method NOT IN ('cash','card','transfer','bank_transfer','other')
 OR NOT EXISTS(SELECT 1 FROM ${table('users')} u JOIN ${table('branches')} b ON b.id=NEW.branch_id WHERE u.id=NEW.user_id AND u.is_active=1 AND b.is_active=1 AND (u.role IN ('owner','admin') OR u.branch_id=NEW.branch_id)) THEN RAISE EXCEPTION 'Expense source amount, date, actor or branch is invalid' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
 `CREATE OR REPLACE FUNCTION ${table('expense_port_proof')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM ${table('accounting_events')} e WHERE e.event_key='expense:'||NEW.id::text||':record' AND e.source_type='expense' AND e.source_id=NEW.id::text AND e.branch_id=NEW.branch_id AND e.actor_id=NEW.user_id AND e.payload_hash=encode(sha256(convert_to(e.payload_json,'UTF8')),'hex') AND e.payload_json::jsonb->'document'->>'amount'=NEW.amount::text)
 OR NOT EXISTS(SELECT 1 FROM ${table('operation_receipts')} r WHERE r.actor_id=NEW.user_id AND r.branch_id=NEW.branch_id AND r.operation='expense_create' AND r.result_json::jsonb->>'id'=NEW.id::text)
 OR NOT EXISTS(SELECT 1 FROM ${table('audit_logs')} a WHERE a.user_id=NEW.user_id AND a.branch_id=NEW.branch_id AND a.entity='expense' AND a.entity_id=NEW.id AND a.action='create') THEN RAISE EXCEPTION 'Expense requires its exact financial event, durable operation and audit' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
  `CREATE TRIGGER expense_port_insert BEFORE INSERT ON ${table('expenses')} FOR EACH ROW EXECUTE FUNCTION ${table('expense_port_insert')}()`,
  `CREATE CONSTRAINT TRIGGER expense_port_proof AFTER INSERT ON ${table('expenses')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${table('expense_port_proof')}()`,
  `CREATE TRIGGER expense_port_history BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table('expenses')} FOR EACH STATEMENT EXECUTE FUNCTION ${table('expense_port_history')}()`,
  `DROP TRIGGER repaid_unported_write ON ${table('expenses')}`,
 ];
}
export async function installPostgresExpenseGuards(db:PostgresDatabase,schema:string){for(const sql of postgresExpenseGuardStatements(schema))await db.query(sql);}
