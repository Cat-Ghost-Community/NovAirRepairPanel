import crypto from 'node:crypto';
import {HttpError} from './http-error';

let activeHashes=0;
const waitingHashes:Array<()=>void>=[];

/** Shared bounded credential work; passwords never enter arguments or logs. */
export async function deriveLoginHash(password:string,salt:string,modern:boolean):Promise<Buffer>{
 if(activeHashes>=2){
  if(waitingHashes.length>=32)throw new HttpError(429,'سامانه مشغول است. کمی بعد دوباره تلاش کنید.');
  await new Promise<void>(resolve=>waitingHashes.push(resolve));
 }else activeHashes++;
 try{return await new Promise<Buffer>((resolve,reject)=>{
  crypto.scrypt(password,salt,32,{N:modern?32768:16384,maxmem:64*1024*1024},(error,result)=>error?reject(error):resolve(result));
 });}finally{const next=waitingHashes.shift();if(next)next();else activeHashes--;}
}

export async function hashLoginPassword(password:string):Promise<string>{
 const salt=crypto.randomBytes(16).toString('hex');
 return `scrypt$${salt}$${(await deriveLoginHash(password,salt,true)).toString('hex')}`;
}
