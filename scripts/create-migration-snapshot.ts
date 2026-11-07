import {DatabaseSync} from 'node:sqlite';import {copyVerifiedDatabase} from '../src/lib/backup-copy';
async function main(){const source=process.env.REPAID_SQLITE_SOURCE,output=process.env.REPAID_SQLITE_SNAPSHOT;if(!source||!output)throw new Error('Explicit SQLite source and new private snapshot destination required');
 const db=new DatabaseSync(source,{readOnly:true});try{console.log(JSON.stringify(await copyVerifiedDatabase(db,output)));}finally{db.close();}}
main().catch(()=>{console.error('Migration snapshot failed; original database was not rewritten.');process.exitCode=1;});
