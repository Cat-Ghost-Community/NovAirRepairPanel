// A self-contained, disposable production-mode test server. No customer key files are read.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const size=Number(process.argv[2]||20);
const port=Number(process.argv[3]||3001);
if(![20,200,3000].includes(size)||!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid fixture size or local port');
const env={...process.env,LOAD_TEST_MODE:'1',LOAD_REGISTERED_USERS:String(size),REPAID_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')};
const prepared=spawnSync(process.execPath,['--import','tsx','scripts/test-fixture.ts'],{env,encoding:'utf8',windowsHide:true});
if(prepared.status!==0){console.error(prepared.stderr);process.exit(1);}
const fixture=JSON.parse(fs.readFileSync(`.qa-work/fixture-${size}.json`,'utf8'));
Object.assign(env,{NODE_ENV:'production',REPAID_DATA_DIR:fixture.directory,APP_ORIGIN:`http://127.0.0.1:${port}`,REPAID_COOKIE_SECURE:'0'});
console.log(`Isolated fixture: ${size} registered employees; localhost port ${port}`);
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'inherit',windowsHide:true});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>{process.exitCode=code||0;});
