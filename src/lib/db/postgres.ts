import {AsyncLocalStorage} from 'node:async_hooks';import {Pool,type PoolClient,type QueryResultRow} from 'pg';
import fs from 'node:fs';
import {assertPostgresStatement} from './postgres-sql';
type Context={client:PoolClient;closed:boolean;childActive:boolean};
type Isolation='read committed'|'repeatable read'|'serializable';
export type PostgresOptions={connectionString:string;allowLocalPlaintext?:boolean;caFile?:string;maxConnections?:number;statementTimeoutMs?:number;lockTimeoutMs?:number;idleTransactionTimeoutMs?:number;onError?:(event:{component:'postgres';code:string})=>void};
const code=(error:unknown)=>{const value=(error as {code?:string})?.code;return value&&/^[A-Z0-9]{5}$/.test(value)?value:'UNKNOWN';};
function bounded(value:number|undefined,fallback:number,min:number,max:number,label:string){const n=value??fallback;if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`Invalid PostgreSQL ${label}`);return n;}
/** Async target interface. Never masquerades as DatabaseSync or silently switches the application. */
export function createPostgresDatabase(options:PostgresOptions){
 const url=new URL(options.connectionString);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname.slice(1)||url.search)throw new Error('Use a PostgreSQL URL without query overrides');
 const local=['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname),plain=options.allowLocalPlaintext===true;
 if(plain&&!local)throw new Error('Plaintext PostgreSQL is restricted to explicit loopback tests');
 const max=bounded(options.maxConnections,10,1,100,'pool size'),statement=bounded(options.statementTimeoutMs,15000,10,300000,'statement timeout'),lock=bounded(options.lockTimeoutMs,3000,10,60000,'lock timeout'),idle=bounded(options.idleTransactionTimeoutMs,15000,100,300000,'idle transaction timeout');
 const pool=new Pool({connectionString:options.connectionString,max,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,maxLifetimeSeconds:1800,
  ssl:plain?false:{rejectUnauthorized:true,...(options.caFile?{ca:fs.readFileSync(options.caFile,'utf8')}:{})},
  statement_timeout:statement,options:`-c lock_timeout=${lock} -c idle_in_transaction_session_timeout=${idle} -c standard_conforming_strings=on`,application_name:'repaid-database'});
 const storage=new AsyncLocalStorage<Context>();let ending=false,savepoint=0,closing:Promise<void>|undefined;
 pool.on('error',error=>options.onError?.({component:'postgres',code:code(error)}));
 async function query<Row extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]){
  const context=storage.getStore();if(ending&&!context)throw new Error('PostgreSQL pool is closing');
  if(context?.closed)throw new Error('Transaction context has ended');if(context?.childActive)throw new Error('Parallel work cannot escape an active nested transaction');
  assertPostgresStatement(text);
  // pg 8.23 supports queryMode; forcing extended protocol also rejects multiple SQL commands.
  const statement={text,values,queryMode:'extended' as const};return context?context.client.query<Row>(statement):pool.query<Row>(statement);
 }
 async function transaction<T>(work:()=>Promise<T>,settings:{isolation?:Isolation;readOnly?:boolean}={}):Promise<T>{
  const parent=storage.getStore();if(ending&&!parent)throw new Error('PostgreSQL pool is closing');
  if(parent){
   if(parent.closed||parent.childActive)throw new Error('Overlapping nested transactions are not allowed');if(settings.isolation||settings.readOnly!=null)throw new Error('Nested transactions cannot change transaction characteristics');
   parent.childActive=true;const name='repaid_savepoint_'+(++savepoint),context:Context={client:parent.client,closed:false,childActive:false};
   try{await parent.client.query('SAVEPOINT '+name);const result=await storage.run(context,work);if(context.childActive)throw new Error('Unfinished nested transaction');await parent.client.query('RELEASE SAVEPOINT '+name);return result;}
   catch(error){await parent.client.query('ROLLBACK TO SAVEPOINT '+name);await parent.client.query('RELEASE SAVEPOINT '+name);throw error;}
   finally{context.closed=true;parent.childActive=false;}
  }
  const isolation=settings.isolation??'read committed';if(!['read committed','repeatable read','serializable'].includes(isolation))throw new Error('Invalid transaction isolation');
  const client=await pool.connect(),context:Context={client,closed:false,childActive:false};let begun=false,discard:Error|undefined;
  try{await client.query(`BEGIN ISOLATION LEVEL ${isolation.toUpperCase()} ${settings.readOnly?'READ ONLY':'READ WRITE'}`);begun=true;const result=await storage.run(context,work);if(context.childActive)throw new Error('Unfinished nested transaction');const committed=await client.query('COMMIT');if(committed.command!=='COMMIT')throw new Error('PostgreSQL transaction was rolled back after a caught statement failure');return result;}
  catch(error){if(begun)try{await client.query('ROLLBACK');}catch{discard=new Error('Discard failed PostgreSQL connection');}else discard=new Error('Discard PostgreSQL connection after failed BEGIN');throw error;}
  finally{context.closed=true;client.release(discard);}
 }
 return {query,transaction,isTransaction:()=>{const context=storage.getStore();return !!context&&!context.closed&&!context.childActive;},metrics:()=>({total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max}),
  async close(){if(storage.getStore())throw new Error('Cannot close PostgreSQL from a transaction');if(!closing){ending=true;closing=pool.end();}await closing;}};
}
export type PostgresDatabase=ReturnType<typeof createPostgresDatabase>;
/** pg intentionally returns BIGINT/NUMERIC as strings. Never globally parse financial values as floats. */
export function safePostgresInteger(value:string|number|bigint){if(!/^-?\d+$/.test(String(value)))throw new Error('Expected exact PostgreSQL integer');const n=BigInt(value);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('PostgreSQL integer exceeds application safe range');return Number(n);}
