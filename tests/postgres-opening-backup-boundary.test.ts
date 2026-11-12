import {after, it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPostgresOpeningBackup} from '../src/lib/db/postgres-opening-backup';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-opening-boundary-'));
const configured=path.join(directory,'configured'),external=path.join(directory,'external');
fs.mkdirSync(configured);fs.mkdirSync(external);
const previous=process.env.REPAID_PG_OPENING_BACKUP_DIR;
process.env.REPAID_PG_OPENING_BACKUP_DIR=configured;
const name='opening-1-'+'a'.repeat(24)+'.dump',content=Buffer.from('Synthetic backup hash fixture');
const digest=createHash('sha256').update(content).digest('hex');
fs.writeFileSync(path.join(configured,name),content);
fs.writeFileSync(path.join(external,name),content);

after(()=>{
 if(previous===undefined)delete process.env.REPAID_PG_OPENING_BACKUP_DIR;
 else process.env.REPAID_PG_OPENING_BACKUP_DIR=previous;
 fs.rmSync(directory,{recursive:true,force:true});
});

it('verifies matching evidence only inside the configured private backup directory',async()=>{
 assert.equal(await verifyPostgresOpeningBackup(path.join(configured,name),digest),true);
 await assert.rejects(()=>verifyPostgresOpeningBackup(path.join(external,name),digest),/outside its private evidence boundary/);
});

it('rejects changed evidence even when its path remains inside the configured directory',async()=>{
 const changed=path.join(configured,'opening-2-'+'b'.repeat(24)+'.dump');
 fs.writeFileSync(changed,Buffer.concat([content,Buffer.from('changed')]));
 await assert.rejects(()=>verifyPostgresOpeningBackup(changed,digest),/changed or is incomplete/);
});
