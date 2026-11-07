import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '../src/lib/auth';
const filename=path.resolve(process.env.E2E_DB??'');
if(process.env.FINANCIAL_BROWSER_MUTATIONS!=='1'||!filename.startsWith(path.resolve('.freebuff')+path.sep))throw new Error('Explicit disposable financial fixture required');
process.env.REPAID_DATA_DIR=path.dirname(filename);
async function main(){
 const schema=await import('../src/lib/db/schema');if(schema.DB_PATH!==filename)throw new Error('Disposable database mismatch');const db=schema.getDb();
 try{
  const f=JSON.parse(fs.readFileSync('.freebuff/returns-browser-fixture.json','utf8'));if(f.filename!==filename)throw new Error('Return fixture database mismatch');
  const owner={user:db.prepare("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE email='owner@repaid.local'").get()} as Session;
  const approver={user:db.prepare('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=?').get(f.approver)} as Session;
  const {proposeRecognitionPolicy,changeRecognitionPolicy}=await import('../src/lib/accounting-policy'),{createInvoice}=await import('../src/lib/invoice');
  const date=new Date().toISOString().slice(0,10),rule=proposeRecognitionPolicy(db,owner,{branch_id:f.branch,kind:'service_invoice_v1',effective_date:date,reason:'تصویب مستقل فقط برای پذیرش اقساط در پایگاه آزمایشی'});changeRecognitionPolicy(db,approver,rule.id,'approve');
  const service=createInvoice(owner,{type:'sale',customer_id:f.customer,confirm:true,date,client_key:`installment-browser-${f.nonce}`,items:[{kind:'labor',name:'خدمت واقعی سناریوی اقساط',qty:1,unit_price:1000}]},String(f.branch));
  fs.writeFileSync('.freebuff/installments-browser-fixture.json',JSON.stringify({...f,service:service.id,date},null,2));
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
