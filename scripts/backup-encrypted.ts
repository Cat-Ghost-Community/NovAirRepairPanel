import {getDb,DB_PATH} from '../src/lib/db/schema';import {encryptedBackup} from '../src/lib/backup-archive';
import {requireDatabaseSource} from './database-source';
import {withBackupPreparation} from '../src/lib/backup-admission';
async function main(){if(!process.env.REPAID_BACKUP_OUTPUT||!process.env.REPAID_BACKUP_KEY)throw new Error('Set private backup output and a separate backup encryption key');
 requireDatabaseSource(DB_PATH);const db=getDb();try{const output=process.env.REPAID_BACKUP_OUTPUT,key=process.env.REPAID_BACKUP_KEY;const result=await withBackupPreparation(db,null,()=>encryptedBackup(db,output,key));console.log(JSON.stringify({status:'verified_encrypted_backup',...result}));}finally{db.close();}}
main().catch(()=>{console.error('Encrypted backup failed; inspect configuration, destination permissions and database integrity.');process.exitCode=1;});
