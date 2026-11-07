import {randomBytes} from 'node:crypto';
import {HttpError} from '../http-error';
import {bankBalanceAfter,normalizeBankInput,type BankInput} from '../bank-input';
import {bankEventPayload,type BankEventDocument} from '../bank-event';
import {validateId} from '../validate-id';
import {authorizePostgresScope,postgresRelation,type Scope} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
export type BankMutationResult={ok:true;id:number;accounting_state?:'pending_review';external_execution?:false};

function central(scope:Scope){if(!['owner','admin'].includes(scope.session.user.role))throw new HttpError(403,'دسترسی به حساب‌های بانکی مرکزی نیازمند دسترسی بین‌شعبه‌ای است.');}
export async function capturePostgresBankDocument(db:PostgresDatabase,schema:string,id:number,scope:Scope,branch:number){
  if(!db.isTransaction())throw new Error('Bank capture requires the source transaction');
  const raw=(await db.query(`SELECT id,account_id,type,amount,to_account_id,date,check_id FROM ${postgresRelation(schema,'bank_transactions')} WHERE id=$1`,[id])).rows[0];
  if(!raw)throw new Error('Bank source document missing');
  const document:BankEventDocument={id:safePostgresInteger(raw.id),account_id:safePostgresInteger(raw.account_id),type:String(raw.type),amount:safePostgresInteger(raw.amount),to_account_id:raw.to_account_id==null?null:safePostgresInteger(raw.to_account_id),date:raw.date==null?null:String(raw.date),check_id:raw.check_id==null?null:safePostgresInteger(raw.check_id)};
  const payload=bankEventPayload(document),action=['transfer_in','transfer_out'].includes(document.type)?document.type:'movement';
  await db.query(`INSERT INTO ${postgresRelation(schema,'accounting_events')}(event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash,actor_id,created_at) VALUES($1,'bank',$2,$3,$4,$5,$6,$7,$8)`,['bank:'+id+':'+action,String(id),branch,action,payload.json,payload.hash,scope.session.user.id,new Date().toISOString()]);
}

/** Documented bank register movement, NOT provider execution or ledger posting.
 * Account changes are applied by native insert triggers. Both sides, immutable
 * events, audit and result are checked at commit and share one transaction. */
