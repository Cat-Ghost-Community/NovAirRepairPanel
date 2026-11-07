import path from 'node:path';
import os from 'node:os';
const directory=path.resolve(process.env.REPAID_DATA_DIR??'');
if(process.env.FINANCIAL_TEST_MODE!=='1'||!directory.startsWith(path.join(os.tmpdir(),'repaid-installments-')))throw new Error('Explicit disposable installment database required');
async function main(){
 const {DB_PATH}=await import('../src/lib/db/schema');if(DB_PATH!==path.join(directory,'repaid.db'))throw new Error('Database mismatch');
 const {createSession}=await import('../src/lib/auth'),{POST}=await import('../src/app/api/installments/route'),{NextRequest}=await import('next/server');
 const [encoded,key,mode]=process.argv.slice(2),body=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
 const response=await POST(new NextRequest('http://app.test/api/installments',{method:'POST',headers:{origin:'http://app.test','content-type':'application/json','idempotency-key':key,cookie:`repaid_session=${createSession(1)}; repaid_branch=1`},body:JSON.stringify(body)}));
 const result=await response.json();if(mode!=='discard')process.stdout.write(JSON.stringify({...result,status:response.status,installment_status:result.status}));
}
main().catch(e=>{process.stderr.write(e instanceof Error?e.message:'worker failure');process.exitCode=1;});
