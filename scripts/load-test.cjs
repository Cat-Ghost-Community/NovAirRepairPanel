// Read-only workload. Run only against an explicitly selected test deployment.
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const base=process.env.LOAD_BASE;
if(!base || process.env.LOAD_TEST_MODE!=='1') throw new Error('Set LOAD_TEST_MODE=1 and LOAD_BASE to an isolated test deployment.');
const concurrency=Number(process.env.LOAD_CONCURRENCY||10);
const requests=Number(process.env.LOAD_REQUESTS||200);
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>200||!Number.isInteger(requests)||requests<1||requests>100000) throw new Error('Invalid workload size');
const routes=['/api/health','/api/repairs?limit=50','/api/customers?q=test','/api/search?q=test','/api/invoices'];
(async()=>{
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:new URL(base).origin},body:JSON.stringify({email:process.env.LOAD_EMAIL||'owner@repaid.local',password:process.env.LOAD_PASSWORD||'demo1234'}),signal:AbortSignal.timeout(30000)});
  if(!login.ok) throw new Error(`Login failed: ${login.status}`);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  if(!cookie) throw new Error('No session cookie');
  const samples=[];let next=0;const started=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<requests){const index=next++;const route=routes[index%routes.length];const start=performance.now();let status=0;
      try {const response=await fetch(base+route,{headers:{cookie},redirect:'manual',signal:AbortSignal.timeout(30000)});status=response.status;await response.arrayBuffer();}catch{}
      samples.push({route,status,ms:performance.now()-start});
    }
  }));
  const elapsedMs=performance.now()-started;const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b);
  const percentile=p=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
  const errors=samples.filter(s=>s.status<200||s.status>=300);
  const result={timestamp:new Date().toISOString(),base,registeredUsers:process.env.LOAD_REGISTERED_USERS?Number(process.env.LOAD_REGISTERED_USERS):'not measured',concurrency,requests,elapsedMs,requestsPerSecond:requests/(elapsedMs/1000),p50Ms:percentile(.50),p95Ms:percentile(.95),p99Ms:percentile(.99),errors:errors.length,errorRate:errors.length/requests,byStatus:samples.reduce((counts,s)=>(counts[s.status]=(counts[s.status]||0)+1,counts),{}),serverCpuMemory:'not instrumented; no production capacity claim'};
  fs.mkdirSync('.freebuff',{recursive:true});fs.writeFileSync(process.env.LOAD_OUTPUT||'.freebuff/load-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  if(errors.length) process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
