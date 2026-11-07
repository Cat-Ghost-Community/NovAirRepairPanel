import type {NextRequest} from 'next/server';
import {HttpError} from './http-error';
import {isSameOriginMutation} from './request-security';

/** Shared bounded parser only; authentication and domain checks belong to the
 * selected persistence service. This module never imports a database driver. */
export async function readRequestJson(req:NextRequest):Promise<Record<string,unknown>>{
 if(!isSameOriginMutation(req))throw new HttpError(403,'درخواست از منبع غیرمجاز رد شد.');
 const maximum=1024*1024;if(Number(req.headers.get('content-length'))>maximum)throw new HttpError(413,'حجم درخواست بیش از حد مجاز است.');
 const reader=req.body?.getReader();if(!reader)throw new HttpError(400,'بدنه درخواست خالی است.');let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new HttpError(413,'حجم درخواست بیش از حد مجاز است.');}chunks.push(value);}
  const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'ساختار درخواست معتبر نیست.');return body as Record<string,unknown>;
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'درخواست قابل خواندن نیست. لطفاً صفحه را تازه‌سازی و دوباره تلاش کنید.');}finally{reader.releaseLock();}
}
