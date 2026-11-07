'use client';
const pending=new Map<string,string>();
/** Persist only a digest and nonce; uncertain server outcomes retain their identity. */
export async function appointmentRequest<T>(url:string,method:string,body:unknown={}){
 const payload=JSON.stringify(body),bytes=new TextEncoder().encode(method+'\n'+url+'\n'+payload),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''),storage='repaid.appointment.pending.'+digest;
 let key=pending.get(storage);try{key=key??sessionStorage.getItem(storage)??undefined;}catch{/* In-memory retry remains available. */}key=key??crypto.randomUUID();pending.set(storage,key);try{sessionStorage.setItem(storage,key);}catch{/* No personal data is persisted. */}
 const response=await fetch(url,{method,headers:{'content-type':'application/json','idempotency-key':key},body:payload}),result=await response.json();
 if(!response.ok)throw new Error(result?.error??'عملیات انجام نشد؛ دوباره تلاش کنید.');
 pending.delete(storage);try{sessionStorage.removeItem(storage);}catch{/* Confirmed result is already retired in memory. */}return result as T;
}
