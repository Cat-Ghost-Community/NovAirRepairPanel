import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import type {PostgresDatabase} from '../src/lib/db/postgres';
import {postgresRelation} from '../src/lib/db/postgres-auth';
type Request=(route:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<Response>;

export async function postgresChatHttpAcceptance(context:{db:PostgresDatabase;schema:string;request:Request;owner:string;one:string;two:string;oneId:number;twoId:number;check:(message:string)=>void}){
 const {db,schema,request,owner,one,two,oneId,twoId,check}=context,t=(name:string)=>postgresRelation(schema,name);
 const post=async(path:string,body:unknown,cookie:string,key:string)=>{const response=await request(path,'POST',body,cookie,key);assert.equal(response.status,200,path+': '+await response.clone().text());return response.json();};
 const body={type:'direct',user_id:oneId},key='chat-http-internal-direct';
 const replies=await Promise.all([request('/api/chat/conversations','POST',body,owner,key),request('/api/chat/conversations','POST',body,owner,key)]);for(const response of replies)assert.equal(response.status,200,await response.clone().text());
 const saved=await replies[0].json();assert.deepEqual(await replies[1].json(),saved);assert.equal(typeof saved.id,'number');
 assert.equal((await request('/api/chat/conversations','POST',{type:'direct',user_id:twoId},owner,key)).status,409);
 assert.equal((await request('/api/chat/conversations','POST',{type:'direct',user_id:twoId},one,'chat-http-crossbranch-direct')).status,403);
 assert.equal((await request('/api/chat/conversations','POST',{type:'direct',user_id:oneId,customer_id:1},owner,'chat-http-customer-denied')).status,410);
 const persisted=(await db.query(`SELECT branch_id,entity_type,entity_id FROM ${t('chat_conversations')} WHERE id=$1`,[saved.id])).rows[0];assert.equal(persisted.branch_id,'1');assert.equal(persisted.entity_type,null);assert.equal(persisted.entity_id,null);
 const members=(await db.query(`SELECT COUNT(*) n FROM ${t('chat_members')} WHERE conversation_id=$1 AND left_at IS NULL`,[saved.id])).rows[0].n;assert.equal(members,'2');
 check('native chat HTTP creates one persistent staff-only direct conversation across concurrent retry and rejects customer linkage/crossbranch peers');
 const path='/api/chat/conversations/'+saved.id+'/messages',message={body:'پیام داخلی تأییدشده از مسیر HTTP',client_key:'chat-http-message-client'};
 const sent=await post(path,message,one,'chat-http-message-operation'),again=await post(path,message,one,'chat-http-message-operation');assert.equal(sent.message.id,again.message.id);
 assert.equal((await request(path,'POST',{...message,body:'Changed payload'},one,'chat-http-message-operation')).status,409);
 assert.equal((await request(path,'GET',undefined,two)).status,404);assert.equal((await request(path,'POST',{body:'Forbidden branch'},two,'chat-http-forbidden-message')).status,404);
 const read=await request(path,'GET',undefined,owner);assert.equal(read.status,200);assert.ok((await read.json()).messages.some((row:{id:number;body:string})=>row.id===sent.message.id&&row.body===message.body));
 const counts=(await db.query(`SELECT COUNT(*) n FROM ${t('chat_messages')} WHERE conversation_id=$1 AND client_key=$2`,[saved.id,message.client_key])).rows[0].n;assert.equal(counts,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='chat_message' AND entity_id=$1 AND action='create'`,[sent.message.id])).rows[0].n,'1');
 const event=(await db.query(`SELECT COUNT(*) n FROM ${t('chat_events')} WHERE conversation_id=$1 AND type='message_new'`,[saved.id])).rows[0].n;assert.equal(event,'1');
 const summary=await request('/api/chat/summary','GET',undefined,one);assert.equal(summary.status,200);
 check('native chat HTTP persists one exact message/audit/event across replay, scopes message reads/writes and confirms internal summary');
 return {conversationId:Number(saved.id),messageId:Number(sent.message.id)};
}

export async function postgresChatBrowserAcceptance(context:{page:Page;db:PostgresDatabase;schema:string;origin:string;conversationId:number;check:(message:string)=>void}){
 const {page,db,schema,origin,conversationId,check}=context,t=(name:string)=>postgresRelation(schema,name),route='/chat?c='+conversationId;
 await page.goto(origin+route);const composer=page.getByRole('textbox',{name:'متن پیام',exact:true});await composer.waitFor();
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 for(const width of [320,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:width===320?812:1000});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Chat viewport overflow: '+width+' dark='+dark);}
 const body='پیام واقعی مرورگر با تأیید ذخیره‌سازی PostgreSQL';await composer.fill(body);
 const pending=page.waitForResponse(response=>response.url().includes('/api/chat/conversations/'+conversationId+'/messages')&&response.request().method()==='POST');
 await page.getByRole('button',{name:'ارسال پیام',exact:true}).click();const response=await pending;assert.equal(response.status(),200);const sent=await response.json();assert.equal(sent.message.body,body);
 await page.getByText(body,{exact:true}).first().waitFor();await page.waitForFunction(()=>{const textarea=document.querySelector('textarea[aria-label="متن پیام"]');return textarea instanceof HTMLTextAreaElement&&textarea.value==='';});
 assert.equal((await db.query(`SELECT body FROM ${t('chat_messages')} WHERE id=$1 AND conversation_id=$2`,[sent.message.id,conversationId])).rows[0].body,body);
 check('real native Persian RTL chat page loads without SQLite SSR; 320/1440 light/dark viewport and server-confirmed message persisted');
 const file=page.locator('input[type="file"][accept*=".txt"]');
 await file.setInputFiles({name:'internal-chat-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('Internal PostgreSQL chat attachment evidence')});
 await page.getByText('internal-chat-evidence.txt',{exact:true}).first().waitFor();
 const attachmentMessage='پیوست داخلی تأییدشده';await composer.fill(attachmentMessage);
 const uploaded=page.waitForResponse(result=>result.url().includes('/api/chat/conversations/'+conversationId+'/messages')&&result.request().method()==='POST');
 await page.getByRole('button',{name:'ارسال پیام',exact:true}).click();const uploadResponse=await uploaded;assert.equal(uploadResponse.status(),200);const uploadData=await uploadResponse.json();
 const stored=(await db.query(`SELECT id,size,filename FROM ${t('chat_attachments')} WHERE message_id=$1`,[uploadData.message.id])).rows;assert.equal(stored.length,1);assert.equal(stored[0].filename,'internal-chat-evidence.txt');assert.equal(stored[0].size,String(Buffer.byteLength('Internal PostgreSQL chat attachment evidence')));
 const attachment=await page.request.get(origin+'/api/chat/attachments/'+stored[0].id);assert.equal(attachment.status(),200);assert.equal((await attachment.body()).toString(),'Internal PostgreSQL chat attachment evidence');
 check('real chat browser uploads a staff attachment, binds it to the confirmed persisted message and downloads exact authenticated bytes');
}
