import {isWorker} from 'node:cluster';
import fs from 'node:fs';
import path from 'node:path';
type SqliteDeploymentEnvironment=Readonly<Record<string,string|undefined>>;

/** Defense against fixture setup/import order mistakes, before startup DDL or
 * opening the file. Production never enables this test-runner-only boundary. */
export function assertTestDatabaseDirectory(directory:string){
 if(process.env.REPAID_TEST_CONTEXT!=='1')return;
 if(!process.env.REPAID_TEST_WORKSPACE)throw Error('Test database directory requires an initialized private workspace');
 const workspace=fs.realpathSync(process.env.REPAID_TEST_WORKSPACE);let ancestor=path.resolve(directory);const suffix:string[]=[];
 while(!fs.existsSync(ancestor)){
  try{if(fs.lstatSync(ancestor).isSymbolicLink())throw Error('Dangling fixture link');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Test database directory must stay inside the private disposable workspace');}
  const parent=path.dirname(ancestor);if(parent===ancestor)throw Error('Invalid test database directory');suffix.unshift(path.basename(ancestor));ancestor=parent;
 }
 const resolved=path.join(fs.realpathSync(ancestor),...suffix);
 if(!resolved.startsWith(workspace+path.sep))throw Error('Test database directory must stay inside the private disposable workspace');
}

/** Supported deployment: one web process, durable local storage. Administrative
 * backup/recovery tools still use SQLite's real bounded transaction admission. */
export function assertSqliteRuntime(engine=process.env.REPAID_DATABASE_ENGINE??'sqlite',environment:SqliteDeploymentEnvironment=process.env,clusterWorker=isWorker){
 if(engine!=='sqlite')throw new Error(engine==='postgres'?'PostgreSQL live cutover is blocked until application SQL, services and financial guards are ported and verified. No SQLite fallback was used.':'Unsupported database engine');
 if(environment.VERCEL||environment.NETLIFY||environment.AWS_LAMBDA_FUNCTION_NAME)throw new Error('Persistent SQLite requires a dedicated server and durable local disk; serverless temporary storage is unsupported.');
 if(clusterWorker||(environment.WEB_CONCURRENCY!=null&&environment.WEB_CONCURRENCY!==''&&environment.WEB_CONCURRENCY!=='1'))throw new Error('SQLite supports one application web process. Clustered or horizontally scaled web deployments require a fully verified database migration.');
}
