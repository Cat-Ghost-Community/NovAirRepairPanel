import {after,before,describe,it} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {operationHash,operationKey} from '../src/lib/operation-identity';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-operation-identity-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,durable:typeof import('../src/lib/idempotency').durableOperation;
before(async()=>{const source=await import('../src/lib/db/schema');assert.equal(source.DB_PATH,path.join(directory,'repaid.db'));db=source.getDb();durable=(await import('../src/lib/idempotency')).durableOperation;db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO'); INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','o@test','x','owner',1),(2,'Staff','staff@test','x','accountant',1)");});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('historical operation hashes and branch-owned durable replays',()=>{
  it('matches an independently computed canonical hash and preserves key ordering/null semantics',()=>{
    // Python hashlib + sorted compact UTF-8 JSON; not computed by this implementation.
    assert.equal(operationHash({z:[1,null,'تست'],a:{b:2}}),'51f8c4289c51eeb2d4443091d7afdba634c083d1120c3c888a8d92a9e89250f2');
    assert.equal(operationHash({z:undefined,a:1}),operationHash({a:1,z:null}));
    for(const value of [NaN,Infinity,-Infinity])assert.throws(()=>operationHash({amount:value}),error=>(error as {status:number}).status===400);
    for(const key of ['',null,'short','unsafe key'])assert.throws(()=>operationKey(key),error=>(error as {status:number}).status===400);
  });
  it('preserves a business-wide identity but refuses its result after changing the branch context',()=>{
    const options={actorId:2,branchId:1,operation:'branch_customer',key:'branch-owned-0001',scope:'business' as const,payload:{name:'Customer'}};
    const work=()=>({id:Number(db.prepare("INSERT INTO customers(first_name,branch_id) VALUES('Customer',1)").run().lastInsertRowid)});
    const first=durable(db,options,work);assert.deepEqual(durable(db,options,work),first);
    db.exec('UPDATE users SET branch_id=2 WHERE id=2');
    assert.throws(()=>durable(db,{...options,branchId:2},work),error=>(error as {status:number}).status===409);
    assert.throws(()=>durable(db,{...options,payload:{name:'Changed'}},work),error=>(error as {status:number}).status===409);
    assert.equal(db.prepare('SELECT count(*) n FROM customers').get()!.n,1);assert.equal(db.prepare('SELECT branch_id FROM operation_receipts').get()!.branch_id,1);
    const company={...options,actorId:1,key:'company-wide-0001'};assert.deepEqual(durable(db,company,()=>({document:77})),durable(db,{...company,branchId:2},()=>{throw new Error('Duplicate company operation');}));
  });
  it('keeps explicit branch identities independent and rolls failed result persistence back with business work',()=>{
    const options={actorId:1,branchId:1,operation:'branch_independent',key:'branch-owned-0002',payload:{name:'Other'}};
    for(const branchId of [1,2])durable(db,{...options,branchId},()=>({id:Number(db.prepare("INSERT INTO customers(first_name,branch_id) VALUES('Other',?)").run(branchId).lastInsertRowid)}));
    const before=db.prepare('SELECT count(*) n FROM customers').get()!.n;
    assert.throws(()=>durable(db,{...options,key:'failed-result-0001'},()=>{db.prepare("INSERT INTO customers(first_name,branch_id) VALUES('Must roll back',1)").run();return {unsupported:BigInt(1)};}),/BigInt/);
    assert.equal(db.prepare('SELECT count(*) n FROM customers').get()!.n,before);assert.equal(db.prepare("SELECT count(*) n FROM operation_receipts WHERE operation_key='failed-result-0001'").get()!.n,0);
  });
  it('enforces the transferred-staff boundary through the real API and preserves seamless company-manager retries',async()=>{
    const {NextRequest}=await import('next/server'),{createSession}=await import('../src/lib/auth'),{POST}=await import('../src/app/api/parts/route');
    db.exec("UPDATE users SET branch_id=1 WHERE id=2; INSERT INTO user_permissions(user_id,perm,effect) VALUES(2,'inventory.edit','allow')");
    const staff=createSession(2),owner=createSession(1),body={name:'Persisted API product',purchase_price:0,price:0,opening_qty:0};
    const request=(token:string,branch:number,key:string)=>new NextRequest('http://app.test/api/parts',{method:'POST',headers:{origin:'http://app.test','content-type':'application/json','idempotency-key':key,cookie:`repaid_session=${token}; repaid_branch=${branch}`},body:JSON.stringify(body)});
    const before=db.prepare('SELECT count(*) n FROM parts').get()!.n;
    const first=await POST(request(staff,1,'api-staff-replay-0001'));assert.equal(first.status,200);const result=await first.json();
    assert.deepEqual(await (await POST(request(staff,1,'api-staff-replay-0001'))).json(),result);
    db.exec('UPDATE users SET branch_id=2 WHERE id=2');const denied=await POST(request(staff,2,'api-staff-replay-0001'));assert.equal(denied.status,409);assert.equal(db.prepare('SELECT count(*) n FROM parts').get()!.n,Number(before)+1);
    const company=await POST(request(owner,1,'api-owner-replay-0001'));assert.equal(company.status,200);const companyResult=await company.json();const replay=await POST(request(owner,2,'api-owner-replay-0001'));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),companyResult);assert.equal(db.prepare('SELECT count(*) n FROM parts').get()!.n,Number(before)+2);
  });
});
