import {HttpError} from './http-error';
import {rial} from './money';
import {parseDate,parseMoneyInput} from './format';

export type BankInput={action?:string;from_account?:number;to_account?:number;account_id?:number;amount:unknown;type?:string;description?:string;ref?:string;date?:string};
export function bankAmountInput(value:string,unit:'rial'|'toman'){return parseMoneyInput(value,unit);}
/** Reporting aggregation only. Unknown cached values require review, never zero. */
export function bankRegisterTotal(accounts:ReadonlyArray<{current_balance:unknown}>):bigint|null {
  let total=BigInt(0);for(const account of accounts){if(typeof account.current_balance!=='number'||!Number.isSafeInteger(account.current_balance))return null;total+=BigInt(account.current_balance);}return total;
}
/** Existing register rules, shared by SQLite and the asynchronous port. This
 * validates a recorded movement; it never executes a provider transaction. */
export function normalizeBankInput(body:BankInput){
  let amount:number;try{amount=rial(body.amount);}catch(error){throw new HttpError(400,(error as Error).message);}
  if(amount<=0)throw new HttpError(400,'مبلغ باید بیشتر از صفر باشد.');
  const date=body.date??new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!parseDate(date))throw new HttpError(400,'تاریخ تراکنش معتبر نیست.');
  if(body.description!=null&&typeof body.description!=='string')throw new HttpError(400,'شرح باید متن باشد.');
  if(body.ref!=null&&(typeof body.ref!=='string'||body.ref.length>500))throw new HttpError(400,'مرجع تراکنش باید متن و حداکثر ۵۰۰ نویسه باشد.');
  const description=String(body.description??'');if(description.length>500)throw new HttpError(400,'شرح نمی‌تواند بیشتر از 500 نویسه باشد.');
  if(body.action==='transfer')return {kind:'transfer' as const,amount,date,description};
  if(body.action||!['deposit','withdraw','pos_settlement'].includes(body.type??''))throw new HttpError(400,'نوع عملیات بانکی معتبر نیست.');
  return {kind:'movement' as const,amount,date,description,type:body.type as 'deposit'|'withdraw'|'pos_settlement'};
}
export function bankBalanceAfter(balance:unknown,delta:number):number {
  if(typeof balance!=='number'||!Number.isSafeInteger(balance)||!Number.isSafeInteger(delta))throw new HttpError(409,'ماندهٔ حساب معتبر نیست؛ بررسی مستند لازم است.');
  const result=BigInt(balance)+BigInt(delta),maximum=BigInt(Number.MAX_SAFE_INTEGER);
  if(result>maximum||result< -maximum)throw new HttpError(400,'ماندهٔ حساب خارج از محدودهٔ مجاز است.');
  return Number(result);
}
