import {createPostgresDatabase,type PostgresDatabase} from './postgres';
import {postgresIntegration} from './pg-integration-config';
import {verifyPostgresMigrations} from './pg-migrations';
const state=globalThis as typeof globalThis&{repaidPgApp?:{identity:string;database:PostgresDatabase;schema:string;ready?:Promise<unknown>};repaidPgSignals?:boolean};
/** One bounded pool per application process. No schema creation or fallback. */
export function applicationPostgres(){
 const selected=postgresIntegration();if(!selected)throw Error('PostgreSQL website remains disabled outside isolated integration');
 const identity=selected.connectionString+'|'+selected.schema;
 if(state.repaidPgApp&&state.repaidPgApp.identity!==identity)throw Error('PostgreSQL application configuration changed; restart required');
 if(!state.repaidPgApp)state.repaidPgApp={identity,schema:selected.schema,database:createPostgresDatabase({connectionString:selected.connectionString,allowLocalPlaintext:true,maxConnections:10,onError:event=>console.error(JSON.stringify(event))})};
 if(!state.repaidPgSignals){state.repaidPgSignals=true;for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void closeApplicationPostgres().catch(()=>console.error('{"component":"postgres","code":"POOL_CLOSE"}'));});}
 return state.repaidPgApp;
}
export async function closeApplicationPostgres(){await state.repaidPgApp?.database.close();}
export async function readyApplicationPostgres(){const application=applicationPostgres();await(application.ready??=verifyPostgresMigrations(application.database,application.schema));return application;}
