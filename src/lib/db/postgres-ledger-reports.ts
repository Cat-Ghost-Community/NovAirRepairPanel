import {authorizePostgresScope,postgresRelation} from './postgres-auth';
import {HttpError} from '../http-error';
import {accountingDate} from '../accounting-date';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
type Account={code:string;name:string;classification:string;normal_side:string;active:string};
/** Individual postings retain safe integer rials. Long-lived aggregate balances
 * may exceed that range; serialize exact decimal text instead of losing rials. */
function reportRial(value:bigint|string){const amount=BigInt(value),maximum=BigInt(Number.MAX_SAFE_INTEGER);return amount<=maximum&&amount>=-maximum?Number(amount):amount.toString();}
/** Async SQL/report port using the SAME accounts, journal lines and recognition states as trialBalance.
 * No SQLite access, cash-as-profit calculation, unbounded line downloads or alternate balance cache. */
export async function postgresTrialBalance(db:PostgresDatabase,schema:string,token:string,filters:{branch_id?:number|null;from?:string;to:string}){
 const table=(name:string)=>postgresRelation(schema,name),to=accountingDate(filters.to),from=filters.from?accountingDate(filters.from):null;if(from&&from>to)throw new HttpError(400,'بازهٔ گزارش معتبر نیست.');
 const work=async()=>{
  const scope=await authorizePostgresScope(db,schema,token,'finance.view',filters.branch_id),accounts=await db.query<Account>(`SELECT code,name,classification,normal_side,active FROM ${table('accounting_accounts')} ORDER BY code LIMIT 2001`);if(accounts.rows.length>2000)throw new HttpError(409,'تعداد سرفصل‌ها نیازمند گزارش دسته‌ای است.');
  const balances=await db.query(`SELECT l.account_code,COALESCE(sum(CASE WHEN $1::text IS NOT NULL AND j.posting_date<$1 THEN l.debit-l.credit ELSE 0 END),0) opening,
   COALESCE(sum(CASE WHEN $1::text IS NULL OR j.posting_date>=$1 THEN l.debit ELSE 0 END),0) debit,COALESCE(sum(CASE WHEN $1::text IS NULL OR j.posting_date>=$1 THEN l.credit ELSE 0 END),0) credit
   FROM ${table('accounting_lines')} l JOIN ${table('accounting_journals')} j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') AND j.posting_date<=$2 AND ($3::bigint IS NULL OR j.branch_id=$3) GROUP BY l.account_code`,[from,to,scope.branchId]);
  const byCode=new Map(balances.rows.map(row=>[String(row.account_code),row]));let debit=BigInt(0),credit=BigInt(0),opening=BigInt(0);
  const rows=accounts.rows.map(account=>{const raw=byCode.get(String(account.code)),value={opening:BigInt(raw?.opening??'0'),debit:BigInt(raw?.debit??'0'),credit:BigInt(raw?.credit??'0')};debit+=value.debit;credit+=value.credit;opening+=value.opening;return {...account,active:safePostgresInteger(account.active),opening:reportRial(value.opening),debit:reportRial(value.debit),credit:reportRial(value.credit),balance:reportRial(value.opening+value.debit-value.credit)};});
  const pending=await db.query(`SELECT count(*) n FROM ${table('accounting_events')} e LEFT JOIN ${table('accounting_event_reviews')} r ON r.event_id=e.id LEFT JOIN ${table('accounting_journals')} j ON j.id=r.journal_id
   WHERE CASE WHEN jsonb_typeof(e.payload_json::jsonb->'control_amount')='number' THEN (e.payload_json::jsonb->>'control_amount')::numeric>0 ELSE false END
   AND NOT EXISTS(SELECT 1 FROM ${table('accounting_opening_event_links')} ol WHERE ol.event_id=e.id) AND (j.id IS NULL OR j.state NOT IN ('posted','reversed')) AND ($1::bigint IS NULL OR e.branch_id=$1)`,[scope.branchId]);
  return {currency:'IRR',branch_id:scope.branchId,from,to,rows,debit:reportRial(debit),credit:reportRial(credit),opening:reportRial(opening),balanced:debit===credit&&opening===BigInt(0),pendingEvents:safePostgresInteger(pending.rows[0].n)};
 };return db.isTransaction()?work():db.transaction(work,{isolation:'repeatable read',readOnly:true});
}
export async function postgresGeneralLedger(db:PostgresDatabase,schema:string,token:string,filters:{account_code:string;from:string;to:string;branch_id?:number|null;after?:number;limit?:number}){
 const from=accountingDate(filters.from),to=accountingDate(filters.to),after=filters.after??0,limit=filters.limit??100;
 if(from>to||!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new HttpError(400,'بازه یا صفحه‌بندی معتبر نیست.');
 const work=async()=>{
  const scope=await authorizePostgresScope(db,schema,token,'finance.view',filters.branch_id),q=(name:string)=>postgresRelation(schema,name),account=(await db.query(`SELECT * FROM ${q('accounting_accounts')} WHERE code=$1`,[filters.account_code])).rows[0];if(!account)throw new HttpError(404,'سرفصل یافت نشد.');
  const base=`FROM ${q('accounting_lines')} l JOIN ${q('accounting_journals')} j ON j.id=l.journal_id WHERE l.account_code=$1 AND j.posting_date<=$2 AND j.state IN ('posted','reversed') AND ($3::bigint IS NULL OR j.branch_id=$3)`,values=[filters.account_code,to,scope.branchId];
  const totals=(await db.query(`SELECT COALESCE(SUM(CASE WHEN j.posting_date<$4 THEN l.debit-l.credit ELSE 0 END),0)::text opening,COALESCE(SUM(CASE WHEN j.posting_date<$4 OR j.posted_sequence<=$5 THEN l.debit-l.credit ELSE 0 END),0)::text running ${base}`, [...values,from,after])).rows[0];let running=BigInt(totals.running);
  const rows=(await db.query(`SELECT l.*,j.posting_date,j.posted_sequence,j.source_type,j.source_id,j.memo journal_memo,j.state ${base} AND j.posting_date>=$4 AND j.posted_sequence>$5 ORDER BY j.posted_sequence,l.position LIMIT $6`,[...values,from,after,limit+1])).rows;
  let page=rows.slice(0,limit);
  if(rows.length>limit&&page.at(-1)!.posted_sequence===rows[limit].posted_sequence){const boundary=page.at(-1)!.posted_sequence;page=page.filter(r=>r.posted_sequence!==boundary);if(!page.length)page=(await db.query(`SELECT l.*,j.posting_date,j.posted_sequence,j.source_type,j.source_id,j.memo journal_memo,j.state ${base} AND j.posted_sequence=$4 ORDER BY l.position LIMIT 500`,[...values,boundary])).rows;}
  const result=page.map(row=>{const debit=safePostgresInteger(row.debit),credit=safePostgresInteger(row.credit);running+=BigInt(debit)-BigInt(credit);return {...row,id:safePostgresInteger(row.id),journal_id:safePostgresInteger(row.journal_id),position:safePostgresInteger(row.position),posted_sequence:safePostgresInteger(row.posted_sequence),debit,credit,balance:reportRial(running)};});
  const last=page.length?safePostgresInteger(page.at(-1)!.posted_sequence):null,next=last!=null&&(await db.query(`SELECT 1 ${base} AND j.posting_date>=$4 AND j.posted_sequence>$5 LIMIT 1`,[...values,from,last])).rowCount?last:null;
  return {currency:'IRR',account,branch_id:scope.branchId,from,to,opening:reportRial(totals.opening),rows:result,next};
 };return db.isTransaction()?work():db.transaction(work,{isolation:'repeatable read',readOnly:true});
}
export async function postgresFinancialStatements(db:PostgresDatabase,schema:string,token:string,filters:{branch_id?:number|null;from:string;to:string}){
 const work=async()=>{
  const activity=await postgresTrialBalance(db,schema,token,filters),asOf=await postgresTrialBalance(db,schema,token,{branch_id:filters.branch_id,to:filters.to});
  const total=(kind:string)=>asOf.rows.filter(r=>r.classification===kind).reduce((n,r)=>n+BigInt(r.balance),BigInt(0)),movement=(kind:string)=>activity.rows.filter(r=>r.classification===kind).reduce((n,r)=>n+BigInt(r.debit)-BigInt(r.credit),BigInt(0));
  const revenue=-movement('revenue'),cogs=movement('cogs'),expenses=movement('expense'),assets=total('asset'),liabilities=-total('liability'),equity=-total('equity'),earnings=-total('revenue')-total('cogs')-total('expense');
  const scope=activity.branch_id,opening=(await db.query(`SELECT id FROM ${postgresRelation(schema,'accounting_opening_documents')} WHERE status='posted' AND ($1::bigint IS NULL OR branch_id=$1) LIMIT 1`,[scope])).rowCount;
  return {currency:'IRR',basis:'posted_journals_only',branch_id:scope,from:filters.from,to:filters.to,revenue:reportRial(revenue),cogs:reportRial(cogs),expenses:reportRial(expenses),profit:reportRial(revenue-cogs-expenses),assets:reportRial(assets),liabilities:reportRial(liabilities),equity:reportRial(equity),retainedCurrentEarnings:reportRial(earnings),balanceSheetBalanced:assets===liabilities+equity+earnings,pendingEvents:activity.pendingEvents,acceptance:opening?'posted_opening_and_journals_only_external_reconciliation_required':'review_required_no_verified_opening_balances'};
 };return db.isTransaction()?work():db.transaction(work,{isolation:'repeatable read',readOnly:true});
}
