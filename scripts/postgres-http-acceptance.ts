import {createRequire} from 'node:module';
import {postgresRepairWorkHttpAcceptance,postgresRepairWorkBrowserAcceptance} from './postgres-repair-work-http-scenarios';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createPostgresDatabase} from '../src/lib/db/postgres';
import {applyPostgresMigrations} from '../src/lib/db/pg-migrations';
import {postgresRelation} from '../src/lib/db/postgres-auth';
import {hashLoginPassword} from '../src/lib/credential-verification';
import {postgresFinancialHttpScenarios} from './postgres-financial-http-scenarios';
import {postgresOperationalHttpScenarios,postgresOperationalBrowserScenario,deviceSupportHttpAcceptance} from './postgres-operational-http-scenarios';
import {postgresChatHttpAcceptance,postgresChatBrowserAcceptance} from './postgres-chat-http-scenarios';
import {postgresMergeHttpAcceptance,postgresMergeBrowserAcceptance} from './postgres-merge-http-scenarios';
import {postgresAppointmentsHttpAcceptance,postgresAppointmentsBrowserAcceptance} from './postgres-appointments-http-scenarios';
import {postgresComplaintsHttpAcceptance,postgresComplaintsBrowserAcceptance} from './postgres-complaints-http-scenarios';
import {postgresRepairHttpAcceptance,postgresRepairBrowserAcceptance} from './postgres-repair-http-scenarios';
import {postgresRepairNotesHttpAcceptance,postgresRepairNotesBrowserAcceptance} from './postgres-repair-notes-http-scenarios';
import {postgresRepairAssignmentHttpAcceptance,postgresRepairAssignmentBrowserAcceptance} from './postgres-repair-assignment-http-scenarios';

