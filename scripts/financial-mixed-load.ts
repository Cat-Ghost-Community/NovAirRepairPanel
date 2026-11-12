/** Reproducible local mixed read/write workload. Always creates isolated
 * fixtures; never accepts a production database. This is not a capacity SLA. */
import fs from "node:fs";
import path from 'node:path';
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { getDb } from "../src/lib/db/schema";
import { durableOperation } from "../src/lib/idempotency";
import { createCustomerReceipt } from "../src/lib/customer-payments";
import { operationalFinance } from "../src/lib/financial-report";
import type { Session } from "../src/lib/auth";

async function main() {
  if (process.env.FINANCIAL_LOAD_MODE !== "1") throw new Error("Set FINANCIAL_LOAD_MODE=1 for disposable fixtures only");
  if (process.argv[2] === "worker") {
    const dataRoot=fs.realpathSync(process.env.REPAID_DATA_DIR??''),fixtureRoot=fs.realpathSync('.qa-work/fixtures');if(!dataRoot.startsWith(fixtureRoot+path.sep))throw new Error('Load workers require an isolated fixture directory');
    const db = getDb();
    const worker = Number(process.argv[3]);
    const operations = Number(process.argv[4]);
    const user = db.prepare("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE role='owner' ORDER BY id LIMIT 1").get() as Session["user"];
    const customer = Number(db.prepare("SELECT id FROM customers ORDER BY id LIMIT 1").get()!.id);
    const branch=worker%2+1,duration=Number(process.env.FINANCIAL_LOAD_DURATION_SECONDS??0);if(!Number.isSafeInteger(duration)||duration<0||duration>1800)throw new Error('Invalid sustained workload duration');
    const invoice = Number(db.prepare("INSERT INTO invoices(number,type,customer_id,branch_id,status,total) VALUES(?,'sale',?,?,'issued',1000000000000)")
      .run(`FIN-LOAD-${worker}`, customer,branch).lastInsertRowid);
    const latencies: number[] = [];
    let errors = 0;
    let writes = 0;
    let retries = 0;
    const started=performance.now(),cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss,peakWalBytes=0;const errorCodes:Record<string,number>={};
    const failures:Array<{operation:number;kind:string;code:string;ms:number;origin:string}> = [];
    const current=new Date().toISOString(),year=Number(current.slice(0,4));
    for (let operation = 0; duration?performance.now()-started<duration*1000:operation<operations; operation++) {
      if(operation>=200000)throw new Error('Bounded workload operation limit reached before duration elapsed');
      const start = performance.now();
      try {
        if (operation % 3 === 0) {
          const input = { invoice_id: invoice, amount: 100, method: "cash" };
          const options = { actorId: user.id, branchId: branch, operation: "load-receipt", key: `load-${worker}-${operation}`, payload: input };
          const first = durableOperation(db, options, () => createCustomerReceipt(db, { user }, input, branch));
          writes++;
          if (operation % 6 === 0) {
            const second = durableOperation(db, options, () => createCustomerReceipt(db, { user }, input, branch));
            if (first.id !== second.id) throw new Error("Duplicate load receipt");
            retries++;
          }
        } else operationalFinance(db, branch, `${year}-01-01`, `${year+1}-01-01`,current.slice(0,7)+'-01');
      } catch (failure) { errors++;const detail=failure as {code?:string;errcode?:number;stack?:string},raw=detail.code??'DOMAIN_ERROR',code=(/^[A-Z0-9_]{1,40}$/.test(raw)?raw:'UNKNOWN')+(Number.isSafeInteger(detail.errcode)?'_'+detail.errcode:'');errorCodes[code]=(errorCodes[code]??0)+1;
        if(failures.length<100)failures.push({operation,kind:operation%3===0?'receipt':'report',code,ms:performance.now()-start,origin:detail.stack?.match(/src[/\\]lib[/\\][^\s():]+:\d+:\d+/)?.[0].replaceAll('\\','/')??'unknown'});
      }
      latencies.push(performance.now() - start);
      if(operation%10===0){peakRss=Math.max(peakRss,process.memoryUsage().rss);const wal=path.join(dataRoot,'repaid.db-wal');if(fs.existsSync(wal))peakWalBytes=Math.max(peakWalBytes,fs.statSync(wal).size);}
    }
    const payment = db.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount FROM payments WHERE invoice_id=?").get(invoice)!;
    const cached = db.prepare("SELECT paid FROM invoices WHERE id=?").get(invoice)!;
    const consistent = payment.count === writes && payment.amount === writes * 100 && cached.paid === writes * 100;
    db.close();
    process.stdout.write(JSON.stringify({ latencies, errors, errorCodes,failures,writes, retries, consistent,branch,durationSeconds:(performance.now()-started)/1000,cpu:process.cpuUsage(cpu),peakRssBytes:peakRss,peakWalBytes }));
    return;
  }
  const results = [];
  const selected=(process.env.FINANCIAL_LOAD_COUNTS??'20,200,3000').split(',').map(Number);if(!selected.length||selected.some(value=>![20,200,3000].includes(value))||new Set(selected).size!==selected.length)throw new Error('Invalid registered-user workload selection');
  const requestedConcurrency=process.env.FINANCIAL_LOAD_CONCURRENCY==null?null:Number(process.env.FINANCIAL_LOAD_CONCURRENCY);if(requestedConcurrency!=null&&(!Number.isSafeInteger(requestedConcurrency)||requestedConcurrency<1||requestedConcurrency>16))throw new Error('Invalid workload concurrency');
  for (const [registered, defaultConcurrency, operations] of [[20, 2, 20], [200, 4, 50], [3000, 4, 100]].filter(row=>selected.includes(row[0]))) {
    const concurrency=requestedConcurrency??defaultConcurrency;
    const prepared = spawnSync(process.execPath, ["--import", "tsx", "scripts/test-fixture.ts"], {
      env: { ...process.env, LOAD_TEST_MODE: "1", LOAD_REGISTERED_USERS: String(registered) }, encoding: "utf8", windowsHide: true });
    if (prepared.status !== 0) throw new Error(prepared.stderr);
    const fixture = JSON.parse(fs.readFileSync(`.qa-work/fixture-${registered}.json`, "utf8"));
    const start = performance.now();
    const workers = await Promise.all(Array.from({ length: concurrency }, (_, worker) => new Promise<{
      latencies: number[]; errors: number; errorCodes:Record<string,number>;failures:Array<{operation:number;kind:string;code:string;ms:number;origin:string}>;writes: number; retries: number; consistent: boolean;branch:number;durationSeconds:number;cpu:{user:number;system:number};peakRssBytes:number;peakWalBytes:number;
    }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/financial-mixed-load.ts", "worker", String(worker), String(operations)],
        { env: { ...process.env, REPAID_DATA_DIR: fixture.directory }, windowsHide: true });
      let output = "";
      let error = "";
      child.stdout.on("data", data => { output += data; });
      child.stderr.on("data", data => { error += data; });
      child.on("error", reject);
      child.on("exit", code => {
        if (code) reject(new Error(error));
        else { try { resolve(JSON.parse(output)); } catch (failure) { reject(failure); } }
      });
    })));
    const seconds = (performance.now() - start) / 1000;
    const times = workers.flatMap(worker => worker.latencies).sort((a, b) => a - b);
    const percentile = (value: number) => Number(times[Math.max(0, Math.ceil(times.length * value) - 1)].toFixed(2));
    const errors = workers.reduce((sum, worker) => sum + worker.errors, 0);
    const consistent = workers.every(worker => worker.consistent);
    results.push({ registered, concurrency,operations: times.length, writes: workers.reduce((sum, worker) => sum + worker.writes, 0),
      replayChecks: workers.reduce((sum, worker) => sum + worker.retries, 0), errors, consistent,
      elapsedSeconds:seconds,operationsPerSecond: Number((times.length / seconds).toFixed(2)), p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
      cpuUserMs:workers.reduce((sum,w)=>sum+w.cpu.user/1000,0),cpuSystemMs:workers.reduce((sum,w)=>sum+w.cpu.system/1000,0),sumWorkerPeakRssBytes:workers.reduce((sum,w)=>sum+w.peakRssBytes,0),peakWalBytes:Math.max(...workers.map(w=>w.peakWalBytes)),branches:[...new Set(workers.map(w=>w.branch))],errorCodes:workers.map(w=>w.errorCodes),failures:workers.map(w=>w.failures),freeDiskBytes:Number(fs.statfsSync(fixture.directory,{bigint:true}).bavail*fs.statfsSync(fixture.directory,{bigint:true}).bsize) });
    if (errors || !consistent) process.exitCode = 1;
  }
  console.log(JSON.stringify({ environment: "local Windows, Node SQLite WAL, direct services, no HTTP or external provider",recognition:'Source receipts/allocations and operational reports; unapproved accounting events remain pending. This is not full ledger or production capacity certification.', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
