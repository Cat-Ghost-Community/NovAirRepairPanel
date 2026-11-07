/** Independent SQLite writer used only by guarded disposable acceptance tests. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.realpathSync(process.env.REPAID_DATA_DIR??'');
if(process.env.CUSTOMER_CREDIT_WORKER!=='1'||path.dirname(directory)!==fs.realpathSync(os.tmpdir())||!path.basename(directory).startsWith('repaid-credit-'))throw new Error('Disposable customer-credit database required');
const id=Number(process.argv[2]);if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid operation identity');
async function main(){const {getDb}=await import('../src/lib/db/schema'),{postCustomerCredit}=await import('../src/lib/customer-credit'),db=getDb();
 try{const result=postCustomerCredit(db,{user:{id:1,role:'owner',branch_id:1}} as import('../src/lib/auth').Session,id,'1');process.stdout.write(JSON.stringify({ok:true,id:result.id}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));}finally{db.close();}}
void main();
