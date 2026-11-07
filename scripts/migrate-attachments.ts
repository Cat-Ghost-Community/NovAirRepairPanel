import fs from 'node:fs';
import {migrateAttachmentCopy} from '../src/lib/attachment-migration';
import {protectedBackupPath} from '../src/lib/backup-archive';
async function main(){
 const source=process.env.REPAID_ATTACHMENT_MIGRATION_SOURCE,destination=process.env.REPAID_ATTACHMENT_MIGRATION_OUTPUT,report=process.env.REPAID_ATTACHMENT_MIGRATION_REPORT;
 if(!source||!destination||!report)throw new Error('Source, new private copy and new private evidence report are required');
 // Reserve evidence before changing the isolated copy. Never overwrite a retained report.
 const handle=fs.openSync(protectedBackupPath(report),'wx',0o600);
 try{const result=await migrateAttachmentCopy({source,destination,resume:process.env.REPAID_ATTACHMENT_MIGRATION_RESUME==='1',retainBlobs:process.env.REPAID_ATTACHMENT_RETAIN_BLOBS==='1'});fs.writeFileSync(handle,JSON.stringify(result,null,2));fs.fsyncSync(handle);console.log(JSON.stringify(result));}
 catch(error){fs.writeFileSync(handle,JSON.stringify({status:'incomplete',production_swapped:false,error_code:(error as NodeJS.ErrnoException).code??'MIGRATION_FAILED'}));fs.fsyncSync(handle);throw error;}
 finally{fs.closeSync(handle);}
}
main().catch(()=>{console.error('Attachment COPY migration failed. Original data was not replaced. Retain evidence and inspect the isolated copy before an explicit resume.');process.exitCode=1;});
