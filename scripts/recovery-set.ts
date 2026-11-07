import {verifyRecoverySet,copyRecoverySet,restoreRecoverySet,createRecoverySet} from '../src/lib/recovery-set';
import {checkScheduledRecovery} from '../src/lib/scheduled-recovery';
import {withBackupPreparation} from '../src/lib/backup-admission';
import {requireDatabaseSource} from './database-source';
function required(name:string){const value=process.env[name];if(!value)throw Error('Explicit recovery configuration missing');return value;}
async function main(){
 const action=process.argv[2],key=required('REPAID_BACKUP_KEY');let result:unknown;
 if(action==='verify')result=await verifyRecoverySet(process.argv[3]??required('REPAID_BACKUP_INPUT'),key);
 else if(action==='copy')result=await copyRecoverySet(process.argv[3]??required('REPAID_BACKUP_INPUT'),process.argv[4]??required('REPAID_BACKUP_OUTPUT'),key);
 else if(action==='restore')result=await restoreRecoverySet(process.argv[3]??required('REPAID_BACKUP_INPUT'),process.argv[4]??required('REPAID_RESTORE_OUTPUT'),key,process.argv[5]??required('REPAID_RECOVERY_REASON'));
 else if(action==='check')result=await checkScheduledRecovery({directory:required('REPAID_BACKUP_DIR'),key,copyDirectory:process.env.REPAID_BACKUP_COPY_DIR,maxAgeSeconds:process.env.REPAID_BACKUP_MAX_AGE_SECONDS===undefined?undefined:Number(process.env.REPAID_BACKUP_MAX_AGE_SECONDS)});
 else if(action==='snapshot'){const {DatabaseSync}=await import('node:sqlite'),output=process.argv[4]??required('REPAID_BACKUP_OUTPUT'),source=process.argv[3]??required('REPAID_SQLITE_SOURCE'),db=new DatabaseSync(source,{readOnly:true});try{result=await createRecoverySet(db,output,key);}finally{db.close();}}
 else if(action==='create'){const output=required('REPAID_BACKUP_OUTPUT'),{getDb,DB_PATH}=await import('../src/lib/db/schema');requireDatabaseSource(DB_PATH);const db=getDb();try{result=await withBackupPreparation(db,null,()=>createRecoverySet(db,output,key));}finally{db.close();}}
 else throw Error('Use create, snapshot, verify, copy, restore or check');
 console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Recovery set operation failed; no production activation or recovery success is claimed. Check private configuration, age, space, authentication and referenced object integrity.');process.exitCode=1;});
