import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';import {GROWTH_INDEXES} from '../src/lib/db/growth-indexes';
async function main(){if(process.env.REPAID_DATABASE_PROFILE!=='1')throw new Error('Disposable profile mode must be explicit');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-db-profile-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';const {getDb}=await import('../src/lib/db/schema'),db=getDb();
 try{db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO customers(id,first_name,branch_id) VALUES(1,'Synthetic workload',1);INSERT INTO devices(id,customer_id,type) VALUES(1,1,'phone');INSERT INTO repair_statuses(id,name) VALUES(1,'Received');");
  for(const sql of GROWTH_INDEXES){const name=/INDEX IF NOT EXISTS (\w+)/.exec(sql)![1];db.exec('DROP INDEX '+name);}
  db.exec('BEGIN');const insert=db.prepare('INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,created_at) VALUES(?,?,1,1,1,?)');for(let i=0;i<100000;i++)insert.run('PROFILE-'+i,i%2+1,'2026-10-'+String(i%28+1).padStart(2,'0')+' 00:00:00');db.exec('COMMIT');
  const sql='SELECT id,number FROM repair_tickets WHERE branch_id=? ORDER BY created_at DESC,id DESC LIMIT 50';
  const sample=()=>{const query=db.prepare(sql),samples:number[]=[];let rows:unknown;for(let i=0;i<100;i++){const start=performance.now();rows=query.all(1);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return {p50Ms:samples[49],p95Ms:samples[94],p99Ms:samples[98],plan:db.prepare('EXPLAIN QUERY PLAN '+sql).all(1).map(row=>row.detail),rows};};
  const before=sample(),started=performance.now();for(const statement of GROWTH_INDEXES)db.exec(statement);const indexingMs=performance.now()-started,after=sample();if(JSON.stringify(before.rows)!==JSON.stringify(after.rows))throw new Error('Index changed history results');
  const {rows:oldRows,...baseline}=before,{rows:newRows,...optimized}=after;void oldRows;void newRows;
  const result={environment:'local SQLite WAL, synthetic isolated 100000-ticket two-branch history, 100 read samples, not production capacity',baseline,optimized,indexingMs,identicalResults:true};console.log(JSON.stringify(result));
 }finally{db.close();if(path.dirname(fs.realpathSync(directory))!==fs.realpathSync(os.tmpdir())||!path.basename(directory).startsWith('repaid-db-profile-'))throw new Error('Unsafe profile cleanup');fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Database profile failed');process.exitCode=1;});
