/** Isolated acceptance worker, never a production command. */
if(process.env.FINANCIAL_TEST_MODE!=='1'||!process.env.REPAID_DATA_DIR)throw new Error('Explicit isolated financial test environment required');
async function main(){
 const {createSession}=await import('../src/lib/auth'),{POST}=await import('../src/app/api/returns/route'),{NextRequest}=await import('next/server');
 const [encoded,key]=process.argv.slice(2),body=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
 const response=await POST(new NextRequest('http://app.test/api/returns',{method:'POST',headers:{origin:'http://app.test','content-type':'application/json','idempotency-key':key,cookie:`repaid_session=${createSession(1)}; repaid_branch=1`},body:JSON.stringify(body)}));
 process.stdout.write(JSON.stringify({status:response.status,...await response.json()}));
}
main().catch(error=>{process.stderr.write(error instanceof Error?error.message:'worker failure');process.exitCode=1;});
