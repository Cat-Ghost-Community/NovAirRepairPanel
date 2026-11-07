import {it} from 'node:test';
import assert from 'node:assert/strict';
import {chatFetch} from '../src/app/chat/chat-helpers';

it('preserves one message/command identity through uncertain retries, but renews it after confirmed success',async()=>{
 const original=globalThis.fetch,calls:Array<{url:string;key:string|null;body:Record<string,unknown>}>=[];let behavior:'fail'|'ok'|'invalid'='fail';
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),key:new Headers(init?.headers).get('idempotency-key'),body:JSON.parse(String(init?.body)) as Record<string,unknown>});if(behavior==='fail')throw Error('Synthetic interrupted response');return behavior==='invalid'?new Response('not json',{status:200}):Response.json({ok:true});};
 try{
  const url='/api/chat/conversations/123/messages',send=(client_key:string)=>chatFetch(url,{method:'POST',body:JSON.stringify({body:'Actual retry payload',client_key})});await assert.rejects(()=>send('provisional_first'));behavior='invalid';await assert.rejects(()=>send('provisional_second'));behavior='ok';await send('provisional_third');assert.equal(calls[0].key,calls[1].key);assert.equal(calls[1].key,calls[2].key);assert.equal(calls[0].body.client_key,calls[0].key);assert.deepEqual(calls[0].body,calls[2].body);await send('new_user_send');assert.notEqual(calls[2].key,calls[3].key);
  behavior='fail';const command=()=>chatFetch('/api/chat/messages/321',{method:'POST',body:JSON.stringify({action:'react',emoji:'👍'})});await assert.rejects(command);behavior='ok';await command();assert.equal(calls[4].key,calls[5].key);await command();assert.notEqual(calls[5].key,calls[6].key);
 }finally{globalThis.fetch=original;}
});
