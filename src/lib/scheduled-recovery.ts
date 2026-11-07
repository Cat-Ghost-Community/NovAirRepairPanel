import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {createRecoverySet,copyRecoverySet,verifyRecoverySet} from './recovery-set';
import {withBackupPreparation} from './backup-admission';
import {openPrivateFile,syncPrivateDirectory} from './private-storage';

/** Latest-success changes only after a complete set and configured second copy
 * have independently verified. A failed job cannot make an old backup fresh. */
export async function scheduledRecovery(db:DatabaseSync,input:{directory:string;key:string;copyDirectory?:string}){
 const directory=fs.realpathSync(input.directory),copyDirectory=input.copyDirectory?fs.realpathSync(input.copyDirectory):undefined;
 if(copyDirectory===directory)throw Error('A second backup location must differ from the local backup directory');
 const basename='repaid-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(6).toString('hex')+'.rpset';
 return withBackupPreparation(db,null,async()=>{
  const result=await createRecoverySet(db,path.join(directory,basename),input.key);
  const copied=copyDirectory?await copyRecoverySet(path.join(directory,basename),path.join(copyDirectory,basename),input.key):null;
  const status={status:'verified_local_recovery_set',filename:basename,...result,verified_at:new Date().toISOString(),second_copy_verified:copied?.destination_verified===true,second_copy_manifest_sha256:copied?.manifest_sha256??null,physical_offhost_verified:false};
  const marker=path.join(directory,'.status-'+randomBytes(8).toString('hex')),file=openPrivateFile(marker);
  try{try{fs.writeFileSync(file,JSON.stringify(status,null,2)+'\n');fs.fsyncSync(file);}finally{fs.closeSync(file);}fs.renameSync(marker,path.join(directory,'latest-backup.json'));}
  finally{fs.rmSync(marker,{force:true});}
  return {...status,latest_record_directory_synced:syncPrivateDirectory(directory)};
 });
}

export async function checkScheduledRecovery(input:{directory:string;key:string;copyDirectory?:string;maxAgeSeconds?:number;now?:number}){
 const maximum=input.maxAgeSeconds??7200,now=input.now??Date.now();
 if(!Number.isSafeInteger(maximum)||maximum<60||maximum>2678400||!Number.isSafeInteger(now))throw Error('Invalid recovery freshness boundary');
 const directory=fs.realpathSync(input.directory),filename=path.join(directory,'latest-backup.json'),stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Invalid latest-backup record');
 const status=JSON.parse(fs.readFileSync(filename,'utf8')) as {status:string;filename:string;manifest_sha256:string};
 if(status.status!=='verified_local_recovery_set'||typeof status.filename!=='string'||!/^repaid-[0-9TZ-]+-[a-f0-9]{12}\.rpset$/.test(status.filename))throw Error('Latest record is not a complete recovery set; retain legacy archives and create a current set');
 const verified=await verifyRecoverySet(path.join(directory,status.filename),input.key),age=(now-Date.parse(verified.created_at))/1000;
 if(status.manifest_sha256!==verified.manifest_sha256)throw Error('Latest backup source identity mismatch');
 if(age < -300||age>maximum)throw Error('Verified recovery set is stale or the host clock is inconsistent');
 let secondCopyVerified=false;
 if(input.copyDirectory){const copyDirectory=fs.realpathSync(input.copyDirectory);if(copyDirectory===directory)throw Error('A second backup location must differ from the local backup directory');const second=await verifyRecoverySet(path.join(copyDirectory,status.filename),input.key);if(second.manifest_sha256!==verified.manifest_sha256)throw Error('Second backup location has a different source');secondCopyVerified=true;}
 return {...verified,status:'fresh_verified_recovery_set',age_seconds:Math.max(0,Math.floor(age)),max_age_seconds:maximum,second_copy_verified:secondCopyVerified,physical_offhost_verified:false};
}
