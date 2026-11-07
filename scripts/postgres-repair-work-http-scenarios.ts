import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import type {PostgresDatabase} from '../src/lib/db/postgres';
import {postgresRelation} from '../src/lib/db/postgres-auth';
type Request=(path:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<Response>;
async function successful<T>(response:Response):Promise<T>{assert.equal(response.status,200,await response.clone().text());return response.json() as Promise<T>;}
export async function postgresRepairWorkHttpAcceptance(c:{db:PostgresDatabase;schema:string;request:Request;owner:string;one:string;two:string;techOne:string;techTwo:string;customerId:number;deviceId:number;check:(message:string)=>void}){
 const {db,schema,request,owner,one,two,techOne,techTwo,customerId,deviceId,check}=c,t=(n:string)=>postgresRelation(schema,n),financial=(await db.query(`SELECT (SELECT COUNT(*) FROM ${t('payments')}) receipts,(SELECT COUNT(*) FROM ${t('accounting_journals')}) journals,(SELECT COUNT(*) FROM ${t('inventory_movements')}) movements`)).rows[0];
 const create=async(key:string)=>{
  const ticket=await successful<{id:number;number:string}>(await request('/api/repairs','POST',{customer_id:customerId,device_id:deviceId,problem:'Native HTTP technical lifecycle'},one,key));
  const policy=await successful<{revision:number}>(await request('/api/settings/repair-workflow?branch_id=1','GET',undefined,owner));
  const result=await successful<{summary:{ok:number}}>(await request('/api/repairs/assign','POST',{items:[{id:ticket.id,expect:null,version:0,workflow_revision:policy.revision}],technician_id:5},owner,key+'-assign'));assert.equal(result.summary.ok,1);return {...ticket,revision:policy.revision};
 };
 const ticket=await create('http-work-real-intake'),path='/api/repairs/'+ticket.id;
 assert.equal((await request(path+'/diagnosis','POST',{expected_work_version:0,diagnosis:'Forbidden'},two,'http-work-foreign')).status,404);
 assert.equal((await request(path+'/diagnosis','POST',{expected_work_version:0,diagnosis:'Forbidden'},techTwo,'http-work-unassigned')).status,403);
 const body={expected_work_version:0,version:1,workflow_revision:ticket.revision},started=await successful<{id:number;work_version:number;status:string}>(await request(path+'/start','POST',body,techOne,'http-work-start'));
 assert.equal(started.status,'Diagnosing');assert.deepEqual(await successful(await request(path+'/start','POST',body,techOne,'http-work-start')),started);
 assert.equal((await request(path+'/start','POST',{...body,version:2},techOne,'http-work-start')).status,409);
 const diagnosis={expected_work_version:1,diagnosis:'Verified HTTP evidence',diagnosis_outcome:'repairable',root_cause:'Documented cause'};
 await successful(await request(path+'/diagnosis','POST',diagnosis,techOne,'http-work-diagnosis'));
 assert.equal((await request(path+'/diagnosis','POST',{...diagnosis,diagnosis:'Stale'},techOne,'http-work-stale')).status,409);
 await successful(await request(path+'/time','POST',{action:'stop',expected_work_version:2,previous_entry_id:started.id},techOne,'http-work-stop'));
 const time=await successful<{totalMinutes:number;running:unknown;work_version:number}>(await request(path+'/time','GET',undefined,techOne));assert.equal(time.totalMinutes,1);assert.equal(time.running,null);assert.equal(time.work_version,3);
 for(const [index,status]of ['In Repair','Quality Control'].entries())await successful(await request(path+'/status','POST',{status,expected_work_version:index+3},techOne,'http-work-status-'+index));
 await successful(await request(path+'/qc','POST',{result:'pass',notes:'Actually inspected',expected_work_version:5},techOne,'http-work-qc'));
 const source=(await db.query(`SELECT s.name,t.diagnosis,t.qc_status,t.work_version FROM ${t('repair_tickets')} t JOIN ${t('repair_statuses')} s ON s.id=t.status_id WHERE t.id=$1`,[ticket.id])).rows[0];assert.deepEqual(source,{name:'Ready for Pickup',diagnosis:'Verified HTTP evidence',qc_status:'passed',work_version:'6'});
 assert.equal((await request(path+'/status','POST',{status:'Delivered',expected_work_version:6},techOne,'http-work-delivery-blocked')).status,409);
 assert.equal((await db.query(`SELECT COUNT(*) n FROM ${t('messages')} WHERE ticket_id=$1 AND status<>'queued'`,[ticket.id])).rows[0].n,'0');
 assert.deepEqual((await db.query(`SELECT (SELECT COUNT(*) FROM ${t('payments')}) receipts,(SELECT COUNT(*) FROM ${t('accounting_journals')}) journals,(SELECT COUNT(*) FROM ${t('inventory_movements')}) movements`)).rows[0],financial);
 check('native HTTP assigned start, diagnosis, exact timer settlement, legal status/QC, branch/replay/stale guards and actual queued notices preserve financial/stock sources');
 return create('http-work-browser-intake');
}

export async function postgresRepairWorkBrowserAcceptance(c:{page:Page;db:PostgresDatabase;schema:string;origin:string;techOne:string;ticket:{id:number;number:string};check:(message:string)=>void}){
 const {page,db,schema,origin,techOne,ticket,check}=c,t=(n:string)=>postgresRelation(schema,n),browser=page.context().browser();assert.ok(browser);
 const context=await browser.newContext();try{
  await context.addCookies(techOne.split(';').map(part=>{const index=part.indexOf('=');return {name:part.slice(0,index).trim(),value:part.slice(index+1).trim(),url:origin,httpOnly:true,sameSite:'Lax' as const};}));
  const worker=await context.newPage(),errors:string[]=[];worker.on('pageerror',error=>errors.push(error.name));await worker.goto(origin+'/repairs/queue');
  const card=worker.locator('.card').filter({has:worker.getByRole('link',{name:ticket.number,exact:true})});
  const start=worker.waitForResponse(r=>r.url().endsWith(`/api/repairs/${ticket.id}/start`)&&r.request().method()==='POST');
  // Locate by the actual ticket link, preserving the existing card component.
  const link=worker.getByRole('link',{name:ticket.number,exact:true});await link.waitFor();
  const container=card;
  await container.getByRole('button',{name:/^(شروع تعمیر|دریافت و شروع کار)$/}).click();const started=await start;assert.equal(started.status(),200,await started.text());assert.ok(started.request().headers()['idempotency-key']);
  await worker.goto(origin+'/repairs/'+ticket.id);await worker.locator('#diag').fill('تشخیص واقعی مرورگر');
  const diagnosis=worker.waitForResponse(r=>r.url().endsWith(`/api/repairs/${ticket.id}/diagnosis`)&&r.request().method()==='POST');await worker.getByRole('button',{name:'ذخیره عیب‌یابی',exact:true}).click();const diagnosisResponse=await diagnosis;assert.equal(diagnosisResponse.status(),200,await diagnosisResponse.text());
  await worker.getByRole('button',{name:'توقف',exact:true}).waitFor();const stop=worker.waitForResponse(r=>r.url().endsWith(`/api/repairs/${ticket.id}/time`)&&r.request().method()==='POST');await worker.getByRole('button',{name:'توقف',exact:true}).click();const stopResponse=await stop;assert.equal(stopResponse.status(),200,await stopResponse.text());
  const persisted=(await db.query(`SELECT diagnosis,work_version FROM ${t('repair_tickets')} WHERE id=$1`,[ticket.id])).rows[0];assert.equal(persisted.diagnosis,'تشخیص واقعی مرورگر');assert.equal(persisted.work_version,'3');
  const times=(await db.query(`SELECT minutes_active,ended_at FROM ${t('time_entries')} WHERE ticket_id=$1`,[ticket.id])).rows;assert.equal(times.length,1);assert.equal(times[0].minutes_active,'1');assert.ok(times[0].ended_at);
  for(const width of [320,375,768,1440])for(const dark of [false,true]){await worker.setViewportSize({width,height:width<768?812:1000});await worker.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Native technical workspace overflow '+width);}
  assert.equal(await worker.locator('html').getAttribute('dir'),'rtl');assert.deepEqual(errors,[]);check('real technician browser queue start, persisted diagnosis and exact timer stop; Persian RTL, four widths and both themes');
 }finally{await context.close();}
}
