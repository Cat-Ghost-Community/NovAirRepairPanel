import {describe,it} from 'node:test';import assert from 'node:assert/strict';
import {normalizeBankInput,bankBalanceAfter,bankAmountInput,bankRegisterTotal} from '../src/lib/bank-input';
import {bankEventPayload} from '../src/lib/bank-event';
import {parseMoneyInput,setCurrencyUnit,getCurrencyUnit,fmtMoney} from '../src/lib/format';
describe('shared exact bank register input and historical evidence',()=>{
 it('formats independent integer report totals beyond the per-document range without losing a rial',()=>{
  assert.equal(fmtMoney(BigInt('18014398509481981'),'toman'),'۱,۸۰۱,۴۳۹,۸۵۰,۹۴۸,۱۹۸.۱ تومان');
  assert.equal(fmtMoney(-BigInt('18014398509481981'),'rial'),'-۱۸,۰۱۴,۳۹۸,۵۰۹,۴۸۱,۹۸۱ ریال');
  assert.equal(bankRegisterTotal([{current_balance:Number.MAX_SAFE_INTEGER},{current_balance:Number.MAX_SAFE_INTEGER-1}]),BigInt('18014398509481981'));assert.equal(bankRegisterTotal([{current_balance:null}]),null);assert.equal(bankRegisterTotal([]),BigInt(0));
 });
 it('keeps the final rial of large toman input and accepts localized separators without floating-point conversion',()=>{
  assert.equal(bankAmountInput('900719925474098.7','toman'),9007199254740987);
  assert.equal(bankAmountInput('۱٬۲۳۴٫۵','toman'),12345);assert.equal(bankAmountInput('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱','rial'),Number.MAX_SAFE_INTEGER);
  assert.throws(()=>bankAmountInput('1.25','toman'));assert.throws(()=>bankAmountInput('0.1','rial'));assert.throws(()=>bankAmountInput('900719925474099.2','toman'));
 });
 it('never deletes decimal signs, negative signs or malformed grouping to create a different financial value',()=>{
  for(const text of ['1.5','-15','1e3','1,5','1,,000','1234,567','1.2,3','1 ریال'])assert.throws(()=>parseMoneyInput(text,'rial'));
  assert.equal(parseMoneyInput('1,234,567','rial'),1234567);assert.equal(parseMoneyInput('٠٫١','toman'),1);assert.equal(parseMoneyInput('0','toman',true),0);
  const old=getCurrencyUnit();try{setCurrencyUnit('rial');assert.equal(parseMoneyInput('15'),15);setCurrencyUnit('toman');assert.equal(parseMoneyInput('1.5'),15);}finally{setCurrencyUnit(old);}
 });
 it('validates real register operations and never accepts fractional money or malformed metadata',()=>{
  assert.deepEqual(normalizeBankInput({action:'transfer',amount:17,date:'2026-10-30',description:'Recorded transfer'}),{kind:'transfer',amount:17,date:'2026-10-30',description:'Recorded transfer'});
  for(const amount of [0,-1,0.1,NaN,'1.3',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>normalizeBankInput({amount,type:'deposit'}),error=>(error as {status:number}).status===400);
  for(const body of [{amount:1,type:'online'},{amount:1,type:'deposit',date:'2027-02-30'},{amount:1,type:'deposit',ref:{}},{amount:1,type:'deposit',description:{text:'bad'}}])assert.throws(()=>normalizeBankInput(body as never),error=>(error as {status:number}).status===400);
 });
 it('preserves signed balances exactly and rejects overflow or untrusted cached values before a mutation',()=>{
  assert.equal(bankBalanceAfter(1000,-200),800);assert.equal(bankBalanceAfter(0,-17),-17);
  assert.equal(bankBalanceAfter(Number.MAX_SAFE_INTEGER,-1),Number.MAX_SAFE_INTEGER-1);
  assert.throws(()=>bankBalanceAfter(Number.MAX_SAFE_INTEGER,1),error=>(error as {status:number}).status===400);
  for(const old of [null,'1000',1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>bankBalanceAfter(old,1),error=>(error as {status:number}).status===409);
 });
 it('matches an independently frozen pre-port bank source JSON hash without changing history',()=>{
  const event=bankEventPayload({id:1,account_id:1,type:'deposit',amount:17,to_account_id:null,date:'2026-10-30',check_id:null});
  // Independent Python hashlib over the documented original ordered JSON object.
  assert.equal(event.hash,'7ef766128b75bf382f7a1437015a7b099dcf8afae87dba577559630e13862328');
  assert.equal(JSON.parse(event.json).policy,'review_required');assert.equal(JSON.parse(event.json).branch_basis,'actor_branch_requires_accounting_review');
 });
});
