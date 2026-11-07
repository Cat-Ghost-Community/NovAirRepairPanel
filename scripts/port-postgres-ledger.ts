import fs from 'node:fs';
import {createPostgresDatabase} from '../src/lib/db/postgres';
import {verifyPostgresSnapshot} from '../src/lib/db/postgres-snapshot';
import {installPostgresLedgerGuards,verifyPostgresLedgerGuards} from '../src/lib/db/postgres-ledger';
import {verifyPostgresLedgerEvidence} from '../src/lib/db/postgres-ledger-proof';
import {installPostgresOperationGuards,verifyPostgresOperationGuards} from '../src/lib/db/postgres-operations';
import {installPostgresBankGuards,verifyPostgresBankGuards} from '../src/lib/db/postgres-bank-schema';
import {protectedBackupPath} from '../src/lib/backup-archive';
async function main(){
 const connectionString=process.env.REPAID_PG_REHEARSAL_URL,manifest=process.env.REPAID_PG_SOURCE_REPORT,output=process.env.REPAID_PG_LEDGER_REPORT;if(!connectionString||!manifest||!output)throw new Error('Dedicated rehearsal URL, retained source manifest and new private report required');
 const evidence=JSON.parse(fs.readFileSync(manifest,'utf8')),url=new URL(connectionString),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname),report=protectedBackupPath(output),handle=fs.openSync(report,'wx',0o600),db=createPostgresDatabase({connectionString,allowLocalPlaintext:local,caFile:process.env.REPAID_PG_CA_FILE});
 try{
  if(!local&&process.env.REPAID_PG_ALLOW_REMOTE_REHEARSAL!=='1')throw new Error('Remote rehearsal requires explicit target authorization');
  const before=await verifyPostgresSnapshot(db,evidence),source=await verifyPostgresLedgerEvidence(db,evidence.schema);if(!source.valid)throw new Error('Existing ledger evidence is inconsistent; no corrective postings may be guessed');
  const installed=await installPostgresLedgerGuards(db,evidence.schema),guards=await verifyPostgresLedgerGuards(db,evidence.schema),after=await verifyPostgresSnapshot(db,evidence),ledger=await verifyPostgresLedgerEvidence(db,evidence.schema);
  const operations=await installPostgresOperationGuards(db,evidence.schema),operationGuards=await verifyPostgresOperationGuards(db,evidence.schema),finalSource=await verifyPostgresSnapshot(db,evidence);
  const banking=await installPostgresBankGuards(db,evidence.schema),bankGuards=await verifyPostgresBankGuards(db,evidence.schema),bankSource=await verifyPostgresSnapshot(db,evidence);
  const result={source_preserved:before.verified&&after.verified&&finalSource.verified&&bankSource.verified,source_sha256:evidence.source_sha256,schema:evidence.schema,installed,guards,ledger,operations,operationGuards,banking,bankGuards,application_ready:false,production_swapped:false};fs.writeFileSync(handle,JSON.stringify(result,null,2));fs.fsyncSync(handle);console.log(JSON.stringify(result));
 }catch(error){fs.writeFileSync(handle,JSON.stringify({status:'blocked_or_incomplete',application_ready:false,production_swapped:false}));fs.fsyncSync(handle);throw error;}
 finally{fs.closeSync(handle);await db.close();}
}
main().catch(()=>{console.error('PostgreSQL core-ledger port rehearsal failed. No live application cutover was performed. Retain the report and inspect source evidence and guard definitions.');process.exitCode=1;});
