import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import type {PostgresDatabase} from '../src/lib/db/postgres';
import {postgresRelation} from '../src/lib/db/postgres-auth';
type Request=(route:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<Response>;
export async function postgresAppointmentsHttpAcceptance(context:{db:PostgresDatabase;schema:string;request:Request;owner:string;one:string;two:string;customerId:number;check:(message:string)=>void}){
 const {db,schema,request,owner,one,two,customerId,check}=context,t=(n:string)=>postgresRelation(schema,n),body={customer_id:customerId,preferred_at:'2026-12-18T11:30',notes:'نوبت واقعی آزمون HTTP'},key='appointments-http-create';
 const replies=await Promise.all([request('/api/appointments','POST',body,one,key),request('/api/appointments','POST',body,one,key)]);for(const response of replies)assert.equal(response.status,200,await response.clone().text());const saved=await replies[0].json();assert.deepEqual(await replies[1].json(),saved);assert.equal(saved.version,1);
 assert.equal((await request('/api/appointments','POST',{...body,notes:'changed'},one,key)).status,409);
 assert.equal((await request('/api/appointments','POST',body,two,'appointments-http-foreign-create')).status,404);
 const foreign=await request('/api/appointments','GET',undefined,two);assert.equal(foreign.status,200);assert.equal((await foreign.json()).appointments.some((a:{id:number})=>a.id===saved.id),false);
 const local=await request('/api/appointments','GET',undefined,owner);assert.equal(local.status,200);assert.ok((await local.json()).appointments.some((a:{id:number})=>a.id===saved.id));
 assert.equal((await request('/api/appointments?branch_id=2','GET',undefined,one)).status,403);
 const confirm={status:'confirmed',expected_version:1},url='/api/appointments/'+saved.id;
 const response=await request(url,'PATCH',confirm,one,'appointments-http-confirm');assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).version,2);
 assert.equal((await request(url,'PATCH',confirm,two,'appointments-http-foreign-patch')).status,404);
 assert.equal((await request(url,'PATCH',{notes:'stale edit',expected_version:1},one,'appointments-http-stale')).status,409);
 const cancel=await request(url,'PATCH',{status:'cancelled',expected_version:2},one,'appointments-http-cancel');assert.equal(cancel.status,200,await cancel.clone().text());
 assert.equal((await request(url,'PATCH',{status:'confirmed',expected_version:3},one,'appointments-http-reopen')).status,409);
 const history=(await db.query(`SELECT version,document FROM ${t('pg_appointment_history')} WHERE appointment_id=$1 ORDER BY version`,[saved.id])).rows;assert.deepEqual(history.map(r=>r.version),['1','2','3']);assert.deepEqual(history.map(r=>JSON.parse(String(r.document)).status),['requested','confirmed','cancelled']);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('operation_receipts')} WHERE operation_key=$1`,[key])).rows[0].n,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('audit_logs')} WHERE entity='appointment' AND entity_id=$1`,[saved.id])).rows[0].n,'3');
 check('appointments HTTP creates once, enforces current branch and exact optimistic transitions, persists immutable snapshots/audits without stale overwrite');
 const device=(await db.query(`SELECT id FROM ${t('devices')} WHERE customer_id=$1 AND branch_id=1 AND is_archived=0 ORDER BY id LIMIT 1`,[customerId])).rows[0];assert.ok(device,'An actual scoped device is required for conversion acceptance');
 const source=await request('/api/appointments','POST',{customer_id:customerId,preferred_at:'2026-12-20T11:30'},one,'appointments-http-conversion-source');assert.equal(source.status,200);const convertible=await source.json(),convertBody={device_id:Number(device.id),expected_version:1},convertPath='/api/appointments/'+convertible.id+'/convert';
 const conversions=await Promise.all([request(convertPath,'POST',convertBody,one,'appointments-http-conversion'),request(convertPath,'POST',convertBody,one,'appointments-http-conversion')]);for(const reply of conversions)assert.equal(reply.status,200,await reply.clone().text());const ticket=await conversions[0].json();assert.deepEqual(await conversions[1].json(),ticket);
 assert.equal((await request(convertPath,'POST',convertBody,two,'appointments-http-foreign-conversion')).status,404);
 const linked=(await db.query(`SELECT a.status,a.ticket_id,ticket.customer_id,ticket.device_id,ticket.source,ticket.branch_id FROM ${t('appointments')} a JOIN ${t('repair_tickets')} ticket ON ticket.id=a.ticket_id WHERE a.id=$1`,[convertible.id])).rows[0];assert.equal(linked.status,'converted');assert.equal(linked.ticket_id,String(ticket.id));assert.equal(linked.customer_id,String(customerId));assert.equal(linked.device_id,device.id);assert.equal(linked.source,'appointment');assert.equal(linked.branch_id,'1');
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('pg_appointment_history')} WHERE appointment_id=$1`,[convertible.id])).rows[0].n,'2');
 check('appointments HTTP conversion reuses real native intake atomically, retains original source and creates one scoped ticket across concurrent retries');
 return {appointmentId:Number(saved.id),convertedAppointmentId:Number(convertible.id),ticketId:Number(ticket.id)};
}
export async function postgresAppointmentsBrowserAcceptance(context:{page:Page;db:PostgresDatabase;schema:string;origin:string;customerId:number;check:(message:string)=>void}){
 const {page,db,schema,origin,customerId,check}=context,t=(n:string)=>postgresRelation(schema,n);
 await page.goto(origin+'/appointments');await page.getByRole('heading',{name:'نوبت‌ها',exact:true}).waitFor();
 for(const width of [320,375,768,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:width<768?812:1000});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Appointments overflow '+width);}
 await page.getByRole('button',{name:'+ ثبت نوبت جدید',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.locator('select').first().selectOption(String(customerId),{force:true});await dialog.locator('input[type="datetime-local"]').fill('2026-12-19T13:45');await dialog.locator('textarea').fill('نوبت واقعی از مرورگر');
 const sent=page.waitForResponse(r=>r.url().endsWith('/api/appointments')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'ثبت نوبت',exact:true}).click();const response=await sent;assert.equal(response.status(),200,await response.text());assert.ok(response.request().headers()['idempotency-key']);const saved=await response.json();
 await page.getByText('نوبت واقعی از مرورگر',{exact:true}).waitFor();const card=page.locator('.card').filter({hasText:'نوبت واقعی از مرورگر'});const confirmed=page.waitForResponse(r=>r.url().endsWith('/api/appointments/'+saved.id)&&r.request().method()==='PATCH');await card.getByRole('button',{name:'تأیید نوبت',exact:true}).click();assert.equal((await confirmed).status(),200);
 const row=(await db.query(`SELECT status,preferred_at,customer_id FROM ${t('appointments')} WHERE id=$1`,[saved.id])).rows[0];assert.equal(row.status,'confirmed');assert.equal(row.preferred_at,'2026-12-19T13:45');assert.equal(row.customer_id,String(customerId));
 check('real original appointments Persian UI renders 320/375/768/1440 in both themes, creates with durable nonce and confirms persisted versioned state');
}
