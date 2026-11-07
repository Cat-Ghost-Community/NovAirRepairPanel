import fs from 'node:fs';import path from 'node:path';import {createPostgresDatabase} from '../src/lib/db/postgres';import {importSqliteSnapshot} from '../src/lib/db/postgres-snapshot';
async function main(){const input=process.env.REPAID_SQLITE_SNAPSHOT,url=process.env.REPAID_PG_REHEARSAL_URL,output=process.env.REPAID_PG_REHEARSAL_REPORT;
 if(!input||!url||!output)throw new Error('Explicit source snapshot, rehearsal PostgreSQL URL and private report required');
 if(fs.realpathSync(input)===path.resolve(process.env.REPAID_DATA_DIR||'data','repaid.db'))throw new Error('Use a restored snapshot, never a live source database');
 const local=['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);if(!local&&process.env.REPAID_PG_ALLOW_REMOTE_REHEARSAL!=='1')throw new Error('Remote source-data copying requires explicit target authorization');
 const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:local,caFile:process.env.REPAID_PG_CA_FILE,statementTimeoutMs:120000});
 try{const report=await importSqliteSnapshot(db,input);fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({verified:report.verified,application_ready:false,tables:report.tables.length,rows:report.tables.reduce((n,t)=>n+t.rows,0),release_blockers:report.release_blockers}));}finally{await db.close();}}
main().catch(error=>{console.error('PostgreSQL rehearsal failed:',error instanceof Error?error.message:'unknown failure');process.exitCode=1;});
