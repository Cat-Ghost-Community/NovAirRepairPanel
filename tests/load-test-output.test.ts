import {after,before,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-load-output-'));
const script=path.resolve('scripts/load-test.cjs');
const server=createServer((request,response)=>{
 if(request.url==='/api/auth/login')response.setHeader('Set-Cookie','session=synthetic-test-session; HttpOnly');
 response.setHeader('Content-Type','application/json');
 response.end('{}');
});
let base:string;
before(async()=>{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();
 if(!address||typeof address==='string')throw Error('Expected loopback test server');
 base='http://127.0.0.1:'+address.port;
});
after(async()=>{
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 fs.rmSync(directory,{recursive:true,force:true});
});

async function run(output?:string){
 const environment:NodeJS.ProcessEnv={...process.env,LOAD_TEST_MODE:'1',LOAD_BASE:base,LOAD_REQUESTS:'2',LOAD_CONCURRENCY:'1'};
 delete environment.LOAD_OUTPUT;
 if(output)environment.LOAD_OUTPUT=output;
 const child=spawn(process.execPath,[script],{cwd:directory,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);
 child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>stderr+=chunk);
 const [code]=await once(child,'close');assert.equal(code,0,stderr);
 return JSON.parse(stdout);
}

it('prints load results without creating files by default',async()=>{
 const result=await run();assert.equal(result.requests,2);assert.equal(result.errors,0);
 assert.deepEqual(fs.readdirSync(directory),[]);
});

it('writes load results only to an explicitly supplied output file',async()=>{
 const output=path.join(directory,'result.json'),result=await run(output);
 assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),result);
 assert.deepEqual(fs.readdirSync(directory),['result.json']);
});