async function main(){
 const source=process.env.REPAID_PG_TEST_ADMIN_URL;if(!source)throw Error('Explicit isolated PostgreSQL test service required');
 const url=new URL(source);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('HTTP acceptance requires a loopback disposable service');
 const suffix=randomBytes(12).toString('hex'),name='repaid_phase01_'+suffix,schema='repaid_integration_'+suffix,admin=createPostgresDatabase({connectionString:source,allowLocalPlaintext:true,statementTimeoutMs:120000});
 const root=fs.realpathSync('.'),work=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-pg-http-')),app=path.join(work,'application'),data=path.join(work,'empty-sqlite-data');fs.chmodSync(work,0o700);fs.mkdirSync(app);fs.mkdirSync(data);console.log('Private isolated evidence: '+work);
 const log=fs.openSync(path.join(work,'application.log'),'a'),checks:string[]=[],password=randomBytes(24).toString('hex'),origin='http://127.0.0.1:3044';let child:ChildProcess|undefined,db:ReturnType<typeof createPostgresDatabase>|undefined,created=false;
 const check=(label:string)=>{checks.push(label);console.log('PASS '+label);};
 try{
  await admin.query('CREATE DATABASE "'+name+'"');created=true;url.pathname='/'+name;db=createPostgresDatabase({connectionString:url.toString(),allowLocalPlaintext:true});await applyPostgresMigrations(db,schema,{targetVersion:1});const table=(n:string)=>postgresRelation(schema,n);
  await db.query(`INSERT INTO ${table('branches')}(id,name,code) VALUES(1,'شعبهٔ یک','ONE'),(2,'شعبهٔ دو','TWO')`);
  const hash=await hashLoginPassword(password);await db.query(`INSERT INTO ${table('users')}(id,name,email,password_hash,role,branch_id) VALUES(1,'مدیر آزمون','owner@pg.invalid',$1,'owner',1),(2,'کارمند یک','one@pg.invalid',$1,'reception',1),(3,'کارمند دو','two@pg.invalid',$1,'reception',2),(4,'Synthetic reviewer','reviewer@pg.invalid',$1,'admin',1)`,[hash]);await db.query(`INSERT INTO ${table('settings')}(key,value) VALUES('default_credit_limit','1234567'),('currency_unit','rial')`);
  await db.query(`INSERT INTO ${table('users')}(id,name,email,password_hash,role,branch_id) VALUES(5,'HTTP Technician One','tech-one@pg.invalid',$1,'technician',1),(6,'HTTP Technician Two','tech-two@pg.invalid',$1,'technician',1),(7,'HTTP Technician Foreign','tech-foreign@pg.invalid',$1,'technician',2)`,[hash]);
  await db.query(`INSERT INTO ${table('users')}(id,name,email,password_hash,role,branch_id) SELECT 999+n,'HTTP Bulk Technician '||lpad(n::text,3,'0'),'bulk-'||n::text||'@pg.invalid',$1,'technician',1 FROM generate_series(1,201) n`,[hash]);
  await db.query(`INSERT INTO ${table('suppliers')}(id,name) VALUES(1,'Synthetic HTTP supplier')`);await db.query(`INSERT INTO ${table('parts')}(id,name,quantity_precision,avg_cost,purchase_price) VALUES(1,'HTTP purchased part',6,0,0)`);await db.query(`INSERT INTO ${table('inventory_locations')}(id,name,branch_id,is_default) VALUES(1,'HTTP warehouse',1,1)`);await applyPostgresMigrations(db,schema);
  const files=execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  for(const relative of new Set(files)){if(!fs.existsSync(relative)||relative.startsWith('.agents/')||relative.startsWith('.claude/')||relative.startsWith('.claude-plugin/')||relative==='imanpng.PNG'||relative.startsWith('data/')||relative.startsWith('node_modules/')||relative.startsWith('.next/')||!fs.statSync(relative).isFile())continue;const target=path.join(app,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(relative,target);}
  fs.symlinkSync(path.join(root,'node_modules'),path.join(app,'node_modules'),process.platform==='win32'?'junction':'dir');
  const environment:NodeJS.ProcessEnv={...process.env,REPAID_DATABASE_ENGINE:'postgres',REPAID_PG_INTEGRATION:'1',REPAID_PG_URL:url.toString(),REPAID_PG_SCHEMA:schema,REPAID_DATA_DIR:data,REPAID_ENCRYPTION_KEY:randomBytes(32).toString('hex'),REPAID_DEMO_MODE:'0',REPAID_COOKIE_SECURE:'0',APP_ORIGIN:origin,NEXT_BUILD_CPUS:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production'};
  delete environment.REPAID_PG_TEST_ADMIN_URL;
  if(process.env.PG_HTTP_DEV!=='1'){
   const build=spawn(process.execPath,[path.join(app,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:app,env:environment,windowsHide:true,stdio:['ignore',log,log]});const [code]=await once(build,'exit');assert.equal(code,0,'Isolated production build failed; inspect private application log');check('isolated production build');
  }
  const args=process.env.PG_HTTP_DEV==='1'?['dev','--webpack']:['start'];child=spawn(process.execPath,[path.join(app,'node_modules/next/dist/bin/next'),...args,'--hostname','127.0.0.1','--port','3044'],{cwd:app,env:{...environment,NODE_ENV:process.env.PG_HTTP_DEV==='1'?'development':'production'},windowsHide:true,stdio:['ignore',log,log]});
  let healthy=false;for(let i=0;i<120;i++){if(child.exitCode!=null)throw Error('Isolated Next process exited');try{const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(2000)});const body=await response.json();if(response.ok&&body.engine==='postgres'&&body.integration_only===true){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(healthy,'PostgreSQL application never became healthy');check('actual PostgreSQL website health');
  const request=(route:string,method='GET',body?:unknown,cookie?:string,key?:string)=>fetch(origin+route,{method,redirect:'manual',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});
  const login=async(email:string)=>{const response=await request('/api/auth/login','POST',{email,password});assert.equal(response.status,200);const raw=response.headers.get('set-cookie')??'';assert.match(raw,/HttpOnly/i);assert.match(raw,/SameSite=lax/i);return raw.split(';')[0];};
  assert.equal((await request('/api/customers')).status,401);assert.equal((await request('/api/customers','GET',undefined,'repaid_session='+'a'.repeat(48))).status,401);check('unauthorized and forged sessions denied');
  const owner=await login('owner@pg.invalid'),one=await login('one@pg.invalid'),two=await login('two@pg.invalid'),reviewer=await login('reviewer@pg.invalid');
  const techOne=await login('tech-one@pg.invalid'),techTwo=await login('tech-two@pg.invalid'),techForeign=await login('tech-foreign@pg.invalid');
  assert.equal((await request('/api/customers','HEAD',undefined,owner)).status,200);
  const payload={first_name:'مشتری HTTP',last_name:'Fixture',mobile:'09120010001',credit_limit:'9007199254740991'};
  const response=await request('/api/customers','POST',payload,owner,'http-create-one');assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.code,'C0001');assert.equal(saved.redirect,'/customers/'+saved.id);
  const persisted=(await db.query(`SELECT * FROM ${table('customers')} WHERE id=$1`,[saved.id])).rows[0];assert.equal(persisted.first_name,payload.first_name);assert.equal(String(persisted.credit_limit),'9007199254740991');assert.equal(Number(persisted.branch_id),1);assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM ${table('accounting_journals')}`)).rows[0].n),0);check('real customer create and exact persisted value; no invented journal');
  assert.deepEqual(await (await request('/api/customers','POST',payload,owner,'http-create-one')).json(),saved);assert.equal((await request('/api/customers','POST',{...payload,first_name:'تغییر'},owner,'http-create-one')).status,409);
  assert.equal((await request('/api/customers/'+saved.id,'GET',undefined,one)).status,200);assert.equal((await request('/api/customers/'+saved.id,'GET',undefined,two)).status,404);assert.equal((await request('/api/customers?branch_id=2','GET',undefined,one)).status,403);check('durable replay/payload binding and direct branch authorization');
  const concurrent=await Promise.all(Array.from({length:6},()=>request('/api/customers','POST',{first_name:'همزمان',mobile:'09120010002'},owner,'http-concurrent')));for(const item of concurrent)assert.equal(item.status,200);const identities=await Promise.all(concurrent.map(item=>item.json()));assert.equal(new Set(identities.map(item=>item.id)).size,1);check('six actual concurrent HTTP requests commit one customer');
  const branchTwo=await request('/api/customers','POST',{first_name:'فقط شعبه دو',mobile:'09120010003'},two,'http-branch-two');assert.equal(branchTwo.status,200);const b=await branchTwo.json();assert.equal((await request('/api/customers/'+b.id,'GET',undefined,one)).status,404);assert.equal((await request('/api/customers/'+b.id,'GET',undefined,owner)).status,200);check('staff isolated; manager sees both branches');
  const before=(await db.query(`SELECT COUNT(*) n FROM ${table('customers')}`)).rows[0].n;
  await db.query(`CREATE FUNCTION "${schema}".http_injected_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='create' AND NEW.entity='customer' THEN RAISE EXCEPTION 'injected audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END$$`);await db.query(`CREATE TRIGGER http_injected_audit_failure BEFORE INSERT ON ${table('audit_logs')} FOR EACH ROW EXECUTE FUNCTION "${schema}".http_injected_audit_failure()`);
  const failed=await request('/api/customers','POST',{first_name:'اتمیک',mobile:'09120010004'},owner,'http-rollback');assert.ok(failed.status>=400);assert.equal((await db.query(`SELECT COUNT(*) n FROM ${table('customers')}`)).rows[0].n,before);
  await db.query(`DROP TRIGGER http_injected_audit_failure ON ${table('audit_logs')}`);await db.query(`DROP FUNCTION "${schema}".http_injected_audit_failure()`);assert.equal((await request('/api/customers','POST',{first_name:'اتمیک',mobile:'09120010004'},owner,'http-rollback')).status,200);check('actual audit failure rolls mutation back; same key safely retries');
  assert.equal((await request('/api/payroll','POST',{},owner)).status,503);const cross=await fetch(origin+'/api/customers',{method:'POST',headers:{Origin:'https://foreign.invalid',Cookie:owner,'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(cross.status,403);check('unported routes blocked and same-origin enforcement retained');
  await postgresFinancialHttpScenarios(db,schema,request,owner,reviewer,two,saved.id,check);
  const operations=await postgresOperationalHttpScenarios(db,schema,request,owner,one,two,saved.id,check);
  await deviceSupportHttpAcceptance({db,schema,request,owner,one,two,deviceId:operations.deviceId,check});
  const chat=await postgresChatHttpAcceptance({db,schema,request,owner,one,two,oneId:2,twoId:3,check});
  const merge=await postgresMergeHttpAcceptance({db,schema,request,owner,one,two,customer:saved.id,check});
  const repair=await postgresRepairHttpAcceptance({db,schema,request,owner,one,two,customerId:saved.id,deviceId:operations.deviceId,check});
  await postgresRepairNotesHttpAcceptance({db,schema,request,owner,one,two,ticketId:repair.ticketId,check});
  await postgresAppointmentsHttpAcceptance({db,schema,request,owner,one,two,customerId:saved.id,check});
  await postgresComplaintsHttpAcceptance({db,schema,request,owner,one,two,customerId:saved.id,check});
  const assignment=await postgresRepairAssignmentHttpAcceptance({db,schema,request,owner,one,two,techOne,techTwo,techForeign,ticketId:repair.ticketId,customerId:saved.id,deviceId:operations.deviceId,check});
  const workTicket=await postgresRepairWorkHttpAcceptance({db,schema,request,owner,one,two,techOne,techTwo,customerId:saved.id,deviceId:operations.deviceId,check});
  if(process.env.PG_HTTP_BROWSER!=='0'){
   const {chromium}=await import('playwright-core');const chrome=process.env.CHROME_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>fs.existsSync(file));if(!chrome)throw Error('Browser requested but no approved Chromium executable found');
   const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});try{const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[];page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);page.on('pageerror',error=>errors.push(error.name));
    await page.goto(origin+'/login');await page.locator('input[name=email]').fill('owner@pg.invalid');await page.locator('input[name=password]').fill(password);await page.locator('button[type=submit]').click();await page.waitForURL('**/customers');assert.match(await page.locator('html').getAttribute('dir')??'',/rtl/);assert.equal(/\bnull\b/.test(await page.locator('tbody').innerText()),false);await page.screenshot({path:path.join(work,'customers-desktop.png'),fullPage:true});
    await page.goto(origin+'/customers/new');await page.locator('#fn').fill('مشتری مرورگر');await page.locator('#ln').fill('Fixture');await page.locator('#mob').fill('09120010005');await page.getByRole('button',{name:'ذخیره مشتری',exact:true}).click();await page.waitForURL(/\/customers\/[0-9]+$/);await page.getByRole('heading',{name:'مشتری مرورگر Fixture',exact:true}).waitFor();
    for(const width of [320,375,768,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:width<768?812:1000});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);await page.screenshot({path:path.join(work,'customer-'+width+'-'+(dark?'dark':'light')+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);}
    await postgresOperationalBrowserScenario(page,db,schema,origin,saved.id,check);
    await postgresChatBrowserAcceptance({page,db,schema,origin,conversationId:chat.conversationId,check});
    await postgresMergeBrowserAcceptance({page,db,schema,origin,...merge,check});
    await postgresRepairBrowserAcceptance({page,origin,...repair,check});
    await postgresRepairNotesBrowserAcceptance({page,db,schema,origin,ticketId:repair.ticketId,check});
    await postgresAppointmentsBrowserAcceptance({page,db,schema,origin,customerId:saved.id,check});
    await postgresComplaintsBrowserAcceptance({page,db,schema,origin,customerId:saved.id,check});
    await postgresRepairAssignmentBrowserAcceptance({page,db,schema,origin,fixture:assignment,techOne,check});
    await postgresRepairWorkBrowserAcceptance({page,db,schema,origin,techOne,ticket:workTicket,check});
    const {deviceCatalogBrowserAcceptance}=createRequire(import.meta.url)('./device-catalog-browser.cjs') as {deviceCatalogBrowserAcceptance:(options:{page:typeof page;origin:string;customerId:number;check:typeof check;includeReception:boolean})=>Promise<void>};await deviceCatalogBrowserAcceptance({page,origin,customerId:saved.id,check,includeReception:false});
    assert.equal(errors.length,0,'Browser runtime errors');const real=(await db.query(`SELECT id FROM ${table('customers')} WHERE mobile='09120010005'`)).rows[0];assert.ok(real);check('real server-action login, browser form/create/profile, RTL, 320/375/768/1440 and both themes');await context.close();
   }finally{await browser.close();}
  }
  assert.equal((await request('/api/auth/logout','GET',undefined,owner)).status,303);assert.equal((await request('/api/customers','GET',undefined,owner)).status,200);assert.equal((await request('/api/auth/logout','POST',{},owner)).status,303);assert.equal((await request('/api/customers','GET',undefined,owner)).status,401);check('safe GET logout; POST revokes actual PostgreSQL session');
  const credentialCookie=await login('owner@pg.invalid'),nextPassword=randomBytes(24).toString('hex'),changed=await request('/api/auth/change-password','POST',{current_password:password,new_password:nextPassword},credentialCookie);assert.equal(changed.status,200);const changedCookie=(changed.headers.get('set-cookie')??'').split(';')[0];assert.equal((await request('/api/customers','GET',undefined,credentialCookie)).status,401);assert.equal((await request('/api/customers','GET',undefined,changedCookie)).status,200);check('HTTP password change rotates session and revokes old credentials');
  const assertions=(await db.query(`SELECT (SELECT COUNT(*) FROM ${table('customers')}) customers,(SELECT COUNT(*) FROM ${table('audit_logs')} WHERE entity='customer' AND action='create') audits,(SELECT COUNT(*) FROM ${table('customer_events')} WHERE type='customer') events,(SELECT COUNT(*) FROM ${table('operation_receipts')} WHERE operation='customer.create') operations`)).rows[0];assert.equal(assertions.customers,assertions.audits);assert.equal(assertions.customers,assertions.events);assert.equal(assertions.customers,assertions.operations);assert.deepEqual(fs.readdirSync(data),[]);check('all source/audit/event/operation identities reconcile; zero SQLite files');
  fs.writeFileSync(path.join(work,'results.json'),JSON.stringify({passed:true,checks,assertions,engine:'postgres',production_cutover:false,original_data_used:false},null,2));console.log('Evidence: '+path.relative(root,work));
 }catch(error){const message=error instanceof Error?error.message:'Unknown failure';const diagnostic=message.replaceAll(password,'[REDACTED]').replaceAll(source,'[REDACTED]').replaceAll(url.toString(),'[REDACTED]').replace(/\b[a-f0-9]{48}\b/gi,'[REDACTED_TOKEN]');console.error('Isolated acceptance failure: '+diagnostic.slice(0,1600));fs.writeFileSync(path.join(work,'failure.json'),JSON.stringify({name:error instanceof Error?error.name:'Error',message:message.replaceAll(password,'[REDACTED]').replaceAll(source,'[REDACTED]').replaceAll(url.toString(),'[REDACTED]'),checks},null,2));throw error;}finally{
  if(child&&child.exitCode==null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,10000))]);if(child.exitCode==null)child.kill('SIGKILL');}
  fs.closeSync(log);await db?.close();try{if(created)await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');}finally{await admin.close();}
 }
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:'Isolated PostgreSQL HTTP acceptance failed; inspect its private application log.');process.exitCode=1;});
