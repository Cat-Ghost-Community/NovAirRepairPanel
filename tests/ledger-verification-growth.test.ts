import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {atomic} from '../src/lib/db/transaction';

it('checks all persisted source evidence while bounding corrupt-history diagnostics without hiding failures',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-proof-growth-'));
 process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
 const {getDb}=await import('../src/lib/db/schema'),db=getDb();
 try{
  db.exec("INSERT INTO branches(id,name,code) VALUES(1,'Fixture','FIXTURE');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Fixture','fixture@test','x','owner',1)");
  // Deliberately damaged offline evidence, not a production mutation service.
  // Every identity/reference is valid; independently wrong hashes must all be counted.
  atomic(db,()=>{const put=db.prepare("INSERT INTO accounting_events(event_key,source_type,source_id,branch_id,event_type,payload_json,payload_hash,actor_id) VALUES(?,'expense',?,1,'recognition',?,?,1)");for(let i=1;i<=1400;i++)put.run(`expense:${i}:recognition`,String(i),JSON.stringify({document:{id:i,branch_id:1}}),'0'.repeat(64));});
  const result=(await import('../src/lib/accounting')).verifyLedger(db);
  assert.equal(result.valid,false);assert.equal(result.error_count,1400);assert.equal(result.errors.length,1000);assert.equal(result.errors_truncated,true);
  assert.ok(result.errors.every(error=>error.reason==='source_event_digest'));assert.equal(result.count,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_events').get()!.n,1400);
 }finally{
  db.close();const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-proof-growth-'));fs.rmSync(resolved,{recursive:true,force:true});
 }
});
