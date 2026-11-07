import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

let windowsSid:string|undefined;
/** Directory durability is supported on POSIX; Windows may reject opening a
 * directory handle through Node. Report that limitation rather than invent it. */
export function syncPrivateDirectory(directory:string){
 let file:number|undefined;try{file=fs.openSync(directory,'r');fs.fsyncSync(file);return true;}
 catch(error){if(process.platform!=='win32'||!['EPERM','EISDIR','EINVAL','EBADF'].includes(String((error as NodeJS.ErrnoException).code)))throw error;return false;}
 finally{if(file!==undefined)fs.closeSync(file);}
}
/** Only application-owned private artifacts. Call before writing any sensitive
 * bytes: POSIX mode bits alone do not restrict inherited Windows permissions.
 * Windows keeps the service identity, SYSTEM and local Administrators. */
export function protectPrivateStorage(filename:string,kind:'file'|'directory'){
 const before=fs.lstatSync(filename,{bigint:true});
 if(before.isSymbolicLink()||(kind==='file'?!before.isFile():!before.isDirectory()))throw Error('Private storage requires an ordinary owned file or directory');
 if(process.platform==='win32'){
  try{
   if(!windowsSid){const output=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});const matches=output.match(/S-1-\d+(?:-\d+)+/g);if(matches?.length!==1)throw Error('Unknown service identity');windowsSid=matches[0];}
   const options={windowsHide:true,timeout:10000,stdio:'pipe' as const};
   // Reset removes any explicit grants. The artifact must still be empty on
   // creation; subsequent restriction removes inherited grants before writes.
   execFileSync('icacls.exe',[filename,'/reset','/L','/Q'],options);
   const rights=kind==='directory'?'(OI)(CI)(F)':'(F)';
   execFileSync('icacls.exe',[filename,'/inheritance:r','/grant:r',`*${windowsSid}:${rights}`,`*S-1-5-18:${rights}`,`*S-1-5-32-544:${rights}`,'/L','/Q'],options);
  }catch{throw Error('Private storage permissions could not be enforced');}
 }else fs.chmodSync(filename,kind==='directory'?0o700:0o600);
 const after=fs.lstatSync(filename,{bigint:true});
 if(after.isSymbolicLink()||after.ino!==before.ino||after.dev!==before.dev)throw Error('Private storage identity changed during permission setup');
}

export function openPrivateFile(filename:string){
 const file=fs.openSync(filename,'wx',0o600);
 try{protectPrivateStorage(filename,'file');return file;}
 catch(error){fs.closeSync(file);fs.rmSync(filename,{force:true});throw error;}
}

/** Asynchronous uploads also need Windows ACLs before the first plaintext byte. */
export async function openPrivateFileHandle(filename:string){
 const handle=await fs.promises.open(filename,'wx',0o600);
 try{protectPrivateStorage(filename,'file');return handle;}
 catch(error){await handle.close();await fs.promises.rm(filename,{force:true});throw error;}
}

/** Let pipeline own descriptor closure, including authentication/read failures. */
export function createPrivateWriteStream(filename:string){
 const file=openPrivateFile(filename);
 try{return fs.createWriteStream(filename,{fd:file,autoClose:true});}
 catch(error){fs.closeSync(file);throw error;}
}
