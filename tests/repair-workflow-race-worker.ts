import {NextRequest} from 'next/server';
async function main(){
 process.env.REPAID_DATA_DIR=process.argv[2];process.env.REPAID_DEMO_MODE='0';
 const [token,ticket,revision,key]=process.argv.slice(3);
 const {POST}=await import('../src/app/api/repairs/claim/route');
 const response=await POST(new NextRequest('http://workflow.test/api/repairs/claim',{method:'POST',headers:{cookie:`repaid_session=${token}`,origin:'http://workflow.test','content-type':'application/json','idempotency-key':key},body:JSON.stringify({ticket_id:Number(ticket),version:0,workflow_revision:Number(revision)})}));
 console.log(JSON.stringify({status:response.status}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
