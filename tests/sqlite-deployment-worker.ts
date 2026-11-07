import cluster from 'node:cluster';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
async function main(){
 const root=fs.realpathSync(process.env.REPAID_DEPLOYMENT_PROBE_DIR??'');
 if(path.dirname(root)!==fs.realpathSync(os.tmpdir())||!path.basename(root).startsWith('repaid-runtime-'))throw Error('Disposable runtime probe required');
 const directory=path.join(root,'must-not-be-created');process.env.REPAID_DATA_DIR=directory;
 let blocked=false;
 try{const {getDb}=await import('../src/lib/db/schema');const db=getDb();db.close();}
 catch(error){blocked=error instanceof Error&&/serverless temporary storage|one application web process/.test(error.message);}
 const result={blocked,created:fs.existsSync(directory),clusterWorker:cluster.isWorker};
 if(process.send){process.send(result);process.disconnect?.();}else process.stdout.write(JSON.stringify(result));
}
main().catch(()=>{process.exitCode=1;process.disconnect?.();});
