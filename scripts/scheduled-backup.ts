import fs from 'node:fs';import {getDb,DB_PATH} from '../src/lib/db/schema';
import {scheduledRecovery} from '../src/lib/scheduled-recovery';
import {backupWorkDirectory} from '../src/lib/backup';
import {requireDatabaseSource} from './database-source';
async function main(){const configured=process.env.REPAID_BACKUP_DIR,key=process.env.REPAID_BACKUP_KEY;if(!configured||!key||!/^[a-fA-F0-9]{64}$/.test(key))throw new Error('Private backup directory and separate 32-byte encryption key required');
 const directory=fs.realpathSync(configured),reserveText=process.env.REPAID_BACKUP_MIN_FREE_BYTES??'5368709120';if(!/^\d+$/.test(reserveText))throw new Error('Invalid backup disk reserve');
 const reserve=BigInt(reserveText),sourceBytes=BigInt(requireDatabaseSource(DB_PATH).size);for(const location of [directory,backupWorkDirectory()]){const disk=fs.statfsSync(location,{bigint:true});if(disk.bavail*disk.bsize<reserve+sourceBytes)throw new Error('Insufficient free space for a verified backup');}
 const db=getDb();
 try{console.log(JSON.stringify(await scheduledRecovery(db,{directory,key,copyDirectory:process.env.REPAID_BACKUP_COPY_DIR})));
 }finally{db.close();}}
main().catch(()=>{console.error('Scheduled encrypted backup failed; no recovery success is claimed. Inspect configuration, disk reserve and storage integrity.');process.exitCode=1;});
