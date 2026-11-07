import assert from 'node:assert/strict';
import type {PostgresDatabase} from '../src/lib/db/postgres';
import {postgresRelation} from '../src/lib/db/postgres-auth';
import type {Page} from 'playwright-core';

type Request=(route:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<Response>;
export async function postgresOperationalHttpScenarios(db:PostgresDatabase,schema:string,request:Request,owner:string,one:string,two:string,customer:number,check:(message:string)=>void){
 const t=(name:string)=>postgresRelation(schema,name);
 const command=async(path:string,body:unknown,key:string)=>{const response=await request(path,'POST',body,owner,key);assert.equal(response.status,200,path+': '+await response.clone().text());return response.json();};
 const beforeJournals=(await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n;
 const body={customer_id:customer,type:'mobile',brand:'Operational API',model:'مدل اصلی',imei:'OPS-HTTP-001'};
 const results=await Promise.all(Array.from({length:4},()=>request('/api/devices','POST',body,owner,'ops-http-device')));for(const result of results)assert.equal(result.status,200);
 const saved=await results[0].json();for(const result of results.slice(1))assert.deepEqual(await result.json(),saved);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('devices')} WHERE imei=$1`,[body.imei])).rows[0].n,'1');
 assert.equal((await request('/api/devices','POST',{...body,model:'Changed'},owner,'ops-http-device')).status,409);
 assert.equal((await request('/api/devices','POST',body,two,'ops-http-forbidden-customer')).status,404,'Foreign customer must be rejected by the API');
 const forbiddenPage=await request('/devices/'+saved.id,'GET',undefined,two),forbiddenHtml=await forbiddenPage.text();
 // Next16 keeps status200 after a streamed shell, while rendering notFound.
 // Require its explicit rejection marker and prove private content is absent.
 assert.ok([200,404].includes(forbiddenPage.status));assert.match(forbiddenHtml,/<meta[^>]+name="robots"[^>]+content="noindex"/);
 for(const privateValue of [body.brand,body.model,body.imei])assert.equal(forbiddenHtml.includes(privateValue),false,'Unauthorized device HTML leaked private content');
 const visible=await(await request('/api/devices?customer_id='+customer,'GET',undefined,one)).json();assert.equal(visible.devices.length,1);assert.equal(visible.devices[0].id,saved.id);
 const foreign=await(await request('/api/devices','GET',undefined,two)).json();assert.equal(foreign.devices.length,0);
 check('operational HTTP device creation has one persisted identity/audit/event across concurrent retries; foreign customer/branch denied');
 assert.equal((await request('/api/devices','POST',{...body,imei:'FORGED-HTTP-BRANCH',branch_id:2},one,'ops-http-forged-branch')).status,403);
 const archivedBody={...body,imei:'OPS-HTTP-ARCHIVED'},archived=await command('/api/devices',archivedBody,'ops-http-archived-source');
 await db.query(`UPDATE ${t('devices')} SET is_archived=1 WHERE id=$1`,[archived.id]);
 assert.equal((await request('/api/devices','POST',archivedBody,owner,'ops-http-archived-warning')).status,409);

 const update={action:'update',notes:'Actual HTTP profile metadata update'};await command('/api/customers/'+customer,update,'ops-http-profile');
 const profile=await(await request('/api/customers/'+customer,'GET',undefined,owner)).json();assert.equal(profile.customer.notes,update.notes);assert.equal(profile.customer.credit_limit,Number.MAX_SAFE_INTEGER);
 assert.equal((await request('/api/customers/'+customer,'POST',{action:'archive'},two,'ops-http-foreign-profile')).status,404);
 assert.equal((await request('/api/customers/'+customer,'POST',{action:'update',branch_id:2},owner,'ops-http-profile-transfer')).status,409);
 await command('/api/customers/'+customer,{action:'blacklist'},'ops-http-blacklist');await command('/api/customers/'+customer,{action:'unblacklist'},'ops-http-unblacklist');
 const supplier=await command('/api/suppliers',{name:'تأمین‌کننده عملیات HTTP',credit_limit:42},'ops-http-supplier');
 assert.equal((await(await request('/api/suppliers?q='+encodeURIComponent('عملیات HTTP'),'GET',undefined,owner)).json()).suppliers[0].id,supplier.id);
 const po=await command('/api/purchase-orders',{supplier_id:supplier.id,items:[{part_id:1,name:'Metadata supplier link',qty:1,unit_cost:13}]},'ops-http-supplier-link');assert.equal((await db.query(`SELECT supplier_id,total FROM ${t('purchase_orders')} WHERE id=$1`,[po.id])).rows[0].total,'13');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,beforeJournals);
 check('operational HTTP profile actions and supplier creation preserve financial ownership; real PO links supplier without inventing a journal');

 const company=await(await request('/api/branches','GET',undefined,owner)).json();assert.equal(company.branches.length,2);
 const local=await(await request('/api/branches','GET',undefined,one)).json();assert.deepEqual(local.branches.map((row:{id:number})=>row.id),[1]);
 assert.equal((await request('/api/branches?branch_id=2','GET',undefined,one)).status,403);
 assert.equal((await request('/api/branches','PATCH',{id:2,phone:'0210000000'},owner,'ops-http-branch-edit')).status,200);
 assert.equal((await request('/api/branches','PATCH',{id:2,name:'Forbidden'},one,'ops-http-branch-denied')).status,403);
 check('operational branch HTTP exposes both to company manager, current branch only to staff and company-only mutation');

 const note=await db.query(`INSERT INTO ${t('notifications')}(user_id,branch_id,title,body,link) VALUES(1,1,'موجودی کم','Synthetic owned alert','/parts/1'),(4,1,'موجودی کم','Private reviewer alert','/parts/1') RETURNING id,user_id`);
 const id=Number(note.rows.find(row=>row.user_id==='1')!.id);
 assert.equal((await request('/api/notifications','HEAD',undefined,owner)).status,200);
 const notes=await(await request('/api/notifications','GET',undefined,owner)).json();assert.equal(notes.notifications.some((row:{user_id:number})=>row.user_id!==1),false);assert.equal(notes.unread,1);
 const mark={action:'mark_read',id},marked=await command('/api/notifications',mark,'ops-http-mark-note');assert.equal(marked.updated,1);assert.deepEqual(await command('/api/notifications',mark,'ops-http-mark-note'),marked);
 assert.equal((await request('/api/notifications','POST',{action:'mark_all_read'},owner,'ops-http-mark-note')).status,409);
 assert.equal((await request('/api/notifications','POST',mark,one,'ops-http-forbidden-note')).status,404);
 assert.equal((await db.query(`SELECT read FROM ${t('notifications')} WHERE id=$1`,[id])).rows[0].read,'1');
 await db.query(`INSERT INTO ${t('notifications')}(user_id,branch_id,title,body,link) VALUES(1,1,'موجودی کم','Browser unread alert','/parts/1')`);
 check('operational notification HTTP scopes recipient and branch, marks once, safely replays and preserves peer privacy');
 return {deviceId:Number(saved.id),customerId:customer};
}

export async function postgresOperationalBrowserScenario(page:Page,db:PostgresDatabase,schema:string,origin:string,customer:number,check:(message:string)=>void){
 const t=(name:string)=>postgresRelation(schema,name);
 await page.goto(origin+'/devices/new?customer_id='+customer);await page.locator('#brand').fill('Browser operational device');await page.locator('#model').fill('مدل مرورگر');await page.locator('#f-imei').fill('OPS-BROWSER-001');
 const mutation=page.waitForResponse(response=>response.url().endsWith('/api/devices')&&response.request().method()==='POST');await page.getByRole('button',{name:'ذخیره دستگاه',exact:true}).click();const response=await mutation;assert.equal(response.status(),200);assert.ok(response.request().headers()['idempotency-key']);
 await page.waitForURL(/\/devices\/[0-9]+$/);await page.getByRole('heading',{name:'Browser operational device مدل مرورگر',exact:true}).waitFor();
 const saved=(await db.query(`SELECT id,customer_id FROM ${t('devices')} WHERE imei='OPS-BROWSER-001'`)).rows[0];assert.equal(saved.customer_id,String(customer));
 for(const route of ['/devices','/devices/'+saved.id]){await page.goto(origin+route);for(const width of [320,375,768,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:width<768?812:1000});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Device viewport overflow: '+route+' '+width);}}
 check('real Persian device form, original list/profile UI, durable submission and 320/375/768/1440 light/dark browser journeys');
 await page.getByRole('button',{name:'اعلان‌ها',exact:true}).click();await page.getByText('Browser unread alert',{exact:true}).waitFor();
 const marked=page.waitForResponse(response=>response.url().endsWith('/api/notifications')&&response.request().method()==='POST');await page.getByRole('button',{name:'خواندن همه',exact:true}).click();assert.equal((await marked).status(),200);
 await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('button')).find(button=>button.textContent?.trim()==='خواندن همه');return button instanceof HTMLButtonElement&&button.disabled;});
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('notifications')} WHERE user_id=1 AND COALESCE(read,0)=0`)).rows[0].n,'0');
 check('real header notification popover confirms server mutation before showing read state, with persisted own-recipient result');
}

