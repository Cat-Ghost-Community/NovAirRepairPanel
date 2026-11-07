import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {postPostgresCustomerCredit} from '../../src/lib/db/postgres-customer-credit';

const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!process.send||!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Isolated PostgreSQL credit IPC worker required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true});
const timeout=setTimeout(()=>{process.exitCode=1;process.disconnect?.();void db.close();},15000);
process.once('message',async({schema,token,key,id}:{schema:string;token:string;key:string;id:number})=>{
 try{process.send?.(await postPostgresCustomerCredit(db,schema,token,key,id,1));}
 catch(error){process.send?.({error:(error as Error).message});process.exitCode=1;}
 finally{clearTimeout(timeout);await db.close();process.disconnect?.();}
});
process.send({ready:true});
