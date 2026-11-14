import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {isSameOriginMutation} from '../request-security';
import {readRequestJson} from '../request-json';
import {attachmentBody} from '../attachment-storage';
import {matchesContentType} from '../upload-content';
import {isImageMime} from '../chat-shared';
import {readyApplicationPostgres} from './pg-application';
import {postgresFailure} from './pg-http';
import {PostgresChat,chatId} from './pg-chat';
import {requirePostgresIdentity} from './pg-app-auth';
type Endpoint='conversations'|'conversation'|'messages'|'message'|'summary'|'events'|'search'|'users'|'upload'|'attachment';
function page(value:string|null,fallback=1){if(value==null||value==='')return fallback;const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0||parsed>1000000000)throw new HttpError(400,'پارامتر عددی معتبر نیست.');return parsed;}
async function boundedForm(req:NextRequest){if(!req.body)throw new HttpError(400,'فایلی ارسال نشده است.');const reader=req.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;try{while(true){const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;if(bytes>52*1024*1024){await reader.cancel();throw new HttpError(413,'حجم درخواست بیش از حد مجاز است.');}chunks.push(result.value);}return new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers.get('content-type')??''}}).formData();}finally{reader.releaseLock();}}
export async function postgresChatHttp(req:NextRequest,endpoint:Endpoint,id?:number){try{
 if(!isSameOriginMutation(req))throw new HttpError(403,'منبع درخواست مجاز نیست.');const {database,schema}=await readyApplicationPostgres(),token=req.cookies.get('repaid_session')?.value,chat=new PostgresChat(database,schema),query=req.nextUrl.searchParams,key=req.headers.get('idempotency-key'),number=(name:string)=>query.has(name)?chatId(Number(query.get(name))):undefined,reply=(value:unknown)=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
 await requirePostgresIdentity(database,schema,token,'chat.view');
 if(req.method==='GET'||req.method==='HEAD'){
  if(endpoint==='conversations')return reply(await chat.list(token,{filter:query.get('filter')??'all',q:query.get('q')??'',page:page(query.get('page')),limit:query.has('limit')?page(query.get('limit')):200}));
  if(endpoint==='conversation')return reply(await chat.details(token,chatId(id)));
  if(endpoint==='messages')return reply(await chat.fetch(token,chatId(id),{before_id:number('before_id'),after_id:number('after_id'),around_id:number('around_id'),limit:query.has('limit')?page(query.get('limit')):50}));
  if(endpoint==='message')return reply(await chat.message(token,chatId(id)));
  if(endpoint==='summary')return reply(await chat.summary(token));
  if(endpoint==='users')return reply(await chat.users(token,query.get('q')??'',page(query.get('page'))));
  if(endpoint==='events')return reply(await chat.events(token,page(query.get('cursor'),0),number('active'),query.get('bootstrap')==='1'));
  if(endpoint==='search')return reply(await chat.search(token,{q:query.get('q')??'',conversation_id:number('conversation_id'),from:number('from'),before_id:number('before_id'),has_file:query.get('has_file')==='1',has_mention:query.get('has_mention')==='1',limit:query.has('limit')?page(query.get('limit')):25}));
  if(endpoint==='attachment'){const row=await chat.attachment(token,chatId(id)),stored=await attachmentBody(row,req.signal),mime=String(row.mime||'application/octet-stream'),inline=(isImageMime(mime)||mime==='application/pdf')&&matchesContentType(stored.prefix,mime),name=String(row.filename??'file').replace(/[\r\n"\\]/g,'_');return new Response(stored.body,{headers:{'Content-Type':mime,'Content-Length':String(stored.bytes),'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});}
 }
 if(req.method==='POST'){
  if(endpoint==='upload'){await requirePostgresIdentity(database,schema,token,'chat.files');if(!key)throw new HttpError(400,'شناسه پایدار بارگذاری لازم است.');const form=await boundedForm(req),file=form.get('file');if(!(file instanceof File)||file.size>50*1024*1024)throw new HttpError(400,'فایل معتبر با حجم مجاز انتخاب کنید.');return reply(await chat.upload(token,{name:file.name,mime:file.type,data:Buffer.from(await file.arrayBuffer())},key));}
  const body=await readRequestJson(req);if(!(endpoint==='conversation'&&['read','typing'].includes(String(body.action)))&&!key&&!(endpoint==='messages'&&typeof body.client_key==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(body.client_key)))throw new HttpError(400,'شناسه پایدار درخواست برای این تغییر لازم است.');if(endpoint==='conversations')return reply(await chat.create(token,body,key));if(endpoint==='conversation')return reply(await chat.command(token,chatId(id),body,key));if(endpoint==='messages')return reply(await chat.send(token,chatId(id),body,key));if(endpoint==='message')return reply(await chat.message(token,chatId(id),body,key));
 }
 throw new HttpError(405,'روش درخواست پشتیبانی نمی‌شود.');
}catch(error){return postgresFailure(error);}}