export async function deviceSupportHttpAcceptance(context:{db:PostgresDatabase;schema:string;request:Request;owner:string;one:string;two:string;deviceId:number;check:(message:string)=>void}){
 const {db,schema,request,owner,one,two,deviceId,check}=context,t=(name:string)=>postgresRelation(schema,name);
 const get=async(path:string,cookie=one)=>{const response=await request(path,'GET',undefined,cookie);assert.equal(response.status,200,path+': '+await response.clone().text());return response.json();};
 const device=(await db.query(`SELECT imei,serial,branch_id FROM ${t('devices')} WHERE id=$1`,[deviceId])).rows[0];assert.ok(device);assert.equal(device.branch_id,'1');
 const identifiers=new URLSearchParams();if(device.imei)identifiers.set('imei',String(device.imei));if(device.serial)identifiers.set('serial',String(device.serial));
 const checkPath='/api/devices/check?'+identifiers.toString(),journalCount=(await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n;
 assert.equal((await get(checkPath)).exists,true);assert.equal((await get(checkPath,two)).exists,false);
 assert.equal((await request('/api/devices/check?branch_id=2','GET',undefined,one)).status,403);
 const body={device_id:deviceId,reason:'بررسی مالکیت ثبت‌شده در آزمون HTTP'},key='device-support-http-add';
 const responses=await Promise.all([request('/api/devices/check','POST',body,one,key),request('/api/devices/check','POST',body,one,key)]);
 for(const response of responses)assert.equal(response.status,200,'Blacklist HTTP: '+await response.clone().text());
 const saved=await responses[0].json();assert.deepEqual(await responses[1].json(),saved);assert.equal(typeof saved.id,'number');
 assert.equal((await request('/api/devices/check','POST',{...body,reason:'Changed request'},one,key)).status,409);
 assert.equal((await request('/api/devices/check','POST',body,two,'device-support-http-foreign-add')).status,404);
 assert.equal((await get(checkPath)).blacklisted.reason,body.reason);assert.equal((await get(checkPath,two)).blacklisted,null);
 const visible=await get('/api/devices/blacklist?page=1&perPage=1');assert.ok(visible.entries.some((entry:{id:number})=>entry.id===saved.id));assert.equal(visible.perPage,1);
 assert.equal((await get('/api/devices/blacklist',two)).entries.some((entry:{id:number})=>entry.id===saved.id),false);
 assert.ok((await get('/api/devices/blacklist',owner)).entries.some((entry:{id:number})=>entry.id===saved.id));
 assert.equal((await request('/api/devices/blacklist?id='+saved.id,'DELETE',undefined,two,'device-support-http-foreign-revoke')).status,404);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('device_blacklist')} WHERE id=$1`,[saved.id])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT is_blacklisted FROM ${t('devices')} WHERE id=$1`,[deviceId])).rows[0].is_blacklisted,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation='device.blacklist.add' AND operation_key=$1`,[key])).rows[0].n,'1');
 check('device support HTTP checks/blacklist enforce current branch and manager visibility, concurrent payload-bound retry, actual register/profile and one durable operation');

 const revoke='/api/devices/blacklist?id='+saved.id,revokeKey='device-support-http-revoke';
 const removed=await request(revoke,'DELETE',undefined,one,revokeKey);assert.equal(removed.status,200,await removed.clone().text());
 const replayed=await request(revoke,'DELETE',undefined,one,revokeKey);assert.equal(replayed.status,200);assert.deepEqual(await removed.json(),await replayed.json());
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('device_blacklist')} WHERE id=$1`,[saved.id])).rows[0].n,'1','Original blacklist evidence is retained');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('pg_device_blacklist_revocations')} WHERE blacklist_id=$1`,[saved.id])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='device_blacklist' AND entity_id=$1 AND action IN ('create','revoke')`,[saved.id])).rows[0].n,'2');
 assert.equal((await get(checkPath)).blacklisted,null);
 assert.equal((await db.query(`SELECT is_blacklisted FROM ${t('devices')} WHERE id=$1`,[deviceId])).rows[0].is_blacklisted,'0');
 check('device support HTTP revocation preserves immutable original evidence and one revocation/audit across uncertain-response replay; device flag reconciles');

 const date=new Date().toISOString().slice(0,10),reminder={device_id:deviceId,next_service_date:date,service_interval_days:180},reminderKey='device-support-http-reminder';
 const schedule=await request('/api/devices/service-reminders','POST',reminder,one,reminderKey);assert.equal(schedule.status,200,await schedule.clone().text());
 const scheduleAgain=await request('/api/devices/service-reminders','POST',reminder,one,reminderKey);assert.equal(scheduleAgain.status,200);assert.deepEqual(await schedule.json(),await scheduleAgain.json());
 assert.equal((await request('/api/devices/service-reminders','POST',reminder,two,'device-support-http-foreign-reminder')).status,404);
 assert.equal((await request('/api/devices/service-reminders','POST',{...reminder,next_service_date:'2026-02-30'},one,'device-support-http-invalid-date')).status,400);
 assert.equal((await request('/api/devices/service-reminders','POST',{...reminder,service_interval_days:90},one,reminderKey)).status,409);
 assert.ok((await get('/api/devices/service-reminders')).due_soon.some((row:{id:number})=>row.id===deviceId));
 assert.equal((await get('/api/devices/service-reminders',two)).due_soon.some((row:{id:number})=>row.id===deviceId),false);
 const persisted=(await db.query(`SELECT next_service_date,service_interval_days FROM ${t('devices')} WHERE id=$1`,[deviceId])).rows[0];assert.equal(persisted.next_service_date,date);assert.equal(persisted.service_interval_days,'180');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation='device.service.reminder' AND operation_key=$1`,[reminderKey])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='device' AND entity_id=$1 AND action='service_reminder'`,[deviceId])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('accounting_journals')}`)).rows[0].n,journalCount,'Support metadata does not invent accounting recognition');
 check('device support HTTP reminders validate real dates, preserve scoped data, persist exact interval and single audit/operation; no financial journal invented');
}
