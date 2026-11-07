import {createPostgresDatabase,type PostgresDatabase} from '../src/lib/db/postgres';
import {applyPostgresMigrations,verifyPostgresMigrations} from '../src/lib/db/pg-migrations';
import {productionNamespace} from '../src/lib/db/pg-production-schema';

/** Explicit administrative command; never loaded as application startup DDL.
 * Connection credentials are environment/secret-manager inputs, never CLI args. */
async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&['--help','-h'].includes(args[0])){
  console.log('Usage: migrate-postgres --apply|--verify --schema repaid|repaid_integration_<24hex>\nRequired: REPAID_PG_URL; optional REPAID_PG_CA_FILE. Explicit loopback-only plaintext: REPAID_PG_ALLOW_LOCAL_PLAINTEXT=1.\nNo data import, historical correction, runtime enablement or live cutover is performed.');return;
 }
 let action:'apply'|'verify'|undefined,schema:string|undefined;
 for(let index=0;index<args.length;index++){
  const value=args[index];
  if(value==='--apply'||value==='--verify'){if(action)throw Error('Choose exactly one migration action');action=value==='--apply'?'apply':'verify';}
  else if(value==='--schema'){if(schema||!args[index+1])throw Error('One explicit target schema required');schema=args[++index];}
  else throw Error('Unknown migration option');
 }
 if(!action||!schema)throw Error('Explicit migration action and schema required');productionNamespace(schema);
 const connectionString=process.env.REPAID_PG_URL;if(!connectionString)throw Error('Explicit PostgreSQL connection required');
 if(process.env.REPAID_PG_ALLOW_LOCAL_PLAINTEXT!=null&&!['0','1'].includes(process.env.REPAID_PG_ALLOW_LOCAL_PLAINTEXT))throw Error('Invalid PostgreSQL TLS configuration');
 let db:PostgresDatabase|undefined;
 try{
  db=createPostgresDatabase({connectionString,allowLocalPlaintext:process.env.REPAID_PG_ALLOW_LOCAL_PLAINTEXT==='1',caFile:process.env.REPAID_PG_CA_FILE,onError:event=>console.error(JSON.stringify(event))});
  if(action==='verify')console.log(JSON.stringify({operation:action,...await verifyPostgresMigrations(db,schema),production_cutover_performed:false}));
  else{
   const result=await applyPostgresMigrations(db,schema);
   console.log(JSON.stringify({operation:action,schema:result.schema,version:result.version,applied:result.applied,replayed:result.replayed,baseline_tables:result.coverage.baseline_tables,fenced_domains:result.coverage.fenced_tables.length,application_wide_ready:false,production_cutover_performed:false}));
  }
 }finally{await db?.close();}
}
main().catch(error=>{const value=(error as {code?:unknown})?.code;console.error(JSON.stringify({event:'postgres_migration_failed',code:typeof value==='string'&&/^[A-Z0-9]{5}$/.test(value)?value:'CONFIGURATION_OR_SCHEMA'}));console.error('مهاجرت PostgreSQL انجام نشد. تنظیمات خصوصی، سابقهٔ نسخه‌ها و ساختار مقصد را بررسی کنید؛ هیچ بازسازی داده یا انتقال زنده‌ای تأیید نشده است.');process.exitCode=1;});
