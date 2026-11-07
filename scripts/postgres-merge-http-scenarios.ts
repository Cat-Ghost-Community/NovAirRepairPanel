import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import type {PostgresDatabase} from '../src/lib/db/postgres';
import {postgresRelation} from '../src/lib/db/postgres-auth';
type Request=(route:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<Response>;
type Context={db:PostgresDatabase;schema:string;request:Request;owner:string;one:string;two:string;customer:number;check:(message:string)=>void};
export async function postgresMergeHttpAcceptance({db,schema,request,owner,two,customer,check}:Context){
 const t=(name:string)=>postgresRelation(schema,name);
 const command=async(route:string,body:unknown,key:string)=>{const response=await request(route,'POST',body,owner,key);assert.equal(response.status,200,route+': '+await response.clone().text());return response.json();};
 const source=await command('/api/customers',{first_name:'HTTP merge duplicate'},'merge-http-source'),browser=await command('/api/customers',{first_name:'Browser merge duplicate'},'merge-browser-source');
 const device=await command('/api/devices',{customer_id:source.id,type:'mobile',serial:'MERGE-HTTP-ONLY'},'merge-http-device');
 const before=new Map<string,Record<string,unknown>[]>();for(const name of ['invoices','payments','accounting_events','accounting_journals','accounting_lines'])before.set(name,(await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows);
 const events=(await db.query(`SELECT * FROM ${t('customer_events')} WHERE customer_id=$1 ORDER BY id`,[source.id])).rows;
 assert.equal((await request('/api/customers/'+source.id,'POST',{action:'merge_into',target_id:customer},two,'merge-http-foreign')).status,404);
 const payload={action:'merge_into',target_id:customer},responses=await Promise.all(Array.from({length:4},()=>request('/api/customers/'+source.id,'POST',payload,owner,'merge-http-commit')));
 for(const response of responses)assert.equal(response.status,200,await response.clone().text());const saved=await responses[0].json();for(const response of responses.slice(1))assert.deepEqual(await response.json(),saved);
 assert.equal(saved.target,customer);assert.equal(saved.moved_devices,1);assert.equal((await db.query(`SELECT is_archived FROM ${t('customers')} WHERE id=$1`,[source.id])).rows[0].is_archived,'1');assert.equal((await db.query(`SELECT customer_id FROM ${t('devices')} WHERE id=$1`,[device.id])).rows[0].customer_id,String(customer));
 for(const [name,rows]of before)assert.deepEqual((await db.query(`SELECT * FROM ${t(name)} ORDER BY id`)).rows,rows);
 assert.deepEqual((await db.query(`SELECT * FROM ${t('customer_events')} WHERE customer_id=$1 ORDER BY id`,[source.id])).rows,events);
 assert.equal((await request('/api/customers/'+source.id,'POST',{action:'merge_into',target_id:browser.id},owner,'merge-http-commit')).status,409);
 const historyResponse=await request('/api/customers/'+customer+'?view=merge_history','GET',undefined,owner);assert.equal(historyResponse.status,200);const history=await historyResponse.json();assert.ok(history.merges.some((row:{merged_id:number})=>row.merged_id===source.id));assert.equal(history.events.filter((row:{customer_id:string})=>row.customer_id===String(source.id)).length,events.length);
 assert.equal((await request('/api/customers/'+customer+'?view=merge_history','GET',undefined,two)).status,404);
 check('actual customer merge HTTP preserves original finance/events, moves only proven devices, binds replay payload and denies foreign history');
 const blocked=await request('/api/customers/'+customer,'POST',{action:'merge_into',target_id:browser.id},owner,'merge-http-financial-block');assert.equal(blocked.status,409,'Established financial source must never be relinked');
 const forged=await request('/api/customers/'+browser.id,'POST',{action:'merge_into',target_id:customer,branch_id:2},owner,'merge-http-forged');assert.equal(forged.status,400);
 const unowned=await request('/api/devices','POST',{customer_id:source.id,type:'other'},owner,'merge-http-source-device');assert.ok(unowned.status>=400);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')} WHERE customer_id=$1`,[source.id])).rows[0].n,'0');
 check('actual customer merge rejects source financial ownership, forged fields and new references to merged aliases');
 return {browserSourceId:Number(browser.id),targetId:customer};
}

export async function postgresMergeBrowserAcceptance({page,db,schema,origin,browserSourceId,targetId,check}:{page:Page;db:PostgresDatabase;schema:string;origin:string;browserSourceId:number;targetId:number;check:(message:string)=>void}){
 const t=(name:string)=>postgresRelation(schema,name);
 await page.goto(origin+'/customers/'+browserSourceId);await page.getByRole('button',{name:'ویرایش مشخصات',exact:true}).click();await page.getByLabel('توضیحات',{exact:true}).fill('Browser persisted profile correction');
 for(const width of [320,375,768,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:width<768?812:1000});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Edit modal viewport overflow: '+width);}
 const edited=page.waitForResponse(response=>response.url().includes('/api/customers/'+browserSourceId)&&response.request().method()==='POST');await page.getByRole('button',{name:'ذخیره مشخصات',exact:true}).click();assert.equal((await edited).status(),200);await page.getByText('Browser persisted profile correction',{exact:true}).waitFor();
 assert.equal((await db.query(`SELECT notes FROM ${t('customers')} WHERE id=$1`,[browserSourceId])).rows[0].notes,'Browser persisted profile correction');
 await page.getByRole('button',{name:'ادغام مشخصات',exact:true}).click();
 for(const width of [320,375,768,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:width<768?812:1000});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Merge modal viewport overflow: '+width);}
 const target=(await db.query(`SELECT first_name,last_name,company,code FROM ${t('customers')} WHERE id=$1`,[targetId])).rows[0],name=[target.first_name,target.last_name].filter(Boolean).join(' ')||target.company||target.code;
 await page.getByRole('combobox',{name:'مشتری مقصد؛ نگه داشته می‌شود',exact:true}).click();await page.getByRole('combobox',{name:'جستجو در مشتری مقصد؛ نگه داشته می‌شود',exact:true}).fill(String(name));await page.getByRole('option').filter({hasText:String(name)}).first().click();
 await page.getByRole('checkbox',{name:'تأیید بایگانی نمایهٔ تکراری و حفظ سوابق اصلی',exact:true}).check();
 const merged=page.waitForResponse(response=>response.url().includes('/api/customers/'+browserSourceId)&&response.request().method()==='POST');await page.getByRole('button',{name:'تأیید ادغام',exact:true}).click();const response=await merged;assert.equal(response.status(),200);assert.ok(response.request().headers()['idempotency-key']);await page.waitForURL(origin+'/customers/'+targetId);
 await page.getByRole('heading',{name:'سوابق اصلی و ادغام مشخصات',exact:true}).waitFor();assert.equal((await db.query(`SELECT is_archived FROM ${t('customers')} WHERE id=$1`,[browserSourceId])).rows[0].is_archived,'1');assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('merge_log')} WHERE merged_id=$1 AND master_id=$2`,[browserSourceId,targetId])).rows[0].n,'1');
 check('real Persian profile edit and controlled merge, searchable destination, confirmation, persisted alias history and mobile/theme modal bounds');
}
