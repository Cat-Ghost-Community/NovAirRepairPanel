import {restoreEncryptedBackup} from '../src/lib/backup-archive';
async function main(){const source=process.env.REPAID_BACKUP_INPUT,target=process.env.REPAID_RESTORE_OUTPUT,key=process.env.REPAID_BACKUP_KEY;if(!source||!target||!key)throw new Error('Explicit source, new restore target and private backup key required');
 console.log(JSON.stringify(await restoreEncryptedBackup(source,target,key)));}
main().catch(()=>{console.error('Restore rejected or failed; no existing database was overwritten.');process.exitCode=1;});