export async function postgresMutateBank(db:PostgresDatabase,schema:string,token:string,key:unknown,body:BankInput){
  return db.transaction(async()=>{
    const actor=await authorizePostgresScope(db,schema,token,'finance.manage',null,true);central(actor);
    const branch=actor.session.user.branch_id;if(branch==null)throw new HttpError(409,'شعبهٔ انتساب سند بانکی مشخص نیست؛ ابتدا بررسی کنید.');
    return postgresDurableOperation<BankMutationResult>(db,schema,token,{permission:'finance.manage',branchId:branch,operation:'bank_mutation',scope:'business',key,payload:body},async scope=>{
      central(scope);const input=normalizeBankInput(body),{amount,date,description}=input,table=(name:string)=>postgresRelation(schema,name);
      const source=validateId(input.kind==='transfer'?body.from_account:body.account_id),target=input.kind==='transfer'?validateId(body.to_account):null;
      if(source===target)throw new HttpError(400,'حساب مبدأ و مقصد باید متفاوت باشند.');
      const ids=target==null?[source]:[source,target];
      const rows=(await db.query(`SELECT id,current_balance FROM ${table('bank_accounts')} WHERE id=ANY($1::bigint[]) AND is_active=1 ORDER BY id FOR UPDATE`,[ids])).rows;
      if(rows.length!==ids.length)throw new HttpError(404,'حساب بانکی فعال یافت نشد.');
      for(const row of rows)bankBalanceAfter(safePostgresInteger(row.current_balance),input.kind==='transfer'?(safePostgresInteger(row.id)===source?-amount:amount):input.type==='withdraw'?-amount:amount);
      const group=randomBytes(16).toString('hex'),created=new Date().toISOString(),insert=async(account:number,type:string,other:number|null)=>{
        const result=await db.query(`INSERT INTO ${table('bank_transactions')}(account_id,type,amount,to_account_id,description,date,user_id,ref,created_at,operation_group) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[account,type,amount,other,description,date,scope.session.user.id,input.kind==='transfer'?null:body.ref??null,created,group]);
        const id=safePostgresInteger(result.rows[0].id);await capturePostgresBankDocument(db,schema,id,scope,branch);return id;
      };
      const id=await insert(source,input.kind==='transfer'?'transfer_out':input.type,target);
      if(target!=null)await insert(target,'transfer_in',source);
      const after=input.kind==='transfer'?{from_account:source,to_account:target,amount}:{account_id:source,type:input.type,amount};
      await db.query(`INSERT INTO ${table('audit_logs')}(user_id,action,entity,entity_id,"before","after",branch_id,created_at) VALUES($1,$2,'bank_transaction',$3,NULL,$4,$5,$6)`,[scope.session.user.id,input.kind==='transfer'?'bank_transfer':'bank_txn',id,JSON.stringify(after),branch,created]);
      return {ok:true,id,accounting_state:'pending_review',external_execution:false};
    });
  });
}

/** Centralized accounts have no operating-branch ownership. Do not fabricate a
 * branch filter. Balances are register positions, never certified profit. */
export async function postgresBankPosition(db:PostgresDatabase,schema:string,token:string,options:{page?:number;size?:number;before?:number;account_id?:number}={}){
  const page=options.page??1,size=options.size??20;
  if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(size)||size<1||size>100)throw new HttpError(400,'صفحه‌بندی معتبر نیست.');
  const before=options.before==null?null:validateId(options.before),account=options.account_id==null?null:validateId(options.account_id),table=(name:string)=>postgresRelation(schema,name);
  return db.transaction(async()=>{
    central(await authorizePostgresScope(db,schema,token,'finance.view',null));
    const source=await db.query(`SELECT a.id,a.name,a.is_active,a.current_balance,a.register_base_value,a.register_base_kind,
      COALESCE((SELECT SUM(CASE WHEN t.type IN ('withdraw','transfer_out') THEN -t.amount::numeric ELSE t.amount::numeric END) FROM ${table('bank_transactions')} t WHERE t.account_id=a.id AND t.id>a.register_base_after_id),0) movement_delta,
      COALESCE((SELECT SUM(l.debit::numeric-l.credit::numeric) FROM ${table('accounting_lines')} l JOIN ${table('accounting_journals')} j ON j.id=l.journal_id WHERE l.bank_account_id=a.id AND l.account_code='1020' AND j.state IN ('posted','reversed')),0) ledger_balance,
      (SELECT COUNT(*) FROM ${table('bank_transactions')} t JOIN ${table('accounting_events')} e ON e.event_key=CASE WHEN t.check_id IS NOT NULL THEN 'cheque:'||t.check_id::text||':pass' ELSE 'bank:'||t.id::text||':'||CASE WHEN t.type IN ('transfer_in','transfer_out') THEN t.type ELSE 'movement' END END
        LEFT JOIN ${table('accounting_event_reviews')} r ON r.event_id=e.id LEFT JOIN ${table('accounting_journals')} j ON j.id=r.journal_id WHERE t.account_id=a.id AND (j.id IS NULL OR j.state NOT IN ('posted','reversed'))) pending_posting_count,
      (SELECT COUNT(*) FROM ${table('bank_transactions')} t LEFT JOIN ${table('accounting_events')} e ON e.event_key='bank:'||t.id::text||':'||CASE WHEN t.type IN ('transfer_in','transfer_out') THEN t.type ELSE 'movement' END WHERE t.account_id=a.id AND e.id IS NULL) missing_source_count
      FROM ${table('bank_accounts')} a WHERE ($1::bigint IS NULL OR a.id=$1) ORDER BY a.id LIMIT $2 OFFSET $3`,[account,size+1,(page-1)*size]);
    const rows=source.rows.slice(0,size).map(row=>{
      const balance=safePostgresInteger(row.current_balance),base=safePostgresInteger(row.register_base_value),movement=safePostgresInteger(row.movement_delta),ledger=safePostgresInteger(row.ledger_balance),pending=safePostgresInteger(row.pending_posting_count),missing=safePostgresInteger(row.missing_source_count),matches=BigInt(balance)===BigInt(base)+BigInt(movement);
      return {id:safePostgresInteger(row.id),name:String(row.name),active:Number(row.is_active)===1,registered_balance:balance,baseline:base,baseline_kind:String(row.register_base_kind),movement_delta:movement,register_reconciled:matches,ledger_balance:ledger,pending_posting_count:pending,missing_source_count:missing,historical_baseline_accounting_verified:false,flags:[...(!matches?['register_drift']:[]),...(row.register_base_kind==='imported_register_v1'?['legacy_baseline_unverified']:['opening_not_approved']),...(pending?['pending_accounting_review']:[]),...(missing?['legacy_source_gap']:[]),...(balance!==ledger?['ledger_difference']:[])]};
    });
    const transactions=(await db.query(`SELECT id,account_id,type,amount,to_account_id,date,operation_group FROM ${table('bank_transactions')} WHERE ($1::bigint IS NULL OR id<$1) AND ($2::bigint IS NULL OR account_id=$2) ORDER BY id DESC LIMIT 101`,[before,account])).rows;
    const history=transactions.slice(0,100).map(row=>({...row,id:safePostgresInteger(row.id),account_id:safePostgresInteger(row.account_id),amount:safePostgresInteger(row.amount),to_account_id:row.to_account_id==null?null:safePostgresInteger(row.to_account_id)}));
    const totalExact=String((await db.query(`SELECT COALESCE(SUM(current_balance::numeric),0)::text value FROM ${table('bank_accounts')} WHERE is_active=1`)).rows[0].value),total=BigInt(totalExact),safe=total<=BigInt(Number.MAX_SAFE_INTEGER)&&total>=-BigInt(Number.MAX_SAFE_INTEGER);
    return {currency:'IRR',scope:'centralized_company',accounting_certified:false,external_execution:false,page,has_more:source.rows.length>size,accounts:rows,transactions:history,next_before:transactions.length>100?history[history.length-1].id:null,total:safe?Number(total):null,total_exact:totalExact,total_state:safe?'exact':'exceeds_number_range'};
  },{isolation:'repeatable read',readOnly:true});
}
