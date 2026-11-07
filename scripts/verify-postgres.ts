import fs from 'node:fs';import {createPostgresDatabase} from '../src/lib/db/postgres';import {verifyPostgresSnapshot} from '../src/lib/db/postgres-snapshot';
async function main(){const url=process.env.REPAID_PG_REHEARSAL_URL,filename=process.env.REPAID_PG_REHEARSAL_REPORT;if(!url||!filename)throw new Error('Explicit PostgreSQL target and retained private report required');
 const local=['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:local,caFile:process.env.REPAID_PG_CA_FILE,statementTimeoutMs:120000});
 try{console.log(JSON.stringify(await verifyPostgresSnapshot(db,JSON.parse(fs.readFileSync(filename,'utf8')))));}finally{await db.close();}}
main().catch(error=>{console.error('Independent PostgreSQL verification failed:',error instanceof Error?error.message:'unknown failure');process.exitCode=1;});
