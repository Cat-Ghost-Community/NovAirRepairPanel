/** Real compiled HTTP requests, verified financial sources and online backup.
 * Refuses every database outside an explicitly prepared disposable QA fixture. */
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';

async function main(){
 if(process.env.FINANCIAL_HTTP_QA!=='1')throw Error('Explicit disposable financial HTTP mode required');
 const requested=Number(process.env.LOAD_REGISTERED_USERS??20),seconds=Number(process.env.HTTP_LOAD_SECONDS??120),concurrency=Number(process.env.HTTP_LOAD_CONCURRENCY??12),thinkMs=100;
 if(![20,200,3000].includes(requested)||!Number.isSafeInteger(seconds)||seconds<10||seconds>1800||!Number.isSafeInteger(concurrency)||concurrency<2||concurrency>16)throw Error('Invalid bounded HTTP workload');
 const manifest=JSON.parse(fs.readFileSync(`.qa-work/fixture-${requested}.json`,'utf8')),directory=fs.realpathSync(manifest.directory),root=fs.realpathSync('.qa-work/fixtures'),server=JSON.parse(fs.readFileSync('.qa-work/database-delivery-qa-session.json','utf8'));
 if(!directory.startsWith(root+path.sep)||server.failure||fs.realpathSync(server.directory)!==directory||!manifest.http)throw Error('A matching prepared financial QA server is required');
 process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
 const db=new DatabaseSync(path.join(directory,'repaid.db'),{readOnly:true}),BASE='http://127.0.0.1:3002',run=randomBytes(8).toString('hex');
 const sources=manifest.http as {branches:Array<{id:number;email:string;password:string;customer:number;invoices:number[]}>;registeredUsers:number;baselinePayments:number;paymentAmount:number;invoiceAmount:number};
 if(sources.branches.length!==2)throw Error('Two financial branches required');
 const samples:Array<{method:string;route:string;status:number;ms:number}>=[],failures:Array<{code:string;status:number}>=[];let writes=0,replays=0,attempts=0,errorCount=0;
 const checks:string[]=[],expected=new Map<number,number>(sources.branches.map(b=>[b.id,0]));let measure=false;
 const check=(name:string,condition:boolean)=>{if(!condition)throw Error(name);checks.push(name);};
 async function request(cookie:string,route:string,method='GET',body?:unknown,key?:string){
  const start=performance.now();const response=await fetch(BASE+route,{method,headers:{cookie,origin:BASE,...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  const value=await response.json();if(measure)samples.push({method,route,status:response.status,ms:performance.now()-start});return {status:response.status,value};
 }
 async function login(email:string,password:string){const response=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{origin:BASE,'content-type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)});if(response.status!==200)throw Error('QA login failed');const cookie=response.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('QA session missing');return cookie;}
 function serverResources(){
  if(process.platform!=='win32')return {instrumented:false};
  const script="$ProgressPreference='SilentlyContinue'; $p=[System.Diagnostics.Process]::GetProcessById([int]$env:REPAID_LOAD_PID); @{cpuMs=$p.TotalProcessorTime.TotalMilliseconds;workingSet=$p.WorkingSet64;peakWorkingSet=$p.PeakWorkingSet64;started=$p.StartTime.ToUniversalTime().Ticks} | ConvertTo-Json -Compress";
  return {instrumented:true,...JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,REPAID_LOAD_PID:String(server.pid)}}))};
 }
 try{
  const owner=await login('owner@repaid.local','demo1234'),cashiers=await Promise.all(sources.branches.map(b=>login(b.email,b.password)));
  for(let index=0;index<2;index++){
   const other=sources.branches[1-index],denied=await request(cashiers[index],'/api/payments','POST',{invoice_id:other.invoices[0],amount:100,method:'cash'},'denied-'+run+'-'+index);
   check('Cashier cannot receive against another branch '+index,[403,404].includes(denied.status));
  }
  check('Denied operations change no payments',Number(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n)===sources.baselinePayments);
  const resourcesBefore=serverResources(),started=performance.now();measure=true;
  const backupTask=(async()=>{
   await new Promise(resolve=>setTimeout(resolve,seconds*500));
   const prepared=await request(owner,'/api/backup?mode=prepare','POST',{});
   check('Online backup prepares while financial writes continue',prepared.status===200&&/^\/api\/backup\?download=[a-f0-9]{48}$/.test(prepared.value.download_url));
   const response=await fetch(BASE+prepared.value.download_url,{headers:{cookie:owner},signal:AbortSignal.timeout(60000)});
   check('Prepared online backup downloads',response.status===200&&!!response.body);
   const {openPrivateFile}=await import('../src/lib/private-storage'),target=path.join(directory,'http-load-backup-'+run+'.db'),file=openPrivateFile(target),reader=response.body!.getReader();let ended=false;
   try{for(;;){const chunk=await reader.read();if(chunk.done){ended=true;break;}let offset=0;while(offset<chunk.value.length)offset+=fs.writeSync(file,chunk.value,offset,chunk.value.length-offset);}fs.fsyncSync(file);}
   finally{if(!ended)await reader.cancel().catch(()=>{});reader.releaseLock();fs.closeSync(file);}
   return target;
  })();
  // Attach rejection handling immediately; preserve failures for final acceptance.
  const backupOutcome=backupTask.then(value=>({value,error:null as string|null}),error=>({value:null,error:error instanceof Error?error.message:'backup_failed'}));
  await Promise.all(Array.from({length:concurrency},async(_,lane)=>{
   const branchIndex=lane%2,branch=sources.branches[branchIndex],invoice=branch.invoices[Math.floor(lane/2)];
   for(let operation=0;performance.now()-started<seconds*1000;operation++){
    if(++attempts>100000)throw Error('Bounded HTTP request limit exceeded');
    try{
     if(operation%5===0){
      const body={invoice_id:invoice,amount:sources.paymentAmount,method:'cash',reference:`HTTP-${run}-${lane}-${operation}`},key=`http-${run}-${lane}-${operation}`;
      const first=await request(cashiers[branchIndex],'/api/payments','POST',body,key);
      if(first.status!==200||!Number.isSafeInteger(first.value.id))throw Object.assign(Error('receipt_failed'),{status:first.status,code:first.value.code??'receipt_failed'});
      writes++;expected.set(branch.id,expected.get(branch.id)!+1);
      if(operation%10===0){const again=await request(cashiers[branchIndex],'/api/payments','POST',body,key);if(again.status!==200||again.value.id!==first.value.id)throw Error('durable_replay_failed');replays++;}
     }else{
      const routes=['/api/repairs?limit=50','/api/customers?limit=25','/api/payments?limit=25','/api/accounting?view=trial&branch_id='+branch.id],route=routes[(operation-1)%4],result=await request(owner+'; repaid_branch=all',route);
      if(result.status!==200)throw Object.assign(Error('read_failed'),{status:result.status,code:result.value.code??'read_failed'});
     }
    }catch(error){errorCount++;const item=error as {code?:string;status?:number;message?:string};if(failures.length<100)failures.push({status:item.status??0,code:/^[a-zA-Z_0-9]{1,60}$/.test(item.code??'')?item.code!:item.message==='durable_replay_failed'?'durable_replay_failed':'request_failed'});}
    await new Promise(resolve=>setTimeout(resolve,thinkMs));
   }
  }));
  const backup=await backupOutcome;measure=false;const elapsed=(performance.now()-started)/1000,resourcesAfter=serverResources();
  check('Online backup has no uncertain/failure outcome',backup.error===null&&!!backup.value);
  const {verifyLedger}=await import('../src/lib/accounting'),{verifySqliteFile,openStandaloneSqlite,fileSha256}=await import('../src/lib/backup');
  const backupRecord=db.prepare("SELECT sha256,bytes,state FROM backup_downloads WHERE user_id=(SELECT id FROM users WHERE email='owner@repaid.local') ORDER BY expires_at DESC LIMIT 1").get();
  check('Downloaded snapshot exactly matches independently recorded source bytes',backupRecord?.sha256===await fileSha256(backup.value!)&&backupRecord?.bytes===fs.statSync(backup.value!).size&&backupRecord?.state==='streamed');
  function reconcile(connection:DatabaseSync,final:boolean){
   for(const branch of sources.branches){const payments=Number(connection.prepare('SELECT COUNT(*) n FROM payments WHERE branch_id=?').get(branch.id)!.n),cash=payments*sources.paymentAmount,billed=branch.invoices.length*sources.invoiceAmount;
    const balances=new Map(connection.prepare("SELECT l.account_code,SUM(l.debit-l.credit) amount FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.branch_id=? AND j.state IN ('posted','reversed') GROUP BY l.account_code").all(branch.id).map(row=>[String(row.account_code),Number(row.amount)]));
    check((final?'Final':'Snapshot')+' exact cash/AR/revenue branch '+branch.id,balances.get('1000')===cash&&balances.get('1100')===billed-cash&&balances.get('4010')===-billed);
    check((final?'Final':'Snapshot')+' operational invoices reconcile branch '+branch.id,Number(connection.prepare('SELECT SUM(total-paid) amount FROM effective_invoices WHERE branch_id=?').get(branch.id)!.amount)===billed-cash);
    if(final)check('No duplicated or missing branch receipt '+branch.id,payments===expected.get(branch.id));
   }
   check((final?'Final':'Snapshot')+' immutable journal/source proof is valid',verifyLedger(connection).valid);
  }
  verifySqliteFile(backup.value!);const snapshot=openStandaloneSqlite(backup.value!);try{reconcile(snapshot,false);}finally{snapshot.close();}reconcile(db,true);
  const consolidated=new Map(db.prepare("SELECT l.account_code,SUM(l.debit-l.credit) amount FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.state IN ('posted','reversed') GROUP BY l.account_code").all().map(row=>[String(row.account_code),Number(row.amount)]));
  const billed=sources.branches.reduce((sum,b)=>sum+b.invoices.length*sources.invoiceAmount,0),cash=writes*sources.paymentAmount;
  check('Consolidated cash/receivable/revenue exactly equal the two scoped financial branches',consolidated.get('1000')===cash&&consolidated.get('1100')===billed-cash&&consolidated.get('4010')===-billed);
  check('Every completed invoice and payment has exactly one posted journal',Number(db.prepare("SELECT COUNT(*) n FROM accounting_journals WHERE state='posted'").get()!.n)===16+writes);
  for(let index=0;index<2;index++){
   const own=sources.branches[index],other=sources.branches[1-index];
   const staff=await request(cashiers[index]+'; repaid_branch='+other.id,'/api/payments?limit=25');check('Staff cookie manipulation cannot change branch '+index,staff.status===200&&staff.value.total===expected.get(own.id)&&staff.value.payments.every((p:{branch_id:number})=>p.branch_id===own.id));
   const manager=await request(owner+'; repaid_branch='+own.id,'/api/payments?limit=25');check('Manager can independently inspect branch '+index,manager.status===200&&manager.value.total===expected.get(own.id));
  }
  check('Exact total receipt count includes one source per successful write',Number(db.prepare('SELECT COUNT(*) n FROM payments').get()!.n)===sources.baselinePayments+writes);
  const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b),percentile=(p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
  const errors=errorCount;
  const result={profile:'one compiled web process; two independently scoped financial branches; posted service invoices and cash receipts; real online backup',registeredUsers:sources.registeredUsers,existingRepairs:Number(db.prepare('SELECT COUNT(*) n FROM repair_tickets').get()!.n),concurrency,thinkMs,durationSeconds:seconds,elapsedSeconds:elapsed,requests:samples.length,requestsPerSecond:samples.length/elapsed,writes,replays,errors,failures,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),resourcesBefore,resourcesAfter,checks,backupIndependentlyVerified:true,productionCapacityCertified:false};
  fs.writeFileSync(`.qa-work/database-http-load-${requested}.json`,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
  if(errors||result.p95Ms>1000||result.p99Ms>2000)process.exitCode=1;
 }finally{db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'HTTP database workload failed');process.exitCode=1;});
