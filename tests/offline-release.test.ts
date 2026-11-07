import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {pack,verify}=createRequire(import.meta.url)('../scripts/package-offline.cjs') as {pack:(source:string,destination:string)=>{manifest_sha256:string};verify:(root:string,digest?:string)=>unknown};
it('prepared releases preserve reviewed bytes, bind the build lock and reject tampering, added private files and incompatible hosts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-release-')),source=path.join(root,'source'),dest=path.join(root,'release');for(const dir of ['.next/standalone','.next/static','public'])fs.mkdirSync(path.join(source,dir),{recursive:true});fs.writeFileSync(path.join(source,'.next/standalone/server.js'),'// fixture server bytes');fs.writeFileSync(path.join(source,'.next/static/chunk.js'),'// fixture hashed asset');fs.writeFileSync(path.join(source,'public/icon.svg'),'<svg/>');fs.writeFileSync(path.join(source,'package-lock.json'),'{}');
 fs.writeFileSync(path.join(source,'.next/standalone/package.json'),'{}');fs.mkdirSync(path.join(source,'.database-tools'));for(const name of ['deployment','backup-plain','backup','scheduled','restore','prepare-recovery','recovery-set','snapshot','rehearse','verify','port-ledger','migrate-attachments','migrate-postgres'])fs.writeFileSync(path.join(source,'.database-tools',name+'.cjs'),'// isolated packaging fixture');
 const alias=path.join(root,'source-alias');fs.symlinkSync(source,alias,process.platform==='win32'?'junction':'dir');assert.throws(()=>pack(source,path.join(alias,'nested-release')),/outside application source/);assert.equal(fs.existsSync(path.join(source,'nested-release')),false);
 const result=pack(source,dest);assert.doesNotThrow(()=>verify(dest,result.manifest_sha256));assert.throws(()=>pack(source,dest));
 fs.mkdirSync(path.join(dest,'.next/server/route-cache'),{recursive:true});fs.writeFileSync(path.join(dest,'.next/server/route-cache/favicon.body'),'legitimate mutable cache');assert.doesNotThrow(()=>verify(dest,result.manifest_sha256));
 fs.appendFileSync(path.join(dest,'server.js'),'tamper');assert.throws(()=>verify(dest,result.manifest_sha256),/modified/);fs.writeFileSync(path.join(dest,'server.js'),'// fixture server bytes');fs.writeFileSync(path.join(dest,'.env'),'PRIVATE=fixture');assert.throws(()=>verify(dest),/Private/);fs.unlinkSync(path.join(dest,'.env'));const manifest=JSON.parse(fs.readFileSync(path.join(dest,'RELEASE-MANIFEST.json'),'utf8'));manifest.arch='incompatible';fs.writeFileSync(path.join(dest,'RELEASE-MANIFEST.json'),JSON.stringify(manifest));assert.throws(()=>verify(dest),/platform/);
});
