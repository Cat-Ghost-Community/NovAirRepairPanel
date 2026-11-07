import {randomBytes} from 'node:crypto';
import type {CheckInput} from '../checks';
import {HttpError} from '../http-error';
import {parseDate} from '../format';
import {rial} from '../money';
import {validateId} from '../validate-id';
import {postgresRelation,authorizePostgresScope} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {capturePostgresBankDocument} from './postgres-bank';
import {capturePostgresFinancialDocument} from './postgres-financial-events';
import {refreshPostgresInvoiceState,syncPostgresSalePaid} from './pg-customer-finance';

function date(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!parseDate(value))throw new HttpError(400,'تاریخ چک معتبر نیست.');return value;}
function text(value:unknown,max=500){if(value==null)return null;if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new HttpError(400,'متن چک معتبر نیست.');return value;}
export async function postgresMutateCheck(db:PostgresDatabase,schema:string,token:string,branchId:number|null,key:unknown,input:CheckInput){
 const table=(name:string)=>postgresRelation(schema,name);
 return db.transaction(async()=>{
  const actor=await authorizePostgresScope(db,schema,token,'finance.manage',branchId,true);
  let branch=actor.branchId??actor.session.user.branch_id;
  if(input.id!=null){const source=(await db.query(`SELECT branch_id FROM ${table('checks')} WHERE id=$1 AND ($2::bigint IS NULL OR branch_id=$2)`,[validateId(input.id),actor.branchId])).rows[0];if(!source)throw new HttpError(404,'چک یافت نشد.');branch=safePostgresInteger(source.branch_id);}
  if(branch==null)throw new HttpError(409,'شعبهٔ چک مشخص نیست.');
  return postgresDurableOperation(db,schema,token,{permission:'finance.manage',branchId:branch,operation:'check_mutation',key,payload:input},async scope=>{
   const account=async(id:unknown)=>{const row=(await db.query(`SELECT id,current_balance FROM ${table('bank_accounts')} WHERE id=$1 AND is_active=1 FOR UPDATE`,[validateId(id)])).rows[0];if(!row)throw new HttpError(400,'حساب بانکی فعال را انتخاب کنید.');return safePostgresInteger(row.id);};
   if(input.id!=null||input.action){
    const check=(await db.query(`SELECT * FROM ${table('checks')} WHERE id=$1 AND branch_id=$2 FOR UPDATE`,[input.id??null,branch])).rows[0];if(!check)throw new HttpError(404,'چک یافت نشد.');
    const action=input.action;if(!['pass','bounce','spend','deposit_bank'].includes(action??''))throw new HttpError(400,'عملیات چک معتبر نیست.');
    if(action==='spend')throw new HttpError(409,'خرج چک نیازمند تخصیص مصوب به بدهی تأمین‌کننده است؛ این گردش پشتیبانی نمی‌شود.');
    const target=action==='pass'?'passed':action==='bounce'?'bounced':'deposited',id=safePostgresInteger(check.id);
    if(check.status===target)return {ok:true,id,already:true};
    if(!(action==='pass'||action==='bounce'?['in_hand','deposited']:['in_hand']).includes(String(check.status)))throw new HttpError(409,'وضعیت فعلی چک نیازمند اصلاح مالی مستقل است.');
    if(action==='pass'){
     const bank=await account(check.bank_account_id??input.bank_account_id),settled=new Date().toISOString();
     await db.query(`UPDATE ${table('checks')} SET status='passed',bank_account_id=$1,settled_at=$2 WHERE id=$3`,[bank,settled,id]);
     const row=(await db.query(`INSERT INTO ${table('bank_transactions')}(account_id,type,amount,description,date,user_id,check_id,operation_group) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[bank,check.kind==='issued'?'withdraw':'deposit',safePostgresInteger(check.amount),'وصول چک شماره '+(check.number??id),settled.slice(0,10),scope.session.user.id,id,randomBytes(16).toString('hex')])).rows[0];
     await capturePostgresBankDocument(db,schema,safePostgresInteger(row.id),scope,branch!);
    }else if(action==='deposit_bank'){
     if(check.kind!=='received')throw new HttpError(400,'فقط چک دریافتی به بانک سپرده می‌شود.');
     await db.query(`UPDATE ${table('checks')} SET status='deposited',bank_account_id=$1 WHERE id=$2`,[await account(input.bank_account_id),id]);
    }else await db.query(`UPDATE ${table('checks')} SET status='bounced' WHERE id=$1`,[id]);
    if(check.invoice_id!=null)await refreshPostgresInvoiceState(db,schema,safePostgresInteger(check.invoice_id));
    if(check.payment_id!=null){const payment=(await db.query(`SELECT sale_id FROM ${table('payments')} WHERE id=$1`,[check.payment_id])).rows[0];if(payment?.sale_id!=null)await syncPostgresSalePaid(db,schema,safePostgresInteger(payment.sale_id));}
    await capturePostgresFinancialDocument(db,schema,'cheque',id,String(action),scope.session.user.id,branch!);
    await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,entity_id,"before","after",branch_id) VALUES($1,$2,'check',$3,$4,$5,$6)`,[scope.session.user.id,'check_'+action,id,JSON.stringify({status:check.status}),JSON.stringify({status:target,branch_id:branch}),branch]);return {ok:true,id,already:false};
   }
   let amount:number;try{amount=rial(input.amount);}catch{throw new HttpError(400,'مبلغ چک باید عدد صحیح به ریال باشد.');}if(amount<=0)throw new HttpError(400,'مبلغ چک باید بیشتر از صفر باشد.');
   const due=date(input.due_date),kind=input.kind??'received';if(!['received','issued'].includes(kind)||input.status&&input.status!=='in_hand')throw new HttpError(400,'نوع یا وضعیت آغازین چک معتبر نیست.');
   if(input.invoice_id!=null)throw new HttpError(400,'چک فاکتور را از ثبت پرداخت همان فاکتور ایجاد کنید.');
   for(const [name,value] of [['customers',input.customer_id],['suppliers',input.supplier_id]] as const)if(value!=null){const row=(await db.query(`SELECT id${name==='customers'?',branch_id':''} FROM ${table(name)} WHERE id=$1`,[validateId(value)])).rows[0];if(!row||name==='customers'&&!['owner','admin'].includes(scope.session.user.role)&&row.branch_id!=null&&safePostgresInteger(row.branch_id)!==branch)throw new HttpError(400,'طرف مجاز چک یافت نشد.');}
   const bank=input.bank_account_id==null?null:await account(input.bank_account_id);let number=input.number?text(input.number,100):null;
   if(!number){const counter=(await db.query(`INSERT INTO ${table('counters')}(key,value) VALUES('check',1) ON CONFLICT(key) DO UPDATE SET value=${table('counters')}.value+1 RETURNING value`)).rows[0];number='CH-'+String(safePostgresInteger(counter.value)).padStart(4,'0');}
   const row=(await db.query(`INSERT INTO ${table('checks')}(number,kind,amount,issue_date,due_date,bank_name,cheque_serial,sayad_id,payer_payee,customer_id,supplier_id,status,bank_account_id,description,user_id,branch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'in_hand',$12,$13,$14,$15) RETURNING id`,[number,kind,amount,input.issue_date?date(input.issue_date):null,due,text(input.bank_name),text(input.cheque_serial),text(input.sayad_id),text(input.payer_payee),input.customer_id??null,input.supplier_id??null,bank,text(input.description,2000),scope.session.user.id,branch])).rows[0];
   const id=safePostgresInteger(row.id);await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES($1,'check_create','check',$2,$3,$4)`,[scope.session.user.id,id,JSON.stringify({amount,kind,branch_id:branch}),branch]);return {ok:true,id,already:false};
  });
 });
}

export async function postgresChecks(db:PostgresDatabase,schema:string,token:string,branch:number|null,options:{status?:string;kind?:string;page?:number;size?:number}={}){
 const page=options.page??1,size=options.size??100;if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(size)||size<1||size>100)throw new HttpError(400,'صفحه‌بندی معتبر نیست.');
 const table=(name:string)=>postgresRelation(schema,name);return db.transaction(async()=>{
  const actor=await authorizePostgresScope(db,schema,token,'finance.view',branch),params=[actor.branchId,options.status??null,options.kind??null,size+1,(page-1)*size];
  const rows=(await db.query(`SELECT c.*,concat_ws(' ',cu.first_name,cu.last_name) customer_name,ba.name bank_account_name FROM ${table('checks')} c LEFT JOIN ${table('customers')} cu ON cu.id=c.customer_id LEFT JOIN ${table('bank_accounts')} ba ON ba.id=c.bank_account_id WHERE ($1::bigint IS NULL OR c.branch_id=$1) AND ($2::text IS NULL OR c.status=$2) AND ($3::text IS NULL OR c.kind=$3) ORDER BY c.due_date,c.id LIMIT $4 OFFSET $5`,params)).rows;
  const summary=(await db.query(`SELECT kind,status,COUNT(*)::text count,SUM(amount)::text total FROM ${table('checks')} WHERE ($1::bigint IS NULL OR branch_id=$1) GROUP BY kind,status`,[actor.branchId])).rows;
  return {checks:rows.slice(0,size).map(row=>{const result={...row};for(const key of ['id','amount','customer_id','supplier_id','invoice_id','bank_account_id','user_id','branch_id','payment_id'])if(result[key]!=null)result[key]=safePostgresInteger(result[key]);return result;}),summary:summary.map(row=>({...row,count:safePostgresInteger(row.count),total:safePostgresInteger(row.total)})),page,has_more:rows.length>size};
 },{isolation:'repeatable read',readOnly:true});
}

export function postgresCheckGuardStatements(schema:string){
 const table=(name:string)=>postgresRelation(schema,name);
 return [
  `CREATE UNIQUE INDEX check_port_one_bank_settlement ON ${table('bank_transactions')}(check_id) WHERE check_id IS NOT NULL`,
  `CREATE FUNCTION ${table('check_port_history')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN RAISE EXCEPTION 'Cheque evidence cannot be deleted' USING ERRCODE='23514'; END $fn$`,
  `CREATE FUNCTION ${table('check_port_state')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN
   IF NEW.amount IS NULL OR NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.kind IS NULL OR NEW.kind NOT IN ('received','issued') OR NEW.status IS NULL OR NEW.branch_id IS NULL OR NEW.user_id IS NULL OR NEW.due_date IS NULL OR NOT ${table('repaid_iso_date')}(NEW.due_date) OR NOT EXISTS(SELECT 1 FROM ${table('branches')} WHERE id=NEW.branch_id AND is_active=1) THEN RAISE EXCEPTION 'Cheque amount, date or branch is invalid' USING ERRCODE='23514'; END IF;
   IF NEW.payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${table('payments')} p WHERE p.id=NEW.payment_id AND p.amount=NEW.amount AND p.branch_id=NEW.branch_id AND p.customer_id IS NOT DISTINCT FROM NEW.customer_id AND p.supplier_id IS NOT DISTINCT FROM NEW.supplier_id AND p.invoice_id IS NOT DISTINCT FROM NEW.invoice_id AND p.method IN ('check','cheque') AND p.direction=CASE WHEN NEW.kind='issued' THEN 'out' ELSE 'in' END) THEN RAISE EXCEPTION 'Cheque must match its original payment exactly' USING ERRCODE='23514'; END IF;
   IF NEW.invoice_id IS NOT NULL AND NEW.payment_id IS NULL THEN RAISE EXCEPTION 'An invoice cheque requires its authoritative payment' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' THEN
    IF NEW.status<>'in_hand' OR NEW.settled_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM ${table('users')} WHERE id=NEW.user_id AND is_active=1 AND (role IN ('owner','admin') OR branch_id=NEW.branch_id)) THEN RAISE EXCEPTION 'Invalid new cheque state or actor' USING ERRCODE='23514'; END IF;
   ELSE
    IF (to_jsonb(NEW)-ARRAY['status','bank_account_id','settled_at','invoice_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','bank_account_id','settled_at','invoice_id']) THEN RAISE EXCEPTION 'Cheque source evidence is immutable' USING ERRCODE='23514'; END IF;
    IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id AND NOT(OLD.invoice_id IS NULL AND NEW.invoice_id IS NOT NULL AND NEW.payment_id IS NOT NULL AND EXISTS(SELECT 1 FROM ${table('invoices')} i WHERE i.id=NEW.invoice_id AND i.branch_id=NEW.branch_id AND i.customer_id IS NOT DISTINCT FROM NEW.customer_id AND i.supplier_id IS NOT DISTINCT FROM NEW.supplier_id)) THEN RAISE EXCEPTION 'Cheque reassignment is not an authorized same-source advance allocation' USING ERRCODE='23514'; END IF;
    IF NOT(NEW.status=OLD.status OR OLD.status='in_hand' AND NEW.status IN ('deposited','bounced','passed') OR OLD.status='deposited' AND NEW.status IN ('bounced','passed')) OR OLD.status IN ('passed','bounced') AND (NEW.bank_account_id,NEW.settled_at) IS DISTINCT FROM (OLD.bank_account_id,OLD.settled_at) THEN RAISE EXCEPTION 'Cleared or rejected cheque requires a financial correction, not a status edit' USING ERRCODE='23514'; END IF;
   END IF;
   IF NEW.status='passed' AND (NEW.bank_account_id IS NULL OR NEW.settled_at IS NULL OR NOT ${table('repaid_iso_date')}(left(NEW.settled_at,10))) OR NEW.status<>'passed' AND NEW.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Cheque collection requires actual settlement evidence' USING ERRCODE='23514'; END IF;
   RETURN NEW; END $fn$`,
  `CREATE FUNCTION ${table('check_port_proof')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ DECLARE event_action text; BEGIN
   IF TG_OP='INSERT' THEN
    IF NEW.payment_id IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM ${table('accounting_events')} e WHERE e.source_type='payment' AND e.source_id=NEW.payment_id::text AND e.event_type='receipt' AND e.branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'Payment cheque requires original immutable receipt evidence' USING ERRCODE='23514'; END IF;
    ELSIF NOT EXISTS(SELECT 1 FROM ${table('audit_logs')} a JOIN ${table('operation_receipts')} r ON r.actor_id=a.user_id AND r.branch_id=a.branch_id WHERE a.entity='check' AND a.entity_id=NEW.id AND a.action='check_create' AND a.branch_id=NEW.branch_id AND r.operation='check_mutation' AND r.result_json::jsonb->>'id'=NEW.id::text) THEN RAISE EXCEPTION 'Standalone cheque requires durable creation and audit' USING ERRCODE='23514'; END IF; RETURN NEW;
   END IF;
   IF NEW.status=OLD.status THEN RETURN NEW; END IF;
   event_action:=CASE WHEN NEW.status='passed' THEN 'pass' WHEN NEW.status='bounced' THEN 'bounce' ELSE 'deposit_bank' END;
   IF NOT EXISTS(SELECT 1 FROM ${table('accounting_events')} e JOIN ${table('audit_logs')} a ON a.user_id=e.actor_id AND a.branch_id=e.branch_id AND a.entity='check' AND a.entity_id=NEW.id AND a.action='check_'||event_action JOIN ${table('operation_receipts')} r ON r.actor_id=e.actor_id AND r.branch_id=e.branch_id AND r.operation='check_mutation' AND r.result_json::jsonb->>'id'=NEW.id::text WHERE e.event_key='cheque:'||NEW.id::text||':'||event_action AND e.branch_id=NEW.branch_id AND e.payload_hash=encode(sha256(convert_to(e.payload_json,'UTF8')),'hex') AND e.payload_json::jsonb->'document'->>'amount'=NEW.amount::text AND e.payload_json::jsonb->'document'->>'status'=NEW.status) THEN RAISE EXCEPTION 'Cheque transition requires exact financial event, durable operation and audit' USING ERRCODE='23514'; END IF;
   IF NEW.status='passed' AND (SELECT COUNT(*) FROM ${table('bank_transactions')} b WHERE b.check_id=NEW.id AND b.amount=NEW.amount AND b.account_id=NEW.bank_account_id AND b.type=CASE WHEN NEW.kind='issued' THEN 'withdraw' ELSE 'deposit' END AND b.date=left(NEW.settled_at,10))<>1 THEN RAISE EXCEPTION 'Cheque collection must commit exactly one matching bank movement' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$`,
  `CREATE TRIGGER check_port_state BEFORE INSERT OR UPDATE ON ${table('checks')} FOR EACH ROW EXECUTE FUNCTION ${table('check_port_state')}()`,
  `CREATE CONSTRAINT TRIGGER check_port_proof AFTER INSERT OR UPDATE ON ${table('checks')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${table('check_port_proof')}()`,
  `CREATE TRIGGER check_port_history BEFORE DELETE OR TRUNCATE ON ${table('checks')} FOR EACH STATEMENT EXECUTE FUNCTION ${table('check_port_history')}()`,
  `DROP TRIGGER repaid_unported_write ON ${table('checks')}`,
 ];
}
export async function installPostgresCheckGuards(db:PostgresDatabase,schema:string){for(const statement of postgresCheckGuardStatements(schema))await db.query(statement);}
