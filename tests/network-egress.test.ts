import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
it('process-level isolation permits a real loopback response and rejects DNS and raw TCP without success stubs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-egress-')),audit=path.join(root,'audit.jsonl');fs.writeFileSync(audit,'');const server=createServer((_,response)=>response.end('actual-loopback-body'));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
 try{const code=`const net=require('node:net'),dns=require('node:dns');(async()=>{const r=await fetch('http://127.0.0.1:${address.port}');if(await r.text()!=='actual-loopback-body')throw Error('loopback');try{net.connect({host:'203.0.113.9',port:443});throw Error('network escaped');}catch(e){if(e.code!=='REPAID_TEST_EGRESS_DENIED')throw e;}await new Promise((resolve,reject)=>dns.lookup('international.invalid',e=>e?.code==='REPAID_TEST_EGRESS_DENIED'?resolve():reject(Error('DNS escaped'))));})().catch(()=>{process.exitCode=1;});`;
  const result=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,['--require','./scripts/network-egress-preload.cjs','-e',code],{env:{...process.env,REPAID_NETWORK_ISOLATION_TEST:'1',REPAID_NETWORK_AUDIT_FILE:audit},stdio:'ignore',windowsHide:true});child.on('error',reject);child.on('close',resolve);});assert.equal(result,0);const rows=fs.readFileSync(audit,'utf8').trim().split('\n').map(x=>JSON.parse(x));assert.ok(rows.some(x=>x.permitted));assert.equal(rows.filter(x=>!x.permitted).length,2);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
