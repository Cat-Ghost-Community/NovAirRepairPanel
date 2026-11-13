import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {DatabaseSync}from 'node:sqlite';import {createHash}from 'node:crypto';
import {creditDataFingerprint}from '../src/lib/legacy-credit-migration';
const filename=path.resolve(process.argv[2]??'');if(!filename.startsWith(path.resolve(os.tmpdir())+path.sep)||!filename.includes(path.sep+'repaid-credit-migration-'))throw new Error('A protected rehearsal manifest is required');
const manifest=JSON.parse(fs.readFileSync(filename,'utf8')),digest=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(digest(manifest.prepared)!==manifest.prepared_sha256||digest(manifest.backup)!==manifest.backup_sha256)throw new Error('Backup or prepared artifact digest changed');
for(const file of [manifest.source,manifest.prepared]){const db=new DatabaseSync(file,{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length||creditDataFingerprint(db,manifest.projection)!==manifest.sourceFingerprint)throw new Error('Current original changed or prepared records differ; do not replace the live database');}finally{db.close();}}
console.log('Original records and prepared artifact match the reviewed backup. Production replacement still requires legitimate approval and a stopped writer.');
