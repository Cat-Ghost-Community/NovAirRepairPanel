import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';import {pathToFileURL} from 'node:url';
import {requireStorageSpace} from './storage-budget';
import {openPrivateFileHandle} from './private-storage';
export type StoredObject={object_key:string;object_sha256:string;size:number};
function root(override?:string){const configured=override??process.env.REPAID_OBJECT_DIR;if(!configured)throw new Error('Private attachment object directory is not configured');const directory=fs.realpathSync(configured),publicRoot=fs.realpathSync('public');
 if(directory===publicRoot||directory.startsWith(publicRoot+path.sep))throw new Error('Attachment objects cannot be stored under public');return directory;}
function filename(key:string,override?:string){if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid attachment object identity');const directory=root(override),prefix=path.join(directory,key.slice(0,2));
 if(fs.existsSync(prefix)&&fs.lstatSync(prefix).isSymbolicLink())throw new Error('Attachment directory symlinks are not allowed');return path.join(prefix,key);}
async function verifiedHandle(object:StoredObject,override?:string){
 if(object.object_sha256!==object.object_key||!Number.isSafeInteger(object.size)||object.size<0)throw new Error('Invalid attachment metadata');const file=filename(object.object_key,override),stat=await fs.promises.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==object.size)throw new Error('Attachment object is missing or corrupt');const handle=await fs.promises.open(file,'r');
 try{const digest=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false,start:0}))digest.update(chunk);if(digest.digest('hex')!==object.object_sha256)throw new Error('Attachment checksum mismatch');return handle;}catch(error){await handle.close();throw error;}
}
export async function storeAttachmentObject(data:Buffer):Promise<StoredObject|null>{
 const mode=process.env.REPAID_ATTACHMENT_STORAGE??'database';if(mode==='database')return null;if(mode!=='filesystem')throw new Error('Unsupported attachment storage mode');
 return storeAttachmentStream((async function*(){yield data;})(),data.length);
}
/** Bounded migration/ingest path; publication follows exact size/hash verification. */
export async function storeAttachmentStream(chunks:AsyncIterable<Uint8Array>,expectedBytes:number):Promise<StoredObject>{
 if(process.env.REPAID_ATTACHMENT_STORAGE!=='filesystem')throw new Error('Private filesystem attachment storage must be explicitly enabled');
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0)throw new Error('Invalid attachment stream size');
 requireStorageSpace(root(),BigInt(expectedBytes),'REPAID_OBJECT_MIN_FREE_BYTES');
 const staging=path.join(root(),'.upload-'+randomBytes(12).toString('hex'));let bytes=0;const digest=createHash('sha256');
 try{
  const handle=await openPrivateFileHandle(staging);
  try{for await(const chunk of chunks){if(!(chunk instanceof Uint8Array)||bytes+chunk.byteLength>expectedBytes)throw new Error('Attachment stream exceeds declared size');
    digest.update(chunk);let offset=0;while(offset<chunk.byteLength){const result=await handle.write(chunk,offset,chunk.byteLength-offset);if(!result.bytesWritten)throw new Error('Attachment write made no progress');offset+=result.bytesWritten;}bytes+=chunk.byteLength;
   }if(bytes!==expectedBytes)throw new Error('Attachment stream was truncated');await handle.sync();
  }finally{await handle.close();}
  const sha=digest.digest('hex'),object={object_key:sha,object_sha256:sha,size:bytes},target=filename(sha),directory=path.dirname(target);
  await fs.promises.mkdir(directory,{recursive:true,mode:0o700});if(fs.lstatSync(directory).isSymbolicLink())throw new Error('Unsafe attachment prefix');
  try{await fs.promises.link(staging,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  await verifyStoredAttachment(object);return object;
 }finally{await fs.promises.rm(staging,{force:true});}
}
export async function verifyStoredAttachment(object:StoredObject){const handle=await verifiedHandle(object);await handle.close();}
/** Internal backup path: identity and bytes checked before archiving; not an HTTP path. */
export async function verifiedAttachmentFilename(object:StoredObject,override?:string){const handle=await verifiedHandle(object,override);await handle.close();return filename(object.object_key,override);}
export async function attachmentBody(row:{data?:Uint8Array;size:number;object_key?:string|null;object_sha256?:string|null},signal?:AbortSignal){
 if(!row.object_key){const data=new Uint8Array(row.data??[]);return {body:data as BodyInit,prefix:data.subarray(0,512),bytes:data.byteLength};}
 const handle=await verifiedHandle({object_key:row.object_key,object_sha256:row.object_sha256??'',size:Number(row.size)});
 try{const prefix=Buffer.alloc(Math.min(512,Number(row.size)));await handle.read(prefix,0,prefix.length,0);const file=handle.createReadStream({start:0}),abort=()=>file.destroy();signal?.addEventListener('abort',abort,{once:true});file.once('close',()=>signal?.removeEventListener('abort',abort));if(signal?.aborted)file.destroy();
  return {body:Readable.toWeb(file,{strategy:{highWaterMark:65536,size:(chunk:Uint8Array)=>chunk.byteLength}}) as ReadableStream<Uint8Array>,prefix,bytes:Number(row.size)};
 }catch(error){await handle.close();throw error;}
}
/** DB backups are not complete when their referenced private objects are absent.
 * Objects are immutable; retention must include objects referenced by every retained backup. */
export async function verifySnapshotAttachments(snapshot:string,objectDirectory?:string){
 const db=new DatabaseSync(pathToFileURL(path.resolve(snapshot)).href+'?mode=ro&immutable=1',{readOnly:true});let objects=0;
 try{for(const table of ['repair_attachments','chat_attachments']){
  const columns=db.prepare(`PRAGMA table_info(${table})`).all();if(!columns.some(column=>column.name==='object_key'))continue;
  for(const row of db.prepare(`SELECT object_key,object_sha256,size FROM ${table} WHERE object_key IS NOT NULL`).iterate()){
   const handle=await verifiedHandle({object_key:String(row.object_key),object_sha256:String(row.object_sha256),size:Number(row.size)},objectDirectory);await handle.close();objects++;
  }
 }return objects;}finally{db.close();}
}
