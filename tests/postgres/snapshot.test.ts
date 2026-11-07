import {describe,it,before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {createPostgresDatabase} from '../../src/lib/db/postgres';import {importSqliteSnapshot,quoteIdentifier,verifyPostgresSnapshot} from '../../src/lib/db/postgres-snapshot';
import {prepareRecoveryCopy} from '../../src/lib/recovery-copy';import {fileSha256} from '../../src/lib/backup';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';if(!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw new Error('Disposable PostgreSQL test database required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-pg-copy-')),source=path.join(directory,'source.db');
before(()=>{const sqlite=new DatabaseSync(source);sqlite.exec("PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY,name TEXT NOT NULL,evidence TEXT);CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id),qty REAL,payload BLOB);CREATE TABLE fractional(id INTEGER PRIMARY KEY,qty INTEGER);CREATE TABLE no_key(value TEXT);INSERT INTO parent VALUES(1,'فارسی Mixed','{ \"b\":2, \"a\":1 }');INSERT INTO child VALUES(4,1,0.333333,X'000102FF');INSERT INTO fractional VALUES(1,1.25);INSERT INTO no_key VALUES('second'),('first');");sqlite.close();});after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('lossless isolated SQLite to PostgreSQL data rehearsal',()=>{
 it('preserves legitimate recovery provenance rather than rejecting application-owned migration evidence',async()=>{
  const input=path.join(directory,'recovery-source.db'),output=path.join(directory,'recovery-ready.db'),sqlite=new DatabaseSync(input);sqlite.exec("CREATE TABLE evidence(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);INSERT INTO evidence VALUES(1,'preserved history')");sqlite.close();await prepareRecoveryCopy({source:input,destination:output,expectedSha256:await fileSha256(input),reason:'verify recovery provenance survives future PostgreSQL migration'});const result=await importSqliteSnapshot(db,output);assert.equal(result.tables.find(row=>row.table==='_repaid_recovery_activation')?.rows,1);assert.equal((await verifyPostgresSnapshot(db,result)).verified,true);
 });
 it('preserves exact IDs, text/JSON evidence, blobs, fractions, keys and row counts',async()=>{
  const result=await importSqliteSnapshot(db,source);assert.equal(result.verified,true);assert.equal(result.application_ready,false);assert.equal(result.tables.length,4);assert.equal(result.tables.find(t=>t.table==='fractional')!.compatibilityWarnings.length,1);
  assert.equal((await verifyPostgresSnapshot(db,result)).verified,true);
  const schema=quoteIdentifier(result.schema);assert.equal((await db.query(`SELECT evidence FROM ${schema}.parent WHERE id=1`)).rows[0].evidence,'{ "b":2, "a":1 }');assert.equal((await db.query(`SELECT payload FROM ${schema}.child WHERE id=4`)).rows[0].payload.toString('hex'),'000102ff');
  assert.equal((await db.query(`SELECT qty FROM ${schema}.fractional`)).rows[0].qty,1.25);await assert.rejects(()=>db.query(`INSERT INTO ${schema}.child(id,parent_id) VALUES(8,900)`),(error:unknown)=>(error as {code:string}).code==='23503');
  assert.equal((await db.query(`INSERT INTO ${schema}.child(parent_id,qty) VALUES(1,0.5) RETURNING id`)).rows[0].id,'5');
  await assert.rejects(()=>verifyPostgresSnapshot(db,result),/content changed/);
 });
 it('rolls the entire destination back for unsupported text without changing the source',async()=>{
  const invalid=path.join(directory,'invalid.db'),sqlite=new DatabaseSync(invalid);sqlite.exec('CREATE TABLE rejected(id INTEGER PRIMARY KEY,evidence TEXT)');sqlite.prepare('INSERT INTO rejected VALUES(1,?)').run('bad\0text');sqlite.close();
  const before=(await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname LIKE 'repaid_snapshot_%'")).rows[0].n;await assert.rejects(()=>importSqliteSnapshot(db,invalid),/encoding/);
  assert.equal((await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname LIKE 'repaid_snapshot_%'")).rows[0].n,before);const intact=new DatabaseSync(invalid,{readOnly:true});assert.equal(intact.prepare('SELECT evidence FROM rejected').get()!.evidence,'bad\0text');intact.close();
 });
 it('rejects incomplete external object recovery before creating a destination schema',async()=>{
  const input=path.join(directory,'missing-object.db'),sqlite=new DatabaseSync(input);sqlite.exec('CREATE TABLE repair_attachments(id INTEGER PRIMARY KEY,size INTEGER,object_key TEXT,object_sha256 TEXT)');sqlite.prepare('INSERT INTO repair_attachments VALUES(1,7,?,?)').run('a'.repeat(64),'a'.repeat(64));sqlite.close();const old=process.env.REPAID_OBJECT_DIR;delete process.env.REPAID_OBJECT_DIR;
  const before=(await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname LIKE 'repaid_snapshot_%'")).rows[0].n;try{await assert.rejects(()=>importSqliteSnapshot(db,input),/not configured/);}finally{if(old==null)delete process.env.REPAID_OBJECT_DIR;else process.env.REPAID_OBJECT_DIR=old;}assert.equal((await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname LIKE 'repaid_snapshot_%'")).rows[0].n,before);
 });
 it('rolls back real target writes if the retained source file changes before commit',async()=>{
  const input=path.join(directory,'changing-source.db'),sqlite=new DatabaseSync(input);sqlite.exec("CREATE TABLE evidence(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO evidence VALUES(1,'original')");sqlite.close();const before=(await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname LIKE 'repaid_snapshot_%'")).rows[0].n,query=db.query;
  // Fault injection delegates every statement to real PostgreSQL; no results or financial services are mocked.
  db.query=(async(text:string,values:unknown[]=[])=>{const result=await query(text,values);if(text.startsWith('INSERT INTO')&&text.includes('_repaid_snapshot_manifest'))fs.appendFileSync(input,Buffer.alloc(512));return result;}) as typeof db.query;
  try{await assert.rejects(()=>importSqliteSnapshot(db,input),/Source snapshot/);}finally{db.query=query;}
  assert.equal((await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname LIKE 'repaid_snapshot_%'")).rows[0].n,before);
 });
});
